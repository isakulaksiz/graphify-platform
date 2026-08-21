import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { gitAuthArgs } from "./azdo.js";
import { scopePathspec, syncWorkingTree } from "./clone.js";
import { createJob } from "./jobs.js";
import { getRecord, listRecords, recordIndex, setAutoUpdate } from "./state.js";

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
  /**
   * Son indekslemenin SONUCU.
   *
   * Eskiden yalnızca "kuyruğa alındı" bilgisi vardı; işin başarılı olup
   * olmadığı hiçbir yere yazılmıyordu. Sonuç: başarısız bir indekslemeden
   * sonra katalog YENİ commit'i ESKİ grafla gösteriyor ve kullanıcı grafın
   * güncellendiğini sanıyordu.
   */
  lastIndex?: {
    at: string;
    state: "succeeded" | "failed";
    sha: string;
    nodes?: number;
    edges?: number;
    error?: string;
  };
  /** Şu anda bekleyen (debounce içindeki) tetikleyici var mı. */
  pending: boolean;
}

interface Watch extends WatchState {
  timer?: NodeJS.Timeout;
  debounceTimer?: NodeJS.Timeout;
  /**
   * syncWorkingTree + createJob sürerken true.
   *
   * `pending` tek başına yetmiyor: indeksleme başladığında `pending` düşüyor
   * ama `lastSha` ancak iş bittiğinde ilerliyor. Arada kalan bir yoklama
   * "sha değişmiş, bekleyen de yok" görüp aynı commit'i ikinci kez
   * tetikliyordu — büyük repoda bir tam indeksleme boşa gidiyor.
   */
  indexing?: boolean;
  /**
   * Aynı commit için üst üste başarısız deneme sayısı.
   *
   * Başarısızlıkta `lastSha` geri alınıyor ki commit tekrar denensin; sınır
   * olmasa kalıcı bir hata her yoklamada tam indeksleme başlatırdı.
   */
  failures?: { sha: string; attempts: number };
}

const MAX_FAILED_ATTEMPTS = 3;

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

/**
 * İzlenen dalın güncel sha'sını döndürür; uzak varsa önce fetch eder.
 *
 * KLASÖR KAPSAMI VARSA reponun tepe commit'ine değil, KAPSAMA DOKUNAN son
 * commit'e bakıyor. Aksi halde başka bir iş kolunun klasörüne yapılan her
 * push, kapsam dışı olmasına rağmen yeniden indeksleme tetikliyordu — büyük
 * monorepo'da günde onlarca gereksiz indeksleme demek.
 *
 * Kapsam dışı bir commit geldiğinde sha değişmiyor, dolayısıyla tetikleme de
 * olmuyor.
 */
async function currentSha(
  repoPath: string,
  branch: string,
  folders: string[] = [],
): Promise<string> {
  const remotes = await git(["remote"], repoPath);
  const hasRemote = remotes.stdout.length > 0;

  let ref = branch;
  if (hasRemote) {
    // PAT'i header ile geçiyoruz — URL'ye gömmek reflog ve `ps` sızıntısı yaratır.
    await git([...gitAuthArgs(), "fetch", "--quiet", "--prune", "origin", branch], repoPath);
    const remote = await git(["rev-parse", `origin/${branch}`], repoPath);
    if (remote.code === 0 && remote.stdout) ref = `origin/${branch}`;
  }

  const tip = await git(["rev-parse", ref], repoPath);
  if (tip.code !== 0 || !tip.stdout) {
    throw new Error(`'${branch}' dalı çözümlenemedi.`);
  }
  if (folders.length === 0) return tip.stdout;

  const pathspec = await scopePathspec(repoPath, ref, folders);
  const scoped = await git(["rev-list", "-1", ref, "--", ...pathspec], repoPath);
  // Kapsama hiç dokunulmamışsa (yeni kapsam, boş geçmiş) tepeye düşüyoruz;
  // aksi halde lastSha boş kalır ve her yoklama tetikleme sanır.
  return scoped.code === 0 && scoped.stdout ? scoped.stdout : tip.stdout;
}

function scheduleIndex(watch: Watch, sha: string, source: "poll" | "webhook"): void {
  if (watch.debounceTimer) clearTimeout(watch.debounceTimer);
  watch.pending = true;
  watch.debounceTimer = setTimeout(() => void runIndex(watch, sha, source), DEBOUNCE_MS);
}

/**
 * Çalışma kopyasını güncelleyip indekslemeyi kuyruğa alır.
 *
 * Sıra kritik: önce `syncWorkingTree`, sonra `createJob`. Bu adım eksikken
 * fetch yalnızca `origin/<dal>` referansını ilerletiyor, CBM ise diskteki
 * ESKİ dosyaları yeniden indeksliyordu — iş başarılı görünüyor, graf
 * değişmiyordu.
 *
 * Hata durumunda `lastSha` ilerletilmiyor: aksi halde başarısız tek bir
 * denemeden sonra o commit bir daha hiç denenmezdi.
 */
async function runIndex(watch: Watch, sha: string, source: "poll" | "webhook"): Promise<void> {
  if (watch.indexing) return;
  watch.indexing = true;

  const previousSha = watch.lastSha;
  try {
    // Kapsam kayıttan okunuyor: yeni commit kapsam dışı klasörlere dokunsa
    // bile graf aynı klasörlerle kalsın.
    const record = getRecord(watch.repoPath);
    const folders = record?.folders ?? [];
    const head = await syncWorkingTree(watch.repoPath, watch.branch, folders, (line) =>
      console.info(`[watch] ${line}`),
    );
    const indexed = head ?? sha;

    watch.lastSha = indexed;
    watch.lastError = undefined;
    watch.lastTrigger = { at: new Date().toISOString(), sha: indexed, source };

    console.info(
      `[watch] ${watch.repoName} (${watch.branch}) @ ${indexed.slice(0, 8)} (${source}) — indeksleme kuyruğa alındı`,
    );
    const job = createJob(watch.repoPath, watch.repoName);

    /**
     * İşin sonucunu bekle.
     *
     * Kayda sha'yı ancak BAŞARIDA yazıyoruz. Eskiden iş kuyruğa alınır alınmaz
     * yazılıyordu; başarısız bir indekslemeden sonra kayıt "bu commit
     * indekslendi" diyor, katalog yeni commit'i eski grafla gösteriyordu.
     */
    job.emitter.once("end", () => {
      const at = new Date().toISOString();
      if (job.state === "succeeded") {
        watch.failures = undefined;
        watch.lastIndex = {
          at,
          state: "succeeded",
          sha: indexed,
          nodes: job.result?.nodes,
          edges: job.result?.edges,
        };
        recordIndex({
          repoPath: watch.repoPath,
          repoName: watch.repoName,
          branch: watch.branch,
          sha: indexed,
        });
        console.info(
          `[watch] ${watch.repoName} grafı yenilendi: ${job.result?.nodes ?? "?"} node / ${job.result?.edges ?? "?"} edge`,
        );
        return;
      }

      const attempts =
        watch.failures?.sha === indexed ? watch.failures.attempts + 1 : 1;
      watch.failures = { sha: indexed, attempts };
      watch.lastIndex = { at, state: "failed", sha: indexed, error: job.error };
      // sha'yı geri al: bir sonraki yoklama aynı commit'i tekrar denesin.
      watch.lastSha = previousSha;
      console.error(
        `[watch] ${watch.repoName} indekslemesi BAŞARISIZ (${attempts}/${MAX_FAILED_ATTEMPTS}): ${job.error}`,
      );
    });
  } catch (error) {
    watch.lastError = String(error instanceof Error ? error.message : error);
    console.error(`[watch] ${watch.repoName} güncellenemedi: ${watch.lastError}`);
  } finally {
    // İkisi de burada düşüyor: aradaki her yoklama tetiklemeyi atlasın.
    watch.pending = false;
    watch.indexing = false;
  }
}

async function poll(watch: Watch): Promise<void> {
  try {
    // Kapsam kayıttan: yoklama yalnızca kapsama dokunan commit'leri görsün.
    const folders = getRecord(watch.repoPath)?.folders ?? [];
    const sha = await currentSha(watch.repoPath, watch.branch, folders);
    watch.lastError = undefined;

    if (watch.lastSha === null) {
      // İlk okuma: mevcut durumu taban al, indeksleme tetikleme.
      watch.lastSha = sha;
      return;
    }
    // Aynı commit üst üste başarısız olduysa denemeyi bırak — kalıcı bir hata
    // her yoklamada tam indeksleme başlatmasın. Kullanıcı elle tetikleyebilir.
    const exhausted =
      watch.failures?.sha === sha && watch.failures.attempts >= MAX_FAILED_ATTEMPTS;

    if (sha !== watch.lastSha && !watch.pending && !watch.indexing && !exhausted) {
      scheduleIndex(watch, sha, "poll");
    }
  } catch (error) {
    watch.lastError = String(error);
    console.error(`[watch] ${watch.repoName} kontrol edilemedi: ${watch.lastError}`);
  }
}

export function startWatch(repoPath: string, repoName: string, branch: string): WatchState {
  if (!branch) throw new Error("İzleme için dal adı zorunlu.");
  stopWatch(repoPath, { persist: false });

  const watch: Watch = { repoPath, repoName, branch, lastSha: null, pending: false };
  watch.timer = setInterval(() => void poll(watch), POLL_MS);
  watch.timer.unref();

  watches.set(repoPath, watch);
  // İndeksleme kaydı yoksa oluştur; varsa dalı izlenen dala hizala.
  recordIndex({ repoPath, repoName, branch });
  setAutoUpdate(repoPath, true, branch);

  void poll(watch);
  console.info(`[watch] izleme başladı: ${repoName} (${branch}), her ${POLL_MS / 1000} sn`);
  return toState(watch);
}

export function stopWatch(repoPath: string, options: { persist?: boolean } = {}): boolean {
  const watch = watches.get(repoPath);
  if (!watch) return false;

  clearInterval(watch.timer);
  if (watch.debounceTimer) clearTimeout(watch.debounceTimer);
  watches.delete(repoPath);
  // Yeniden başlatmadaki geçici durdurmada kaydı bozma.
  if (options.persist !== false) setAutoUpdate(repoPath, false);

  console.info(`[watch] izleme durdu: ${watch.repoName}`);
  return true;
}

/**
 * Servis açılışında izlemeleri geri kurar.
 *
 * İzlemeler yalnızca bellekte tutulduğu için konteyner her yeniden
 * başladığında otomatik güncelleme sessizce kapanıyordu; arayüzde "açık"
 * görünüp aslında çalışmaması en kötü hâliydi.
 */
export function restoreWatches(): number {
  let restored = 0;
  for (const record of listRecords()) {
    if (!record.autoUpdate || !record.branch) continue;
    if (!existsSync(record.repoPath)) {
      console.warn(`[watch] kayıt atlandı, yol yok: ${record.repoPath}`);
      continue;
    }
    startWatch(record.repoPath, record.repoName, record.branch);
    restored += 1;
  }
  if (restored > 0) console.info(`[watch] ${restored} izleme geri kuruldu.`);
  return restored;
}

function toState(watch: Watch): WatchState {
  return {
    repoPath: watch.repoPath,
    repoName: watch.repoName,
    branch: watch.branch,
    lastSha: watch.lastSha,
    lastTrigger: watch.lastTrigger,
    lastIndex: watch.lastIndex,
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
      const folders = getRecord(watch.repoPath)?.folders ?? [];
      const sha = await currentSha(watch.repoPath, watch.branch, folders);
      if (sha !== watch.lastSha && !watch.indexing) scheduleIndex(watch, sha, "webhook");
    } catch (error) {
      watch.lastError = String(error);
    }
  }
  return matches.length;
}
