import { Callout, Panel } from "../components/ui";
import type { PrecheckResult } from "../types";

export function PrecheckStep({
  result,
  running,
  error,
  footer,
}: {
  result: PrecheckResult | null;
  running: boolean;
  error: string | null;
  footer: React.ReactNode;
}) {
  return (
    <Panel
      title="Ön kontrol"
      description="İndekslemeden önce yolun ve reponun uygunluğu doğrulanır."
      footer={footer}
    >
      <div className="max-w-xl space-y-4">
        {error && <Callout tone="error" title="Ön kontrol başarısız">{error}</Callout>}

        {running && (
          <p className="text-sm text-gray-400">
            Kaynak kod hazırlanıyor (klonlama/güncelleme) ve kontroller çalışıyor…
          </p>
        )}

        {result && (
          <>
            <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {result.action === "cloned"
                  ? "Klonlandı"
                  : result.action === "updated"
                    ? "Mevcut klon güncellendi"
                    : "Yerel repo kullanıldı"}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-gray-300">{result.path}</p>
              {result.sha && (
                <p className="mt-1 font-mono text-xs text-gray-500">
                  HEAD {result.sha.slice(0, 10)}
                  {result.fileCount > 0 && ` · ${result.fileCount} dosya`}
                </p>
              )}
              {/* Kapsam burada teyit ediliyor: seçim gerçekten uygulandı mı,
                  diske kaç dosya indi. */}
              <p className="mt-2 text-xs text-gray-400">
                {result.folders.length === 0 ? (
                  "Kapsam: tüm repo"
                ) : (
                  <>
                    Kapsam:{" "}
                    {result.folders.map((folder) => (
                      <span
                        key={folder}
                        className="mr-1 inline-block rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px] text-gray-300"
                      >
                        {folder}
                      </span>
                    ))}
                  </>
                )}
              </p>
            </div>
            <ul className="space-y-2">
              {result.checks.map((check) => (
                <li
                  key={check.name}
                  className="flex items-start gap-3 rounded-lg border border-[var(--color-edge)] px-4 py-3"
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      check.ok ? "bg-emerald-950 text-emerald-400" : "bg-red-950 text-red-400"
                    }`}
                  >
                    {check.ok ? "✓" : "✕"}
                  </span>
                  <span>
                    <span className="block text-sm text-gray-200">{check.name}</span>
                    {check.note && (
                      <span className="mt-0.5 block text-xs text-gray-500">{check.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {result.ready ? (
              <Callout tone="info" title="Hazır">
                İndeksleme başlatılabilir.
              </Callout>
            ) : (
              <Callout tone="warn" title="Eksik var">
                Yukarıdaki başarısız kontrolleri düzeltmeden devam etmeniz önerilmez.
              </Callout>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
