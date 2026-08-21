export interface RepoSummary {
  id: string;
  name: string;
  project?: string;
  defaultBranch: string;
  webUrl?: string;
  localPath?: string;
  source: "azure-devops" | "local";
  indexedAs?: string;
  /** Bu repodan çıkarılmış graflar — klasör kapsamı başına bir kayıt. */
  indexed?: IndexedEntry[];
}

export interface IndexedEntry {
  /** CBM proje adı — silme bunu kullanır. */
  project: string;
  rootPath: string;
  /** İndekslenen klasörler; boş = tüm repo. */
  folders: string[];
  nodes: number;
  edges: number;
}

export interface AzdoStatus {
  configured: boolean;
  org?: string;
  baseUrl?: string;
  kind?: "cloud" | "server";
  /** PAT'in kaynağı — değerin kendisi hiçbir zaman API'den dönmez. */
  source?: "env" | "runtime";
  reason?: string;
}

export interface WatchState {
  repoPath: string;
  repoName: string;
  branch: string;
  lastSha: string | null;
  lastTrigger?: { at: string; sha: string; source: "poll" | "webhook" };
  /** Son indekslemenin sonucu — grafın gerçekten yenilendiğini gösteren bilgi. */
  lastIndex?: IndexOutcome;
  lastError?: string;
  pending: boolean;
}

export interface IndexOutcome {
  at: string;
  state: "succeeded" | "failed";
  sha: string;
  nodes?: number;
  edges?: number;
  error?: string;
}

export interface PrecheckItem {
  name: string;
  ok: boolean;
  note?: string;
}

export interface FolderEntry {
  /** Repo köküne göre yol. */
  path: string;
  name: string;
  hasChildren: boolean;
  /** Özyinelemeli dosya sayısı; -1 = bilinmiyor (API'den listelendi). */
  fileCount: number;
}

export interface FolderList {
  folders: FolderEntry[];
  /** Listenin kaynağı — dosya sayısı yalnızca git'te var. */
  source: "git" | "azure-devops";
  counts: boolean;
}

export interface PrecheckResult {
  path: string;
  /** Kaynak kodun nasıl hazırlandığı. */
  action: "cloned" | "updated" | "local";
  sha: string;
  /** Uygulanan klasör kapsamı; boş = tüm repo. */
  folders: string[];
  /** Çalışma kopyasına inen dosya sayısı. */
  fileCount: number;
  logs: string[];
  checks: PrecheckItem[];
  ready: boolean;
}

export interface BranchList {
  branches: string[];
  defaultBranch: string;
}




export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface IndexResult {
  project: string;
  nodes: number;
  edges: number;
  status: string;
  excludedDirs: string[];
  skippedCount: number;
}

export interface JobEvent {
  type: "log" | "state" | "result";
  at: string;
  message?: string;
  state?: JobState;
  result?: IndexResult;
}

export interface EndpointInfo {
  project: string;
  streamableHttpUrl: string;
  sseUrl: string;
  authMode: "none" | "bearer";
  snippets: Record<string, string>;
}

export type StepStatus = "pending" | "active" | "running" | "done" | "error";

export interface StepDefinition {
  id: string;
  title: string;
  subtitle: string;
}

export interface CbmUiStatus {
  available: boolean;
  url: string;
  baseUrl: string;
  reason?: string;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

export interface CatalogEntry {
  project: string;
  /** Okunabilir ad — kart başlığında bu gösterilir. Kapsam varsa içerir. */
  displayName: string;
  /** Kapsam eki olmadan repo adı. */
  repoName?: string;
  lastCommit: CommitInfo | null;
  rootPath: string;
  /** Grafın çıkarıldığı dal. */
  branch?: string;
  /** İndekslenen klasör kapsamı; boş = tüm repo. */
  folders?: string[];
  /** Son indekslemenin zamanı — kalıcı kayıttan gelir. */
  indexedAt?: string;
  nodes: number;
  edges: number;
  sizeBytes: number;
  streamableHttpUrl: string;
  sseUrl: string;
  graphUrl: string;
  autoUpdate: {
    enabled: boolean;
    branch?: string;
    lastSha?: string | null;
    lastTrigger?: { at: string; sha: string; source: "poll" | "webhook" };
    lastIndex?: IndexOutcome;
  };
}

export interface CatalogResponse {
  authMode: "none" | "bearer";
  gatewayBaseUrl: string;
  cbmUiAvailable: boolean;
  projects: CatalogEntry[];
}
