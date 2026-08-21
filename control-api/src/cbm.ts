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
 *
 * `--mode` GEÇİLMİYOR: indeksleme her zaman CBM'in tam modunda çalışıyor.
 * moderate/fast modları benzerlik ve anlamsal kenarları atlayarak süreyi
 * kısaltıyor ama grafı zayıflatıyor; kapsam daraltmak (sparse-checkout) aynı
 * kazancı graf kalitesinden ödün vermeden veriyor.
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

/**
 * CBM'in takıldığını gösteren imzalar.
 *
 * Bu durumlarda komut kendi başına bir daha denese de düzelmiyor; daemon'ın
 * temizlenmesi gerekiyor.
 */
const WEDGED = /daemon could not accept this client|pre-coordination|unverified CBM generation|secure CLI coordination/i;

/** CBM'in gürültülü günlük satırlarını atıp okunabilir bir teşhis bırakır. */
function meaningfulOutput(...streams: string[]): string {
  return streams
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("level=info") &&
        !line.startsWith("hint:") &&
        !line.startsWith("Preparing") &&
        !line.startsWith("Running"),
    )
    .join(" | ")
    .slice(-400);
}

interface DeleteAttempt {
  ok: boolean;
  status: string;
  detail: string;
}

/** Çıktıdaki JSON gövdesinin `status` alanı; yoksa null. */
function reportedStatus(...streams: string[]): string | null {
  for (const stream of streams) {
    for (const line of stream.trim().split("\n").reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(trimmed) as { status?: unknown };
        if (typeof parsed.status === "string") return parsed.status;
      } catch {
        // Bu satır JSON değil; öncekilere bak.
      }
    }
  }
  return null;
}

async function attemptDelete(project: string): Promise<DeleteAttempt> {
  const { stdout, stderr, code } = await runCbm(["cli", "delete_project", "--project", project]);
  const status = reportedStatus(stdout, stderr);

  /**
   * `not_found` başarı sayılıyor — ÇIKIŞ KODU NE OLURSA OLSUN.
   *
   * CBM bu durumu tutarsız raporluyor: bazı çağrılarda 0, bazılarında 1 kodu
   * ile ama her ikisinde de `{"status":"not_found"}` gövdesiyle dönüyor.
   * Kodu esas alan bir kontrol, zaten silinmiş bir grafı ikinci kez silmeye
   * çalışan kullanıcıya "500 Internal Server Error" gösteriyordu. Silme
   * işlemi tekrarlanabilir olmalı.
   */
  if (code === 0 || status === "not_found") {
    invalidateProjectCache();
    return { ok: true, status: status ?? "deleted", detail: "" };
  }

  // CBM teşhisi STDERR'e yazıyor. Eskiden yalnızca stdout raporlanıyordu ve
  // hata mesajı "delete_project 1 koduyla çıktı: " diye bomboş çıkıyordu.
  return { ok: false, status: "", detail: meaningfulOutput(stderr, stdout) };
}

export interface DeleteResult {
  status: string;
  /** Daemon temizlendikten sonra mı başarılı oldu. */
  recovered: boolean;
}

/**
 * Bir projenin grafını siler.
 *
 * Olmayan proje hata değil: CBM 0 kodu ve `status: "not_found"` döndürüyor,
 * biz de bunu başarı sayıyoruz — silme çağrısı tekrarlanabilir olmalı.
 *
 * Takılı daemon imzası görülürse ve `allowRecovery` açıksa daemon temizlenip
 * bir kez daha denenir. Çağıran, çalışan indeksleme varken bunu KAPATMAK
 * zorunda: kurtarma `pkill` ile bütün CBM süreçlerini öldürüyor, o indeksleme
 * de giderdi. Kararı çağırana bırakmak cbm.ts ↔ jobs.ts dairesel bağımlılığını
 * da ortadan kaldırıyor.
 */
export async function deleteProject(
  project: string,
  options: { allowRecovery?: boolean } = {},
): Promise<DeleteResult> {
  const first = await attemptDelete(project);
  if (first.ok) return { status: first.status, recovered: false };

  if (!WEDGED.test(first.detail)) {
    throw new Error(first.detail || "CBM bir açıklama vermeden başarısız oldu.");
  }
  if (options.allowRecovery === false) {
    throw new Error(
      `${first.detail} — CBM takılmış görünüyor ama şu anda bir indeksleme sürüyor. ` +
        "Daemon'ı temizlemek o işi de öldüreceği için otomatik denemedik; iş bitince tekrar deneyin.",
    );
  }

  console.warn(`[cbm] delete_project takıldı, daemon temizleniyor: ${first.detail}`);
  await recoverDaemon();

  const second = await attemptDelete(project);
  if (second.ok) return { status: second.status, recovered: true };
  throw new Error(`Daemon temizlendikten sonra da silinemedi: ${second.detail}`);
}

/** Takılı daemon'ı kurtarır — bkz. gateway/README.md "Daemon kurtarma". */
export async function recoverDaemon(): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("pkill", ["-f", "codebase-memory-mcp"], { stdio: "ignore" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}
