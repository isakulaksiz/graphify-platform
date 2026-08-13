/**
 * Proje kapsamlama ve yetki zorlaması — gateway'in güvenlik çekirdeği.
 *
 * NEDEN GEREKLİ:
 * codebase-memory-mcp tek OS hesabında tek canonical cache root'a izin verir.
 * Farklı CBM_CACHE_DIR ile eşzamanlı process reddedilir, yani repo başına ayrı
 * veritabanı ile izolasyon YAPILAMAZ. Tüm repoların grafı tek DB dizininde durur
 * ve her araç `project` argümanı ile hedefini seçer.
 *
 * Sonuç: izolasyonun tek yeri burasıdır. Bu modül devre dışı kalırsa A reposuna
 * yetkili bir geliştirici `--project B` göndererek yetkisi olmayan repoyu okur.
 */

/** Bir token'ın sahip olabileceği yetkiler. */
export type Scope = "read" | "adr:write" | "traces:write";

export interface CallPolicy {
  /** Çağrının geçmesine izin verilsin mi. */
  allowed: boolean;
  /** Reddedildiyse kullanıcıya dönecek gerekçe. */
  reason?: string;
}

/**
 * `project` argümanı zorla ezilecek araçlar.
 *
 * Buradaki her araç için gateway, istemcinin gönderdiği `project` değerini
 * yok sayıp URL'deki proje adını yazar.
 */
const PROJECT_SCOPED_TOOLS = new Set([
  "index_status",
  "check_index_coverage",
  "search_graph",
  "trace_path",
  "trace_call_path", // trace_path'in takma adı
  "detect_changes",
  "query_graph",
  "get_graph_schema",
  "get_code_snippet",
  "get_architecture",
  "search_code",
  "manage_adr",
  "ingest_traces",
]);

/**
 * Salt okunur araçlar — `read` yetkisi yeterli.
 *
 * Bu liste v0.10.3 binary'sinin gerçekten sunduğu araçlardan doğrulanarak
 * çıkarıldı, README'den değil. İki fark tespit edildi:
 *   - `check_index_coverage` README'de yok ama binary sunuyor (aşağıda izinli)
 *   - `semantic_query` README'de var ama binary sunmuyor (listeye alınmadı)
 */
const READ_ONLY_TOOLS = new Set([
  "list_projects",
  "index_status",
  "check_index_coverage",
  "search_graph",
  "trace_path",
  "trace_call_path",
  "detect_changes",
  "query_graph",
  "get_graph_schema",
  "get_code_snippet",
  "get_architecture",
  "search_code",
]);

/**
 * Gateway üzerinden ASLA çağrılamayacak araçlar.
 *
 * İndeksleme ve silme, kimin hangi repoyu ne zaman indekslediğini denetleyebilmek
 * için indexer worker'ından geçmek zorunda. MCP endpoint'i salt tüketim yüzeyidir.
 */
const BLOCKED_TOOLS = new Map<string, string>([
  [
    "index_repository",
    "İndeksleme gateway üzerinden yapılamaz. Arayüzden veya master'a push ile tetiklenir.",
  ],
  [
    "delete_project",
    "Proje silme gateway üzerinden yapılamaz. Platform yöneticisiyle iletişime geçin.",
  ],
]);

/** `manage_adr`'ın yazma gerektirmeyen modları. */
const ADR_READ_MODES = new Set(["get", "sections"]);

/** Bir aracın çağrılmasına izin verilip verilmediğine karar verir. */
export function evaluateCall(
  toolName: string,
  args: Record<string, unknown>,
  scopes: readonly Scope[],
): CallPolicy {
  const blocked = BLOCKED_TOOLS.get(toolName);
  if (blocked) {
    return { allowed: false, reason: blocked };
  }

  if (toolName === "manage_adr") {
    const mode = typeof args.mode === "string" ? args.mode : "get";
    if (!ADR_READ_MODES.has(mode) && !scopes.includes("adr:write")) {
      return {
        allowed: false,
        reason: `ADR yazma yetkiniz yok (mode='${mode}', gereken yetki: adr:write).`,
      };
    }
    return { allowed: true };
  }

  if (toolName === "ingest_traces") {
    if (!scopes.includes("traces:write")) {
      return {
        allowed: false,
        reason:
          "Trace yükleme yetkiniz yok (gereken yetki: traces:write). Bu uç APM entegrasyonu içindir.",
      };
    }
    return { allowed: true };
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    return scopes.includes("read")
      ? { allowed: true }
      : { allowed: false, reason: "Okuma yetkiniz yok (gereken yetki: read)." };
  }

  // Tanımadığımız bir araç: CBM sürümü yeni araç eklemiş olabilir.
  // Varsayılan REDDET — yeni bir araç sessizce yetki sınırını delmesin.
  return {
    allowed: false,
    reason: `Bu gateway sürümü '${toolName}' aracını tanımıyor ve varsayılan olarak reddediyor.`,
  };
}

/**
 * Araç argümanlarını kapsama göre yeniden yazar.
 *
 * İstemcinin gönderdiği `project` değeri güvenilmezdir ve koşulsuz ezilir.
 */
export function rewriteArguments(
  toolName: string,
  args: Record<string, unknown>,
  project: string,
): Record<string, unknown> {
  if (!PROJECT_SCOPED_TOOLS.has(toolName)) {
    return args;
  }
  return { ...args, project };
}

/** Bir aracın istemciye gösterilip gösterilmeyeceği. */
export function isToolVisible(toolName: string, scopes: readonly Scope[]): boolean {
  return evaluateCall(toolName, {}, scopes).allowed;
}

/**
 * `list_projects` yanıtını tek projeye indirger.
 *
 * Aksi halde istemci, yetkisi olmayan repoların adlarını ve boyutlarını görür.
 */
export function filterProjectList(payload: unknown, project: string): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.projects)) return payload;

  const visible = record.projects.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).name === project,
  );
  return { ...record, projects: visible };
}
