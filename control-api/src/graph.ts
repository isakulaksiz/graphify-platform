import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Graf verisini CBM'in SQLite veritabanından okur.
 *
 * NEDEN DOĞRUDAN SQLITE:
 * CBM'in CLI çıktısı `--json` ile bile insan-okur metin döndürüyor
 * ("rows: 3 (cols: a.name b.name)\n  __init__ LedgerClient\n…"). Bunu ayrıştırmak
 * biçim değiştiğinde sessizce bozulur. Şema ise sabit ve okuması ucuz.
 *
 * KISIT: CBM'in iç şemasına bağımlıyız. Tablo/sütun değişirse burası kırılır —
 * bu yüzden hatayı yutmuyoruz, arayüze açıkça bildiriyoruz.
 */

const CACHE_DIR =
  process.env.CBM_CACHE_DIR ?? join(homedir(), ".cache", "codebase-memory-mcp");

export interface GraphNode {
  id: number;
  label: string;
  name: string;
  filePath: string;
  /** Gelen + giden kenar sayısı — düğüm boyutunu belirler. */
  degree: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Sınır nedeniyle gösterilmeyen düğüm sayısı. */
  truncated: number;
  totalNodes: number;
  totalEdges: number;
  availableLabels: string[];
  availableEdgeTypes: string[];
}

function dbPathFor(project: string): string {
  return join(CACHE_DIR, `${project}.db`);
}

export interface GraphQuery {
  /** Yalnızca bu etiketlere sahip düğümler. Boşsa hepsi. */
  labels?: string[];
  /** Yalnızca bu tiplerdeki kenarlar. Boşsa hepsi. */
  edgeTypes?: string[];
  /** Azami düğüm sayısı — en çok bağlantılı olanlar öncelikli. */
  limit?: number;
}

/**
 * Bir projenin grafını okur.
 *
 * Düğümler dereceye göre sıralanıp kırpılır: 5.000 düğümlük bir grafı olduğu
 * gibi tarayıcıya göndermek hem ağı hem de düzen algoritmasını boğar. En çok
 * bağlantılı düğümler mimariyi en iyi anlatanlardır.
 */
export function readGraph(project: string, query: GraphQuery = {}): GraphData {
  const path = dbPathFor(project);
  if (!existsSync(path)) {
    throw new Error(`Bu proje için graf veritabanı bulunamadı: ${project}`);
  }

  const limit = Math.min(Math.max(query.limit ?? 400, 1), 3000);
  const db = new DatabaseSync(path, { readOnly: true });

  try {
    const totalNodes = (
      db.prepare("SELECT count(*) AS n FROM nodes WHERE project = ?").get(project) as {
        n: number;
      }
    ).n;
    const totalEdges = (
      db.prepare("SELECT count(*) AS n FROM edges WHERE project = ?").get(project) as {
        n: number;
      }
    ).n;

    const availableLabels = (
      db
        .prepare(
          "SELECT label, count(*) AS n FROM nodes WHERE project = ? GROUP BY label ORDER BY n DESC",
        )
        .all(project) as Array<{ label: string }>
    ).map((row) => row.label);

    const availableEdgeTypes = (
      db
        .prepare(
          "SELECT type, count(*) AS n FROM edges WHERE project = ? GROUP BY type ORDER BY n DESC",
        )
        .all(project) as Array<{ type: string }>
    ).map((row) => row.type);

    // Etiket süzgeci — parametreleri elle bağlıyoruz, string birleştirmiyoruz.
    const labels = (query.labels ?? []).filter(Boolean);
    const labelClause = labels.length > 0 ? `AND n.label IN (${labels.map(() => "?").join(",")})` : "";

    const nodeRows = db
      .prepare(
        `SELECT n.id, n.label, n.name, n.file_path AS filePath,
                (SELECT count(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) AS degree
         FROM nodes n
         WHERE n.project = ? ${labelClause}
         ORDER BY degree DESC, n.id ASC
         LIMIT ?`,
      )
      .all(project, ...labels, limit) as unknown as GraphNode[];

    const ids = new Set(nodeRows.map((node) => node.id));
    if (ids.size === 0) {
      return {
        nodes: [],
        edges: [],
        truncated: 0,
        totalNodes,
        totalEdges,
        availableLabels,
        availableEdgeTypes,
      };
    }

    const edgeTypes = (query.edgeTypes ?? []).filter(Boolean);
    const typeClause =
      edgeTypes.length > 0 ? `AND e.type IN (${edgeTypes.map(() => "?").join(",")})` : "";
    const idList = [...ids].join(",");

    // Yalnızca iki ucu da görünen düğüm kümesinde olan kenarlar.
    const edges = db
      .prepare(
        `SELECT e.source_id AS source, e.target_id AS target, e.type
         FROM edges e
         WHERE e.project = ? ${typeClause}
           AND e.source_id IN (${idList}) AND e.target_id IN (${idList})`,
      )
      .all(project, ...edgeTypes) as unknown as GraphEdge[];

    return {
      nodes: nodeRows,
      edges,
      truncated: Math.max(0, totalNodes - nodeRows.length),
      totalNodes,
      totalEdges,
      availableLabels,
      availableEdgeTypes,
    };
  } finally {
    db.close();
  }
}
