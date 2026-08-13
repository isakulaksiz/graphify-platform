import type { RepoSummary } from "./types.js";

const API_VERSION = "7.1";

/**
 * Azure DevOps kimlik bilgisi.
 *
 * PAT yalnızca bu sürecin belleğinde tutulur — diske yazılmaz, log'a düşmez,
 * API yanıtlarında geri dönmez. Süreç yeniden başlarsa tekrar girilmesi gerekir.
 * Ortam değişkeni ile de verilebilir (AZDO_PAT); arayüzden girilen değer onu ezer.
 */
let runtimeOrg: string | undefined = process.env.AZDO_ORG;
let runtimePat: string | undefined = process.env.AZDO_PAT;

export interface AzdoStatus {
  configured: boolean;
  org?: string;
  /** PAT'in kaynağı — değerin kendisi asla dönmez. */
  source?: "env" | "runtime";
  reason?: string;
}

export function azdoStatus(): AzdoStatus {
  if (!runtimeOrg) {
    return { configured: false, reason: "Organizasyon adı girilmedi." };
  }
  if (!runtimePat) {
    return {
      configured: false,
      org: runtimeOrg,
      reason: "Personal Access Token girilmedi. Repo listesi çekilemiyor.",
    };
  }
  return {
    configured: true,
    org: runtimeOrg,
    source: runtimePat === process.env.AZDO_PAT ? "env" : "runtime",
  };
}

/** Bağlantıyı doğrular ve kimlik bilgisini belleğe alır. Geçersizse saklamaz. */
export async function setCredentials(org: string, pat: string): Promise<AzdoStatus> {
  const previousOrg = runtimeOrg;
  const previousPat = runtimePat;
  runtimeOrg = org.trim();
  runtimePat = pat;

  try {
    await listRepos();
    return azdoStatus();
  } catch (error) {
    runtimeOrg = previousOrg;
    runtimePat = previousPat;
    throw error;
  }
}

/** Bellekteki kimlik bilgisini siler. */
export function clearCredentials(): void {
  runtimeOrg = process.env.AZDO_ORG;
  runtimePat = process.env.AZDO_PAT;
}

function authHeader(): string {
  // Azure DevOps PAT'i boş kullanıcı adıyla basic auth olarak bekler.
  return `Basic ${Buffer.from(`:${runtimePat}`).toString("base64")}`;
}

/**
 * Organizasyondaki tüm git repolarını listeler.
 *
 * GET https://dev.azure.com/{org}/_apis/git/repositories?api-version=7.1
 */
export async function listRepos(): Promise<RepoSummary[]> {
  if (!runtimeOrg || !runtimePat) return [];

  const url = `https://dev.azure.com/${runtimeOrg}/_apis/git/repositories?api-version=${API_VERSION}`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });

  if (response.status === 401 || response.status === 203) {
    // Azure DevOps geçersiz PAT'te 203 + oturum açma sayfası döndürebiliyor.
    throw new Error("Kimlik doğrulanamadı. Token geçersiz veya süresi dolmuş olabilir.");
  }
  if (response.status === 404) {
    throw new Error(`Organizasyon bulunamadı: ${runtimeOrg}`);
  }
  if (!response.ok) {
    throw new Error(`Azure DevOps hatası: HTTP ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { value?: Array<Record<string, unknown>> };

  return (payload.value ?? []).map((repo) => ({
    id: String(repo.id),
    name: String(repo.name),
    project:
      typeof repo.project === "object" && repo.project !== null
        ? String((repo.project as Record<string, unknown>).name)
        : undefined,
    defaultBranch: String(repo.defaultBranch ?? "refs/heads/main").replace("refs/heads/", ""),
    webUrl: typeof repo.webUrl === "string" ? repo.webUrl : undefined,
    remoteUrl: typeof repo.remoteUrl === "string" ? repo.remoteUrl : undefined,
    source: "azure-devops" as const,
  }));
}

/**
 * Bir reponun dallarını listeler.
 *
 * GET .../git/repositories/{repositoryId}/refs?filter=heads&api-version=7.1
 */
export async function listBranches(repositoryId: string): Promise<string[]> {
  if (!runtimeOrg || !runtimePat) return [];

  const url =
    `https://dev.azure.com/${runtimeOrg}/_apis/git/repositories/${repositoryId}` +
    `/refs?filter=heads&api-version=${API_VERSION}`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Dal listesi alınamadı: HTTP ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { value?: Array<{ name?: string }> };
  return (payload.value ?? [])
    .map((ref) => String(ref.name ?? "").replace("refs/heads/", ""))
    .filter(Boolean)
    .sort();
}

/** Tek bir reponun bilgilerini döndürür (klonlama için remoteUrl gerekiyor). */
export async function getRepo(repositoryId: string): Promise<RepoSummary | null> {
  const repos = await listRepos();
  return repos.find((repo) => repo.id === repositoryId) ?? null;
}

/** Klonlama için PAT'i header olarak geçiren git argümanları. */
export function gitAuthArgs(): string[] {
  if (!runtimePat) return [];
  // PAT'i URL'ye gömmüyoruz: reflog'a, `ps` çıktısına ve remote config'e sızar.
  const basic = Buffer.from(`:${runtimePat}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}
