import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { gitAuthArgs } from "./azdo.js";
import type { RepoSummary } from "./types.js";

/** Klonların tutulduğu kök dizin. */
const CLONE_ROOT = resolve(
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

/** Repo için deterministik, çakışmayan bir klon dizini üretir. */
export function clonePathFor(repo: RepoSummary): string {
  const slug = [repo.project, repo.name]
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "-");
  return join(CLONE_ROOT, `${slug}-${repo.id.slice(0, 8)}`);
}

export interface PrepareResult {
  repoPath: string;
  /** Klon yeni mi açıldı yoksa mevcut olan mı güncellendi. */
  action: "cloned" | "updated" | "local";
  sha: string;
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
  onLog: (line: string) => void = () => undefined,
): Promise<PrepareResult> {
  if (repo.source === "local") {
    if (!repo.localPath || !existsSync(repo.localPath)) {
      throw new Error(`Yerel repo bulunamadı: ${repo.localPath}`);
    }
    const head = await git(["rev-parse", branch], repo.localPath);
    return { repoPath: repo.localPath, action: "local", sha: head.stdout };
  }

  if (!repo.remoteUrl) {
    throw new Error(`'${repo.name}' için klonlama adresi (remoteUrl) yok.`);
  }

  const target = clonePathFor(repo);
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

  // İstenen dalın uzak halini çalışma kopyasına yaz.
  const checkout = await git(["checkout", "-B", branch, `origin/${branch}`], target);
  if (checkout.code !== 0) {
    throw new Error(`'${branch}' dalına geçilemedi: ${checkout.stderr || "bilinmeyen hata"}`);
  }

  const head = await git(["rev-parse", "HEAD"], target);
  onLog(`Hazır: ${branch} @ ${head.stdout.slice(0, 10)}`);
  return { repoPath: target, action, sha: head.stdout };
}

/** Yerel bir reponun dallarını listeler. */
export async function localBranches(repoPath: string): Promise<string[]> {
  const result = await git(["branch", "--format=%(refname:short)"], repoPath);
  if (result.code !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}
