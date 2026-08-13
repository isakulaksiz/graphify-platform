import { useEffect, useRef, useState } from "react";
import { GraphView } from "../components/GraphView";
import { Button, Callout, Panel, Stat } from "../components/ui";
import type { GraphData, IndexResult, JobState } from "../types";

export function IndexStep({
  state,
  logs,
  result,
  graph,
  graphLoading,
  graphError,
  onLoadGraph,
  footer,
}: {
  state: JobState | null;
  logs: string[];
  result: IndexResult | null;
  graph: GraphData | null;
  graphLoading: boolean;
  graphError: string | null;
  onLoadGraph: (limit: number) => void;
  footer: React.ReactNode;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(150);
  const [logsOpen, setLogsOpen] = useState(false);

  // Yeni satır geldikçe otomatik aşağı kaydır.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  return (
    <Panel
      title="İndeksleme"
      description="Kod grafı çıkarılıyor. İlerleme canlı olarak akıyor."
      footer={footer}
    >
      <div className="space-y-4">
        {result && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Node" value={result.nodes.toLocaleString("tr-TR")} />
            <Stat label="Edge" value={result.edges.toLocaleString("tr-TR")} />
            <Stat label="Durum" value={result.status} />
            <Stat label="Atlanan dosya" value={result.skippedCount} />
          </div>
        )}

        {result && result.excludedDirs.length > 0 && (
          <Callout tone="warn" title="İndekslenmeyen dizinler">
            <code className="font-mono">{result.excludedDirs.join(", ")}</code>
            <p className="mt-1">
              Bunlar grafta yok. CBM <code>deploy</code> gibi bazı dizin adlarını hardcoded
              olarak eler — manifestleriniz oradaysa graf sessizce eksik çıkar.
            </p>
          </Callout>
        )}

        {state === "failed" && (
          <Callout tone="error" title="İndeksleme başarısız">
            Log'un sonuna bakın. <em>“daemon could not accept this client within 30000 ms”</em>{" "}
            hatası görüyorsanız takılı bir CBM daemon'ı vardır — aşağıdaki kurtarma düğmesini
            kullanın.
          </Callout>
        )}

        {state === "succeeded" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-gray-500">Kod grafı</p>
              <div className="flex items-center gap-2">
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)] px-2 py-1 text-xs text-gray-300 outline-none"
                >
                  <option value={80}>en bağlantılı 80 düğüm</option>
                  <option value={150}>en bağlantılı 150 düğüm</option>
                  <option value={300}>en bağlantılı 300 düğüm</option>
                  <option value={600}>en bağlantılı 600 düğüm</option>
                </select>
                <Button variant="ghost" onClick={() => onLoadGraph(limit)} disabled={graphLoading}>
                  {graphLoading ? "yükleniyor…" : graph ? "yenile" : "grafı göster"}
                </Button>
              </div>
            </div>

            {graphError && <Callout tone="error" title="Graf okunamadı">{graphError}</Callout>}

            {graph && (
              <>
                <GraphView data={graph} />
                <p className="text-xs text-gray-500">
                  {graph.nodes.length} düğüm ve {graph.edges.length} kenar gösteriliyor
                  {graph.truncated > 0 && ` · ${graph.truncated} düğüm kırpıldı`}. Düğüm boyutu
                  bağlantı sayısını gösterir; en bağlantılı düğümler mimarinin omurgasıdır.
                </p>
              </>
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setLogsOpen((previous) => !previous)}
            className="mb-2 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-300"
          >
            {logsOpen ? "▾" : "▸"} Canlı log
          </button>
          <div
            ref={logRef}
            hidden={!logsOpen && state === "succeeded"}
            className="h-72 overflow-y-auto rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)] p-3 font-mono text-[11px] leading-relaxed text-gray-400"
          >
            {logs.length === 0 ? (
              <p className="text-gray-600">Henüz çıktı yok…</p>
            ) : (
              logs.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap break-all">
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
