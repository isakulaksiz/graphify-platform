import { useEffect, useRef, useState } from "react";
import { Callout, Panel, Stat } from "../components/ui";
import type { CbmUiStatus, IndexResult, JobState } from "../types";

/**
 * Başarısızlığın nedenini log'dan teşhis eder.
 *
 * Eskiden tek bir genel ipucu vardı ve takılı daemon'ı işaret ediyordu. Büyük
 * repolarda gerçek neden bambaşka çıkıyor — worker'ın bellek yüzünden
 * öldürülmesi — ve kullanıcı yanlış çözümü deniyordu.
 */
function FailureHint({ logs }: { logs: string[] }) {
  const text = logs.join("\n");

  // signal=9 (SIGKILL): worker bellek bütçesini aştığı için öldürüldü.
  if (/signal=9|killed \(exit=-1/.test(text)) {
    return (
      <Callout tone="error" title="İndeksleme başarısız — worker bellek yüzünden öldürüldü">
        <p>
          Log'da <code className="font-mono">killed (exit=-1, signal=9)</code> var. CBM bellek
          bütçesini worker sayısına bölüyor; pay bir dosyayı işlemeye yetmediğinde worker'ı
          öldürüyor. Takılı daemon değil — kurtarma düğmesi bu durumda işe yaramaz.
        </p>
        <p className="mt-2">Sırasıyla deneyin:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>
            <strong>Kapsamı daraltın.</strong> Kapsam adımında yalnızca gereken klasörleri
            seçin — kapsam dışı dosyalar diske hiç inmediği için işlenmiyor da.
          </li>
          <li>
            <strong>Bellek bütçesini yükseltin.</strong> <code>CBM_MEM_BUDGET_MB</code>{" "}
            tanımlıysa kaldırın: CBM RAM'in ~%25'ini kendisi seçer. Elle vermek isterseniz
            makinenin RAM'ine göre yükseltin.
          </li>
          <li>
            <strong>Tek iş parçacığı.</strong> <code>CBM_INDEX_SINGLE_THREAD=1</code> ile tüm
            bütçe tek worker'a gider; yavaşlar ama biter.
          </li>
          <li>
            <strong>Dev dosyaları eleyin.</strong> Üretilmiş tek bir büyük dosya bir worker'ı
            tek başına şişirebilir: <code>CBM_MAX_FILE_BYTES=2000000</code>.
          </li>
        </ol>
      </Callout>
    );
  }

  if (/daemon could not accept this client/.test(text)) {
    return (
      <Callout tone="error" title="İndeksleme başarısız — takılı CBM daemon'ı">
        Daemon istemciyi 30 saniyede kabul edemedi. Aşağıdaki kurtarma düğmesi kalan CBM
        süreçlerini temizler.
      </Callout>
    );
  }

  if (/pre-coordination or unverified CBM generation/.test(text)) {
    return (
      <Callout tone="error" title="İndeksleme başarısız — CBM sürüm kohortu uyuşmuyor">
        Bu durum konteynerin yazılabilir katmanındaki durumdan kaynaklanıyor;{" "}
        <code>docker compose restart</code> yetmez,{" "}
        <code>docker compose up -d --force-recreate</code> gerekir. Graf kaybolmaz.
      </Callout>
    );
  }

  return (
    <Callout tone="error" title="İndeksleme başarısız">
      Log'un sonuna bakın. Takılı bir CBM daemon'ı söz konusuysa aşağıdaki kurtarma düğmesini
      kullanın.
    </Callout>
  );
}

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

        {state === "failed" && <FailureHint logs={logs} />}

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

            <div className="mt-3 border-t border-[var(--color-edge)] pt-3">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] text-gray-400">
                  {cbmUi.url}
                </code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(cbmUi.url)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-[var(--color-canvas)] hover:text-gray-200"
                >
                  kopyala
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Yeni sekmede açılır — CBM <code>frame-ancestors &apos;none&apos;</code> CSP
                başlığı gönderdiği için arayüze gömülemiyor. Gömülü bir tarayıcı panelinde
                çalışıyorsanız adresi kopyalayıp kendi tarayıcınızda açın; panelde geri dönmek
                zor olabiliyor.
              </p>
            </div>
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
