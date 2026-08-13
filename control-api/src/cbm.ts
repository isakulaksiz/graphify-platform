import { spawn } from "node:child_process";
import type { IndexResult, IndexedProject } from "./types.js";

const CBM = process.env.CBM_BINARY ?? "codebase-memory-mcp";

/** CLI çağrılarının azami süresi. Aşılırsa süreç öldürülür. */
const CLI_TIMEOUT_MS = 30_000;

function cbmEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CBM_LOG_LEVEL: process.env.CBM_LOG_LEVEL ?? "info" };
}

/**
 * CBM'i çalıştırır.
 *
 * ‼️ stdin MUTLAKA 'ignore' olmalı.
 * `cbm cli <tool>` argümanlarını stdin'den de kabul ediyor ve stdin açık bir
 * boru ise EOF bekleyerek SONSUZA KADAR asılıyor. Node'un varsayılan
 * spawn/execFile davranışı stdin'i açık boru olarak verdiği için, stdin'i
 * kapatmayan her programatik çağrı kilitlenir. Deneyle doğrulandı:
 *   `cbm cli list_projects < /dev/null`   -> anında döner
 *   `sleep 30 | cbm cli list_projects`    -> asılı kalır
 */
function spawnCbm(args: string[]) {
  return spawn(CBM, args, {
    env: cbmEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface CollectedOutput {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Tek seferlik komut çalıştırıp tüm çıktıyı toplar. */
function runCbm(args: string[], onStderrLine?: (line: string) => void): Promise<CollectedOutput> {
  return new Promise((resolve, reject) => {
    const child = spawnCbm(args);
    let stdout = "";
    let stderr = "";
    let pending = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CBM komutu ${CLI_TIMEOUT_MS} ms içinde bitmedi: ${args.join(" ")}`));
    }, CLI_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (!onStderrLine) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onStderrLine(trimmed);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending.trim() && onStderrLine) onStderrLine(pending.trim());
      resolve({ stdout, stderr, code });
    });
  });
}

/** stdout'un son satırını JSON olarak ayrıştırır (öncesinde lifecycle logları olabilir). */
function parseLastJson<T>(stdout: string): T {
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("CBM boş çıktı döndürdü.");
  return JSON.parse(line) as T;
}

// ── Proje listesi ────────────────────────────────────────────────────────────

/**
 * Kısa ömürlü önbellek + tek uçuşlu istek.
 *
 * Her HTTP isteğinde ayrı CBM süreci başlatmak iki bedel doğuruyor: CBM
 * komutları admission barrier üzerinden serileştirdiği için eşzamanlı çağrılar
 * birbirini bekletiyor, ve her çağrı ~2 sn süreç başlatma maliyeti ödüyor.
 */
let projectCache: { at: number; value: IndexedProject[] } | null = null;
let projectInflight: Promise<IndexedProject[]> | null = null;
const PROJECT_CACHE_MS = 5_000;

export function invalidateProjectCache(): void {
  projectCache = null;
}

export async function listProjects(): Promise<IndexedProject[]> {
  if (projectCache && Date.now() - projectCache.at < PROJECT_CACHE_MS) {
    return projectCache.value;
  }
  if (projectInflight) return projectInflight;

  projectInflight = listProjectsUncached()
    .then((value) => {
      projectCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      projectInflight = null;
    });
  return projectInflight;
}

async function listProjectsUncached(): Promise<IndexedProject[]> {
  const { stdout, code } = await runCbm(["cli", "list_projects"]);
  if (code !== 0) throw new Error(`list_projects ${code} koduyla çıktı.`);

  const parsed = parseLastJson<{ projects?: Array<Record<string, unknown>> }>(stdout);
  return (parsed.projects ?? []).map((p) => ({
    name: String(p.name),
    rootPath: String(p.root_path ?? ""),
    branch: typeof p.branch === "string" ? p.branch : undefined,
    nodes: Number(p.nodes ?? 0),
    edges: Number(p.edges ?? 0),
    sizeBytes: Number(p.size_bytes ?? 0),
  }));
}

// ── İndeksleme ───────────────────────────────────────────────────────────────

export interface IndexHandle {
  done: Promise<IndexResult>;
  cancel(): void;
}

/**
 * Bir repoyu indeksler ve ilerlemeyi satır satır bildirir.
 *
 * `cli` modu daemon başlatmaz — webhook/CI tetiklemesi için tasarlanmış yol budur.
 * `--progress` stderr'e ilerleme yazdırır; stdout yalnızca sonuç JSON'u içerir.
 */
export function indexRepository(
  repoPath: string,
  onLog: (line: string) => void,
): IndexHandle {
  const child = spawnCbm(["cli", "--progress", "index_repository", "--repo-path", repoPath]);

  let stdout = "";
  let pending = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLog(trimmed);
    }
  });

  const done = new Promise<IndexResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (pending.trim()) onLog(pending.trim());

      if (code !== 0) {
        reject(new Error(`İndeksleme ${code} koduyla çıktı.`));
        return;
      }
      try {
        const raw = parseLastJson<Record<string, unknown>>(stdout);
        const excluded = raw.excluded as { dirs?: string[] } | undefined;
        resolve({
          project: String(raw.project ?? ""),
          nodes: Number(raw.nodes ?? 0),
          edges: Number(raw.edges ?? 0),
          status: String(raw.status ?? "unknown"),
          excludedDirs: (excluded?.dirs ?? []).filter((d) => d !== ".git"),
          skippedCount: Number(raw.skipped_count ?? 0),
        });
      } catch (error) {
        reject(new Error(`Sonuç JSON'u ayrıştırılamadı: ${String(error)}`));
      }
    });
  });

  return { done, cancel: () => child.kill("SIGTERM") };
}

/** Takılı daemon'ı kurtarır — bkz. gateway/README.md "Daemon kurtarma". */
export async function recoverDaemon(): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("pkill", ["-f", "codebase-memory-mcp"], { stdio: "ignore" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}
