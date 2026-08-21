import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { gitAuthArgs } from "./azdo.js";
import type { RepoSummary } from "./types.js";

/** Klonların tutulduğu kök dizin. */
export const CLONE_ROOT = resolve(
  process.env.CLONE_ROOT ?? join(homedir(), ".cache", "graphify", "repos"),
);

const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS ?? 300_000);

interface GitResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * git çalıştırır.
 *
 * stdin 'ignore': kimlik istemi çıkarsa asılmak yerine hemen hata versin.
 * GIT_TERMINAL_PROMPT=0 aynı amaçla, git'in kendi istemini kapatır.
 */
function git(args: string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve_, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve_({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
  });
}

/**
 * Klasör kapsamı için kısa, kararlı bir anahtar.
 *
 * Aynı repoyu farklı klasör kapsamlarıyla indekslemek isteyen ekipler için
 * gerekli: kapsam klon yolunun parçası olmazsa ikinci indeksleme birincinin
 * klonunu ve dolayısıyla grafını sessizce ezerdi.
 */
export function scopeKey(folders: string[]): string {
  if (folders.length === 0) return "";

  const normalized = [...new Set(folders.map(normalizeFolder))].filter(Boolean).sort();
  if (normalized.length === 0) return "";

  const digest = createHash("sha1").update(normalized.join("\n")).digest("hex").slice(0, 6);
  // İlk klasörün adı okunabilirlik için; ayırt etme işini digest yapıyor.
  const label = normalized[0].split("/").at(-1)?.replace(/[^A-Za-z0-9._-]/g, "-") ?? "scope";
  return `${label}-${digest}`;
}

/** Kullanıcıdan gelen klasör yolunu git'in beklediği biçime getirir. */
export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+/, "").replace(/\/+$/, "").replace(/\\/g, "/");
}

/** Repo (ve varsa klasör kapsamı) için deterministik, çakışmayan bir klon dizini üretir. */
export function clonePathFor(repo: RepoSummary, folders: string[] = []): string {
  const slug = [repo.project, repo.name]
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "-");
  const scope = scopeKey(folders);
  return join(CLONE_ROOT, `${slug}-${repo.id.slice(0, 8)}${scope ? `-${scope}` : ""}`);
}

export interface PrepareResult {
  repoPath: string;
  /** Klon yeni mi açıldı yoksa mevcut olan mı güncellendi. */
  action: "cloned" | "updated" | "local";
  sha: string;
  /** Uygulanan klasör kapsamı; boş dizi = tüm repo. */
  folders: string[];
  /** Çalışma kopyasına inen dosya sayısı — kapsamın etkisi burada görünür. */
  fileCount: number;
}

/**
 * Çalışma kopyasını seçilen klasörlere daraltır.
 *
 * NEDEN SPARSE-CHECKOUT: CBM'in `index_repository` aracı klasör filtresi
 * almıyor — yalnızca `--repo-path`, `--mode`, `--name`, `--persistence` var.
 * Dolayısıyla kapsamı CBM'e söyleyemiyoruz; kapsam dışı dosyaları DİSKE HİÇ
 * İNDİRMİYORUZ. CBM ne bulursa onu indeksliyor.
 *
 * Yan faydası büyük repolarda asıl kazanç: indirilmeyen dosya için ne çalışma
 * kopyası yazımı, ne tree-sitter ayrıştırması, ne LSP çözümlemesi yapılıyor.
 *
 * cone modu kökteki dosyaları her zaman dahil eder (README, package.json gibi).
 * Bu istenen davranış: kök yapılandırma dosyaları olmadan graf bağlamsız kalır.
 */
export async function applyScope(
  repoPath: string,
  folders: string[],
  onLog: (line: string) => void = () => undefined,
): Promise<string[]> {
  const normalized = [...new Set(folders.map(normalizeFolder))].filter(Boolean).sort();

  if (normalized.length === 0) {
    // Kapsam kaldırıldıysa daha önce yazılmış sparse ayarını temizle.
    await git(["sparse-checkout", "disable"], repoPath);
    return [];
  }

  const init = await git(["sparse-checkout", "init", "--cone"], repoPath);
  if (init.code !== 0) {
    throw new Error(`sparse-checkout başlatılamadı: ${init.stderr || "bilinmeyen hata"}`);
  }

  const set = await git(["sparse-checkout", "set", ...normalized], repoPath);
  if (set.code !== 0) {
    throw new Error(`Klasör kapsamı uygulanamadı: ${set.stderr || "bilinmeyen hata"}`);
  }

  onLog(`Kapsam: ${normalized.join(", ")}`);
  return normalized;
}

/**
 * Çalışma kopyasında GERÇEKTEN duran dosya sayısı.
 *
 * Düz `ls-files` indeksi listeler; sparse-checkout'ta indeks tüm repoyu
 * içermeye devam ettiği için kapsam daraltılsa bile aynı sayıyı verir.
 * `-v` her girdiyi durum harfiyle döndürüyor: 'H' diskte olan, 'S' ise
 * skip-worktree (indirilmemiş). Yalnızca 'H' sayılıyor.
 */
async function countFiles(repoPath: string): Promise<number> {
  const result = await git(["ls-files", "-v"], repoPath).catch(() => null);
  if (!result || result.code !== 0 || !result.stdout) return 0;
  return result.stdout.split("\n").filter((line) => line.startsWith("H")).length;
}

export interface FolderEntry {
  /** Repo köküne göre yol. */
  path: string;
  /** Yalnızca son bileşen — arayüzde gösterilen ad. */
  name: string;
  /** Altında başka klasör var mı — arayüz açılabilir göstersin. */
  hasChildren: boolean;
  /** Bu klasör altındaki (özyinelemeli) dosya sayısı. */
  fileCount: number;
}

/**
 * Bir dalın klasörlerini listeler — çalışma kopyasına ihtiyaç duymadan.
 *
 * `ls-tree` git nesnelerinden okuyor, dolayısıyla `--no-checkout` ile açılmış
 * bir klonda da çalışıyor. Kullanıcı henüz hiçbir dosya inmemişken klasör
 * seçebiliyor; büyük repoda tam checkout beklemenin anlamı yok.
 */
export async function listFolders(
  repoPath: string,
  branch: string,
  path = "",
): Promise<FolderEntry[]> {
  const base = normalizeFolder(path);
  const ref = (await git(["rev-parse", "--verify", `origin/${branch}`], repoPath)).code === 0
    ? `origin/${branch}`
    : branch;

  const listed = await git(
    ["ls-tree", "-d", "--name-only", ref, base ? `${base}/` : ""].filter(Boolean),
    repoPath,
  );
  if (listed.code !== 0) return [];

  const paths = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);

  // Dosya sayıları tek `ls-tree -r` çağrısından çıkarılıyor; klasör başına
  // ayrı çağrı büyük repoda yüzlerce süreç açardı.
  const allFiles = await git(["ls-tree", "-r", "--name-only", ref], repoPath);
  const files = allFiles.code === 0 ? allFiles.stdout.split("\n") : [];

  return Promise.all(
    paths.map(async (folder) => {
      const prefix = `${folder}/`;
      const children = await git(["ls-tree", "-d", "--name-only", ref, prefix], repoPath);
      return {
        path: folder,
        name: folder.split("/").at(-1) ?? folder,
        hasChildren: children.code === 0 && children.stdout.trim().length > 0,
        fileCount: files.filter((file) => file.startsWith(prefix)).length,
      };
    }),
  );
}

/**
 * Repoyu indekslemeye hazır hale getirir.
 *
 * Yerel repolarda hiçbir şey yapmaz — yol zaten var. Azure DevOps repolarında
 * klon yoksa açar, varsa fetch edip istenen dala geçer.
 *
 * PAT'i URL'ye gömmüyoruz: remote config'e, reflog'a ve `ps` çıktısına sızar.
 * Bunun yerine her çağrıda `http.extraHeader` ile geçiyoruz.
 */
export async function prepareRepo(
  repo: RepoSummary,
  branch: string,
  folders: string[] = [],
  onLog: (line: string) => void = () => undefined,
): Promise<PrepareResult> {
  if (repo.source === "local") {
    if (!repo.localPath || !existsSync(repo.localPath)) {
      throw new Error(`Yerel repo bulunamadı: ${repo.localPath}`);
    }
    // Yerel repo kullanıcının kendi çalışma kopyası; sparse-checkout uygulamak
    // onun dosyalarını diskten kaldırırdı.
    if (folders.length > 0) {
      throw new Error(
        "Klasör kapsamı yerel repolarda uygulanamıyor: çalışma kopyanızdan dosya kaldırmak " +
          "gerekirdi. Azure DevOps üzerinden seçilen repolarda kullanılabilir.",
      );
    }
    const head = await git(["rev-parse", branch], repo.localPath);
    return {
      repoPath: repo.localPath,
      action: "local",
      sha: head.stdout,
      folders: [],
      fileCount: await countFiles(repo.localPath),
    };
  }

  if (!repo.remoteUrl) {
    throw new Error(`'${repo.name}' için klonlama adresi (remoteUrl) yok.`);
  }

  const target = clonePathFor(repo, folders);
  await mkdir(CLONE_ROOT, { recursive: true });

  const auth = gitAuthArgs();
  let action: PrepareResult["action"];

  if (existsSync(join(target, ".git"))) {
    onLog(`Mevcut klon güncelleniyor: ${target}`);
    const fetched = await git([...auth, "fetch", "--prune", "origin", branch], target);
    if (fetched.code !== 0) {
      throw new Error(`fetch başarısız: ${fetched.stderr || "bilinmeyen hata"}`);
    }
    action = "updated";
  } else {
    onLog(`Klonlanıyor: ${repo.name} → ${target}`);
    // --no-checkout: dalı ayrı adımda seçiyoruz, gereksiz çalışma kopyası yazılmasın.
    const cloned = await git([
      ...auth,
      "clone",
      "--no-checkout",
      "--branch",
      branch,
      repo.remoteUrl,
      target,
    ]);
    if (cloned.code !== 0) {
      throw new Error(`Klonlama başarısız: ${cloned.stderr || "bilinmeyen hata"}`);
    }
    action = "cloned";
  }

  // Kapsam checkout'tan ÖNCE uygulanıyor: kapsam dışı dosyalar diske hiç
  // yazılmasın. Sonra uygulamak önce hepsini indirip sonra silmek olurdu.
  const applied = await applyScope(target, folders, onLog);

  // İstenen dalın uzak halini çalışma kopyasına yaz.
  const checkout = await git(["checkout", "-B", branch, `origin/${branch}`], target);
  if (checkout.code !== 0) {
    throw new Error(`'${branch}' dalına geçilemedi: ${checkout.stderr || "bilinmeyen hata"}`);
  }

  const head = await git(["rev-parse", "HEAD"], target);
  const fileCount = await countFiles(target);
  onLog(`Hazır: ${branch} @ ${head.stdout.slice(0, 10)} · ${fileCount} dosya`);
  return { repoPath: target, action, sha: head.stdout, folders: applied, fileCount };
}

/**
 * Bu yol bizim açtığımız bir klon mu.
 *
 * Ayrım güvenlik için: yönetilen klonlarda `checkout -f` ile yerel değişikliği
 * atmakta sakınca yok, orayı yalnızca biz yazıyoruz. Kullanıcının kendi yerel
 * reposunda aynı şey commit edilmemiş çalışmasını silerdi.
 */
export function isManagedClone(repoPath: string): boolean {
  const path = resolve(repoPath);
  return path === CLONE_ROOT || path.startsWith(`${CLONE_ROOT}${sep}`);
}

/**
 * Klonda hâlihazırda uygulanmış sparse kapsamını okur.
 *
 * Kaydın tek doğruluk kaynağı olmasına güvenmiyoruz: klon sihirbaz dışından
 * (ör. bir bakım betiği) oluşturulmuş olabilir. Gerçeği git'in kendisinden
 * okumak katalogun ve otomatik güncellemenin yanlış kapsam göstermesini önler.
 *
 * Sparse kapalıysa komut hata döndürür — o durumda kapsam yok demektir.
 */
export async function readScope(repoPath: string): Promise<string[]> {
  const result = await git(["sparse-checkout", "list"], repoPath).catch(() => null);
  if (!result || result.code !== 0 || !result.stdout) return [];
  return [...new Set(result.stdout.split("\n").map(normalizeFolder))].filter(Boolean).sort();
}

/** Çalışma kopyasının o an üzerinde bulunduğu dal. */
export async function currentBranch(repoPath: string): Promise<string | null> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).catch(() => null);
  if (!result || result.code !== 0 || !result.stdout || result.stdout === "HEAD") return null;
  return result.stdout;
}

/**
 * Çalışma kopyasını dalın son commit'ine getirir ve yeni sha'yı döndürür.
 *
 * OTOMATİK GÜNCELLEMENİN EKSİK ADIMI BUYDU: `fetch` yalnızca `origin/<dal>`
 * referansını ilerletir, çalışma kopyası eski commit'te kalır. Bu adım
 * olmadan CBM her tetiklemede AYNI eski dosyaları yeniden indeksliyor,
 * iş "başarılı" görünüyor ama graf hiç değişmiyordu.
 *
 * Yerel repolarda çalışma kopyasına dokunulmaz; ne varsa o indekslenir.
 */
export async function syncWorkingTree(
  repoPath: string,
  branch: string,
  folders: string[] = [],
  onLog: (line: string) => void = () => undefined,
): Promise<string | null> {
  if (!isManagedClone(repoPath)) {
    onLog(`Yerel repo — çalışma kopyasına dokunulmuyor (${repoPath}).`);
    return null;
  }

  const fetched = await git([...gitAuthArgs(), "fetch", "--prune", "origin", branch], repoPath);
  if (fetched.code !== 0) {
    throw new Error(`'${branch}' için fetch başarısız: ${fetched.stderr || "bilinmeyen hata"}`);
  }

  // Kapsamı yeniden uygula: sparse ayarı klonda kalıcı olsa da, kayıttaki
  // kapsamı doğrulamak yeni klasör eklenmiş bir push'ta kapsamın kaymasını
  // önler.
  if (folders.length > 0) await applyScope(repoPath, folders, onLog);

  // -f: yönetilen klonda yerel değişiklik olmamalı; olduysa dalın hali kazanır.
  const checkout = await git(["checkout", "-f", "-B", branch, `origin/${branch}`], repoPath);
  if (checkout.code !== 0) {
    throw new Error(`'${branch}' dalına geçilemedi: ${checkout.stderr || "bilinmeyen hata"}`);
  }

  const head = await git(["rev-parse", "HEAD"], repoPath);
  onLog(`Çalışma kopyası güncellendi: ${branch} @ ${head.stdout.slice(0, 10)}`);
  return head.stdout || null;
}

/** Yerel bir reponun dallarını listeler. */
export async function localBranches(repoPath: string): Promise<string[]> {
  const result = await git(["branch", "--format=%(refname:short)"], repoPath);
  if (result.code !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}


export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

/**
 * Klonun son commit bilgisini okur.
 *
 * Katalogda "bu graf hangi koddan çıkarıldı" sorusunu cevaplıyor — sha olmadan
 * grafın güncel mi bayat mı olduğu anlaşılmıyor.
 */
export async function lastCommit(
  repoPath: string,
  folders: string[] = [],
): Promise<CommitInfo | null> {
  /**
   * Kapsam varsa commit de kapsamdan okunuyor.
   *
   * Kapsam daraltılmış bir projede reponun tepe commit'ini göstermek yanıltıcı:
   * o commit başka bir iş kolunun klasörüne dokunmuş olabilir ve grafın
   * içeriğiyle hiç ilgisi olmayabilir. Kullanıcının görmesi gereken, GRAFTAKİ
   * kodu son değiştiren commit.
   *
   * Kök dosyalar da pathspec'e giriyor: cone modunda onlar da çalışma
   * kopyasında, dolayısıyla kapsamın parçası.
   */
  const pathspec =
    folders.length > 0 ? await scopePathspec(repoPath, "HEAD", folders) : [];

  const result = await git(
    ["log", "-1", "--format=%H%x1f%an%x1f%aI%x1f%s", ...(pathspec.length ? ["--", ...pathspec] : [])],
    repoPath,
  ).catch(() => null);
  if (!result || result.code !== 0 || !result.stdout) return null;

  const [sha, author, date, subject] = result.stdout.split("\u001f");
  if (!sha) return null;
  return { sha, shortSha: sha.slice(0, 10), author: author ?? "", date: date ?? "", subject: subject ?? "" };
}

/**
 * Teknik proje adından okunabilir bir ad türetir.
 *
 * CBM proje adını klon yolundan üretiyor:
 *   /data/repos/GRAPHIFY-GRAPHIFY-2b08ec87  →  data-repos-GRAPHIFY-GRAPHIFY-2b08ec87
 *
 * Buradan dizin adını alıp sondaki 8 haneli kimliği ve tekrarlanan
 * proje/repo adını temizliyoruz. Yerel repolarda dizin adı zaten okunabilir.
 */
export function displayName(rootPath: string): string {
  const base = rootPath.split("/").filter(Boolean).at(-1) ?? rootPath;
  const parts = base.split("-");

  // Repo kimliği: 8 haneli hex. Yalnızca bir tanesini atıyoruz — repo adının
  // kendisi de hex harflerden oluşabilir ("facade" gibi), hepsini silmek adı
  // bozardı.
  const idIndex = parts.findIndex((part) => /^[0-9a-f]{8}$/i.test(part));
  const withoutId = idIndex >= 0 ? parts.filter((_, i) => i !== idIndex) : parts;

  /**
   * Kapsam digest'i: sondaki 6 haneli hex. Yalnızca repo kimliği de bulunmuşsa
   * atıyoruz — o zaman bu dizin adının bizim ürettiğimiz kalıba uyduğu kesin.
   * Aksi halde gerçek bir klasör adını ("facade") silme riski var.
   */
  const withoutScopeDigest =
    idIndex >= 0 && /^[0-9a-f]{6}$/i.test(withoutId.at(-1) ?? "")
      ? withoutId.slice(0, -1)
      : withoutId;

  // "GRAPHIFY-GRAPHIFY" gibi proje adı = repo adı tekrarını sadeleştir.
  const deduped = withoutScopeDigest.filter(
    (part, index) => index === 0 || part !== withoutScopeDigest[index - 1],
  );

  return deduped.join("-") || base;
}

/**
 * Kapsamın git pathspec karşılığı: seçilen klasörler + kökteki dosyalar.
 *
 * Kök dosyalar (README, package.json, derleme yapılandırmaları) cone modunda
 * her zaman çalışma kopyasına iniyor, yani grafın parçası. Pathspec'e
 * eklenmezlerse bir bağımlılık yükseltmesi otomatik güncellemeyi tetiklemez.
 */
export async function scopePathspec(
  repoPath: string,
  ref: string,
  folders: string[],
): Promise<string[]> {
  const normalized = [...new Set(folders.map(normalizeFolder))].filter(Boolean);
  if (normalized.length === 0) return [];

  // `ls-tree` dizin girdilerini 'tree' olarak işaretliyor; blob'lar kök dosyalar.
  const listed = await git(["ls-tree", ref], repoPath).catch(() => null);
  const rootFiles =
    listed && listed.code === 0
      ? listed.stdout
          .split("\n")
          .filter((line) => line.includes(" blob "))
          .map((line) => line.split("\t")[1])
          .filter((name): name is string => Boolean(name))
      : [];

  return [...normalized, ...rootFiles];
}

/**
 * CBM'in bir kök yol için türettiği proje adı.
 *
 * CBM adı yoldan üretiyor: `/data/repos/X` → `data-repos-X`. Ters çevirmek
 * güvenli değil (ad da tire içerebilir), ama İLERİ yönde hesaplamak kesin.
 * Bu sayede elimizde yalnızca proje adı varken hangi yola ait olduğunu
 * eşleştirebiliyoruz — proje henüz CBM'e kaydolmamış olsa bile.
 */
export function cbmProjectName(rootPath: string): string {
  return resolve(rootPath).replace(/^\/+/, "").replace(/\//g, "-");
}

/** Kapsamı başlıkta gösterilecek kısa etikete çevirir. */
export function scopeLabel(folders: string[]): string {
  if (folders.length === 0) return "";
  if (folders.length === 1) return folders[0];
  return `${folders[0]} +${folders.length - 1}`;
}
