/** Arayüz ile API arasındaki ortak sözleşme. */

export interface RepoSummary {
  id: string;
  name: string;
  /** Azure DevOps proje adı; yerel repolarda boş. */
  project?: string;
  defaultBranch: string;
  webUrl?: string;
  /** Klonlama için git remote adresi. */
  remoteUrl?: string;
  /** Diskte hazır bir kopya varsa yolu. İndeksleme bunu kullanır. */
  localPath?: string;
  source: "azure-devops" | "local";
  /** Bu repo daha önce indekslendiyse CBM'deki proje adı. */
  /**
   * İlk indekslenmiş kaydın CBM proje adı.
   *
   * Geriye dönük uyumluluk için duruyor; birden çok kapsam olabildiği için
   * arayıza `indexed` listesi verildi.
   */
  indexedAs?: string;
  /** Bu repodan çıkarılmış tüm grafları — kapsam başına bir kayıt. */
  indexed?: IndexedEntry[];
}

/** Bir repodan çıkarılmış tek graf. */
export interface IndexedEntry {
  /** CBM proje adı — silme ve endpoint çağrıları bunu kullanır. */
  project: string;
  /** Kaynak kodun diskteki yolu. */
  rootPath: string;
  /** İndekslenen klasör kapsamı; boş = tüm repo. */
  folders: string[];
  nodes: number;
  edges: number;
}

export interface IndexedProject {
  name: string;
  rootPath: string;
  branch?: string;
  nodes: number;
  edges: number;
  sizeBytes: number;
}

export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface JobEvent {
  type: "log" | "state" | "result";
  at: string;
  message?: string;
  state?: JobState;
  result?: IndexResult;
}

export interface IndexResult {
  project: string;
  nodes: number;
  edges: number;
  status: string;
  /** İndekslenmeyen dizinler — sessiz eksik graf tespiti için kritik. */
  excludedDirs: string[];
  skippedCount: number;
}

export interface EndpointInfo {
  project: string;
  streamableHttpUrl: string;
  sseUrl: string;
  /** Gateway'in kimlik doğrulama modu — snippet'lerin şeklini belirler. */
  authMode: "none" | "bearer";
  /** İstemcilere yapıştırılacak hazır yapılandırma parçacıkları. */
  snippets: Record<string, string>;
}
