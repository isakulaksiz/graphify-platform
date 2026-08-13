import { spawn } from "node:child_process";
import { gitAuthArgs } from "./azdo.js";
import { createJob } from "./jobs.js";

/** Git HEAD kontrol sıklığı. */
const POLL_MS = Number(process.env.WATCH_POLL_MS ?? 15_000);
/**
 * Değişiklik görüldükten sonra indekslemeden önce beklenen süre.
 *
 * Arka arkaya gelen push'ları tek indekslemede birleştirir. Üretimde 60 sn
 * önerilir; burada gösterim için kısa tutuldu.
 */
const DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE_MS ?? 5_000);

export interface WatchState {
  repoPath: string;
  repoName: string;
  branch: string;
  /** Son bilinen commit sha. */
  lastSha: string | null;
  /** Son indekslemeyi tetikleyen olay. */
  lastTrigger?: { at: string; sha: string; source: "poll" | "webhook" };
  lastError?: string;
  /** Şu anda bekleyen (debounce içindeki) tetikleyici var mı. */
  pending: boolean;
}

interface Watch extends WatchState {
  timer?: NodeJS.Timeout;
  debounceTimer?: NodeJS.Timeout;
}

const watches = new Map<string, Watch>();

function git(args: string[], cwd: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // stdin 'ignore': kimlik istemi beklerken asılmasın.
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), code });
    });
  });
}

/** İzlenen dalın güncel sha'sını döndürür; uzak varsa önce fetch eder. */
async function currentSha(repoPath: string, branch: string): Promise<string> {
  const remotes = await git(["remote"], repoPath);
  const hasRemote = remotes.stdout.length > 0;

  if (hasRemote) {
    // PAT'i header ile geçiyoruz — URL'ye gömmek reflog ve `ps` sızıntısı yaratır.
    await git([...gitAuthArgs(), "fetch", "--quiet", "--prune", "origin", branch], repoPath);
    const remote = await git(["rev-parse", `origin/${branch}`], repoPath);
    if (remote.code === 0 && remote.stdout) return remote.stdout;
  }

  const local = await git(["rev-parse", branch], repoPath);
  if (local.code !== 0 || !local.stdout) {
    throw new Error(`'${branch}' dalı çözümlenemedi.`);
  }
  return local.stdout;
}

function scheduleIndex(watch: Watch, sha: string, source: "poll" | "webhook"): void {
  if (watch.debounceTimer) clearTimeout(watch.debounceTimer);
  watch.pending = true;

  watch.debounceTimer = setTimeout(() => {
    watch.pending = false;
    watch.lastSha = sha;
    watch.lastTrigger = { at: new Date().toISOString(), sha, source };
    console.info(
      `[watch] ${watch.repoName} @ ${sha.slice(0, 8)} (${source}) — indeksleme kuyruğa alındı`,
    );
    createJob(watch.repoPath, watch.repoName);
  }, DEBOUNCE_MS);
}

async function poll(watch: Watch): Promise<void> {
  try {
    const sha = await currentSha(watch.repoPath, watch.branch);
    watch.lastError = undefined;

    if (watch.lastSha === null) {
      // İlk okuma: mevcut durumu taban al, indeksleme tetikleme.
      watch.lastSha = sha;
      return;
    }
    if (sha !== watch.lastSha && !watch.pending) {
      scheduleIndex(watch, sha, "poll");
    }
  } catch (error) {
    watch.lastError = String(error);
    console.error(`[watch] ${watch.repoName} kontrol edilemedi: ${watch.lastError}`);
  }
}

export function startWatch(repoPath: string, repoName: string, branch: string): WatchState {
  stopWatch(repoPath);

  const watch: Watch = { repoPath, repoName, branch, lastSha: null, pending: false };
  watch.timer = setInterval(() => void poll(watch), POLL_MS);
  watch.timer.unref();

  watches.set(repoPath, watch);
  void poll(watch);
  console.info(`[watch] izleme başladı: ${repoName} (${branch}), her ${POLL_MS / 1000} sn`);
  return toState(watch);
}

export function stopWatch(repoPath: string): boolean {
  const watch = watches.get(repoPath);
  if (!watch) return false;
  clearInterval(watch.timer);
  if (watch.debounceTimer) clearTimeout(watch.debounceTimer);
  watches.delete(repoPath);
  console.info(`[watch] izleme durdu: ${watch.repoName}`);
  return true;
}

function toState(watch: Watch): WatchState {
  return {
    repoPath: watch.repoPath,
    repoName: watch.repoName,
    branch: watch.branch,
    lastSha: watch.lastSha,
    lastTrigger: watch.lastTrigger,
    lastError: watch.lastError,
    pending: watch.pending,
  };
}

export function listWatches(): WatchState[] {
  return [...watches.values()].map(toState);
}

export function getWatch(repoPath: string): WatchState | undefined {
  const watch = watches.get(repoPath);
  return watch ? toState(watch) : undefined;
}

/**
 * Webhook'tan gelen push bildirimini işler.
 *
 * İzlenen repoları adına göre bulur ve anında kontrol tetikler — poll
 * aralığını beklemez. Debounce yine uygulanır, yani arka arkaya gelen
 * push'lar tek indekslemede birleşir.
 */
export async function notifyPush(repoName: string, branch: string): Promise<number> {
  const matches = [...watches.values()].filter(
    (watch) => watch.repoName === repoName && watch.branch === branch,
  );

  for (const watch of matches) {
    try {
      const sha = await currentSha(watch.repoPath, watch.branch);
      if (sha !== watch.lastSha) scheduleIndex(watch, sha, "webhook");
    } catch (error) {
      watch.lastError = String(error);
    }
  }
  return matches.length;
}
