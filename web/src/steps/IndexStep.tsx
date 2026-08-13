import { useEffect, useRef } from "react";
import { Callout, Panel, Stat } from "../components/ui";
import type { IndexResult, JobState } from "../types";

export function IndexStep({
  state,
  logs,
  result,
  footer,
}: {
  state: JobState | null;
  logs: string[];
  result: IndexResult | null;
  footer: React.ReactNode;
}) {
  const logRef = useRef<HTMLDivElement>(null);

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

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Canlı log</p>
          <div
            ref={logRef}
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
