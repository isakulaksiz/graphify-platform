import { useEffect, useRef, useState } from "react";
import { Callout, Panel, Stat } from "../components/ui";
import type { CbmUiStatus, IndexResult, JobState } from "../types";

export function IndexStep({
  state,
  logs,
  result,
  cbmUi,
  footer,
}: {
  state: JobState | null;
  logs: string[];
  result: IndexResult | null;
  cbmUi: CbmUiStatus | null;
  footer: React.ReactNode;
}) {
  const logRef = useRef<HTMLDivElement>(null);
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

        {state === "succeeded" && cbmUi && (
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100">Kod grafını incele</p>
                <p className="mt-1 text-xs text-gray-400">
                  codebase-memory-mcp'nin 3D graf arayüzü — node tipi ve ilişki süzgeçleri,
                  ölü kod tespiti, klasör ağacı.
                </p>
              </div>
              {cbmUi.available ? (
                <a
                  href={cbmUi.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-gray-950 hover:bg-orange-400"
                >
                  Grafı aç ↗
                </a>
              ) : (
                <span className="shrink-0 rounded-lg border border-[var(--color-edge)] px-4 py-2 text-sm text-gray-500">
                  arayüz kapalı
                </span>
              )}
            </div>

            {!cbmUi.available && cbmUi.reason && (
              <p className="mt-3 border-t border-[var(--color-edge)] pt-3 text-xs text-amber-300/80">
                {cbmUi.reason}
              </p>
            )}

            <p className="mt-3 border-t border-[var(--color-edge)] pt-3 text-xs text-gray-500">
              Yeni sekmede açılır — CBM <code>frame-ancestors &apos;none&apos;</code> CSP
              başlığı gönderdiği için arayüze gömülemiyor.
            </p>
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
