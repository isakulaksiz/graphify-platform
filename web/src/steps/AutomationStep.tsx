import { Button, Callout, CopyBox, Panel } from "../components/ui";
import type { RepoSummary, WatchState } from "../types";

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds} sn önce`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk önce`;
  return new Date(iso).toLocaleString("tr-TR");
}

export function AutomationStep({
  repo,
  branch,
  watch,
  busy,
  error,
  onStart,
  onStop,
  footer,
}: {
  repo: RepoSummary;
  branch: string;
  watch: WatchState | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  footer: React.ReactNode;
}) {
  const subscription = JSON.stringify(
    {
      publisherId: "tfs",
      eventType: "git.push",
      resourceVersion: "1.0",
      consumerId: "webHooks",
      consumerActionId: "httpRequest",
      publisherInputs: {
        repository: repo.id.startsWith("local:") ? "<repositoryId>" : repo.id,
        branch,
        projectId: "<projectId>",
      },
      consumerInputs: {
        url: "https://graphify.internal/webhooks/azdo",
        basicAuthUsername: "azdo",
        basicAuthPassword: "<WEBHOOK_SECRET>",
      },
    },
    null,
    2,
  );

  return (
    <Panel
      title="Otomasyon"
      description={`'${branch}' dalı değiştiğinde graf kendiliğinden güncellensin.`}
      footer={footer}
    >
      <div className="space-y-4">
        {error && <Callout tone="error" title="İzleme başlatılamadı">{error}</Callout>}

        <div
          className={`rounded-lg border px-4 py-4 ${
            watch
              ? "border-emerald-900 bg-emerald-950/30"
              : "border-[var(--color-edge)] bg-[var(--color-panel-soft)]"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-gray-100">
                <span
                  className={`h-2 w-2 rounded-full ${
                    watch ? "bg-emerald-400" : "bg-gray-600"
                  }`}
                />
                {watch ? "Otomatik güncelleme açık" : "Otomatik güncelleme kapalı"}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {watch
                  ? `${watch.branch} dalı düzenli aralıkla kontrol ediliyor; sha değişince indeksleme kuyruğa alınıyor.`
                  : "Açıldığında dal düzenli kontrol edilir ve her yeni commit'te graf yeniden çıkarılır."}
              </p>
            </div>
            <Button
              variant={watch ? "ghost" : "primary"}
              onClick={watch ? onStop : onStart}
              disabled={busy}
            >
              {busy ? "…" : watch ? "Durdur" : "İzlemeyi başlat"}
            </Button>
          </div>

          {watch && (
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-emerald-900/60 pt-3 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Son bilinen commit</dt>
                <dd className="font-mono text-gray-300">
                  {watch.lastSha ? watch.lastSha.slice(0, 10) : "okunuyor…"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Durum</dt>
                <dd className="text-gray-300">
                  {watch.pending ? "değişiklik görüldü, bekliyor" : "değişiklik yok"}
                </dd>
              </div>
              {watch.lastTrigger && (
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt className="text-gray-500">Son tetikleme</dt>
                  <dd className="text-gray-300">
                    {relativeTime(watch.lastTrigger.at)} ·{" "}
                    <span className="font-mono">{watch.lastTrigger.sha.slice(0, 10)}</span> ·{" "}
                    {watch.lastTrigger.source === "webhook" ? "webhook" : "yoklama"}
                  </dd>
                </div>
              )}
              {watch.lastError && (
                <div className="sm:col-span-2">
                  <dd className="text-red-300">{watch.lastError}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        <Callout tone="info" title="İki tetikleme yolu birlikte çalışır">
          <p>
            <strong>Yoklama</strong> dalı düzenli kontrol eder — dışarıya açık adres
            gerektirmez, lokalde de çalışır. <strong>Webhook</strong> ise push anında haber
            verir; Azure DevOps'un alıcıya erişebilmesi için platformun ulaşılabilir bir
            adreste olması gerekir. İkisi de aynı birleştirme penceresini kullanır.
          </p>
        </Callout>

        <Callout tone="warn" title="Azure DevOps HMAC imzası desteklemiyor">
          GitHub'dan farklı olarak service hook'lar imzalı gövde göndermez. Alıcı doğrulaması{" "}
          <strong>basic auth + IP allowlist</strong> ile yapılır — alıcı{" "}
          <code>WEBHOOK_SECRET</code> tanımlıysa basic auth parolasını kontrol eder.
        </Callout>

        <CopyBox
          label="Webhook aboneliği — POST https://dev.azure.com/{org}/_apis/hooks/subscriptions?api-version=7.1"
          value={subscription}
        />
      </div>
    </Panel>
  );
}
