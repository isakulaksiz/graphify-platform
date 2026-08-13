import type {
  AzdoStatus,
  BranchList,
  CbmUiStatus,
  EndpointInfo,
  JobEvent,
  PrecheckResult,
  RepoSummary,
  WatchState,
} from "./types";

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export function fetchRepos(): Promise<{ repos: RepoSummary[]; azdo: AzdoStatus }> {
  return json("/api/repos");
}

export function fetchBranches(repoId: string): Promise<BranchList> {
  return json(`/api/repos/${encodeURIComponent(repoId)}/branches`);
}

/**
 * Kaynak kodu hazırlar (gerekiyorsa klonlar/günceller) ve uygunluğunu doğrular.
 * Kaynak kod yolu burada türetilir — kullanıcıdan istenmez.
 */
export function prepareRepo(repoId: string, branch: string): Promise<PrecheckResult> {
  return json("/api/prepare", { method: "POST", body: JSON.stringify({ repoId, branch }) });
}

export function startJob(repoPath: string, repoName: string): Promise<{ jobId: string }> {
  return json("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ repoPath, repoName }),
  });
}

export function fetchEndpoint(project: string): Promise<EndpointInfo> {
  return json(`/api/projects/${encodeURIComponent(project)}/endpoint`);
}

export function fetchCbmUi(project: string): Promise<CbmUiStatus> {
  return json(`/api/cbm-ui?project=${encodeURIComponent(project)}`);
}

export function recoverDaemon(): Promise<{ message: string }> {
  return json("/api/recover", { method: "POST" });
}

/**
 * Azure DevOps kimlik bilgisini kaydeder.
 *
 * PAT sunucuda yalnızca bellekte tutulur; diske yazılmaz ve hiçbir yanıtta
 * geri dönmez. Bu yüzden arayüz de saklamaz — tek yönlü gider.
 */
export function saveAzdoCredentials(org: string, pat: string): Promise<AzdoStatus> {
  return json("/api/azdo", { method: "POST", body: JSON.stringify({ org, pat }) });
}

export function clearAzdoCredentials(): Promise<AzdoStatus> {
  return json("/api/azdo", { method: "DELETE" });
}

export function startWatch(
  repoPath: string,
  repoName: string,
  branch: string,
): Promise<WatchState> {
  return json("/api/watch", {
    method: "POST",
    body: JSON.stringify({ repoPath, repoName, branch }),
  });
}

export function stopWatch(repoPath: string): Promise<{ stopped: boolean }> {
  return json(`/api/watch?repoPath=${encodeURIComponent(repoPath)}`, { method: "DELETE" });
}

export function fetchWatchState(repoPath: string): Promise<WatchState | null> {
  return json(`/api/watch/state?repoPath=${encodeURIComponent(repoPath)}`);
}

/**
 * İş ilerlemesini SSE ile dinler.
 *
 * Sunucu iş bittiğinde akışı kapatır; EventSource varsayılan olarak yeniden
 * bağlanmaya çalıştığı için `onDone` içinde kapatmak zorundayız.
 */
export function subscribeToJob(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onDone: () => void,
): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);

  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as JobEvent);
    } catch {
      // Ayrıştırılamayan kareyi sessizce atla; akışı bozmasın.
    }
  };

  source.onerror = () => {
    source.close();
    onDone();
  };

  return () => source.close();
}
