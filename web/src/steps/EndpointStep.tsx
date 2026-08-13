import { Callout, CopyBox, Panel } from "../components/ui";
import type { EndpointInfo } from "../types";

export function EndpointStep({
  endpoint,
  footer,
}: {
  endpoint: EndpointInfo | null;
  footer: React.ReactNode;
}) {
  if (!endpoint) {
    return (
      <Panel title="MCP endpoint" description="İndeksleme tamamlandığında burada görünecek.">
        <p className="text-sm text-gray-500">Henüz endpoint üretilmedi.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="MCP endpoint"
      description="Bu adresleri kod asistanınıza tanımlayın. Bağlantı yalnızca bu repoya erişir."
      footer={footer}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyBox label="Streamable HTTP (tercih edilen)" value={endpoint.streamableHttpUrl} />
          <CopyBox label="SSE (eski istemciler)" value={endpoint.sseUrl} />
        </div>

        {endpoint.authMode === "none" ? (
          <Callout tone="info" title="Token gerekmiyor">
            Gateway <code>GATEWAY_AUTH=none</code> modunda — adresi yapıştırmanız yeterli,
            header eklemeyin. Ağdan erişebilen herkes bağlanabilir; kuruma açarken{" "}
            <code>bearer</code> moduna alın.
          </Callout>
        ) : (
          <Callout tone="warn" title="Token ayrıca üretilmeli">
            Snippet'lerdeki <code>&lt;TOKEN&gt;</code> yerine size atanan bearer token'ı yazın.
          </Callout>
        )}

        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">İstemci yapılandırmaları</p>
          {Object.entries(endpoint.snippets).map(([name, snippet]) => (
            <CopyBox key={name} label={name} value={snippet} />
          ))}
        </div>

        <div className="rounded-lg border border-[var(--color-edge)] px-4 py-3 text-sm text-gray-400">
          <p className="mb-1 font-medium text-gray-300">Bu bağlantıda neler var</p>
          <p className="text-[13px]">
            12 salt okunur araç. <code>index_repository</code>, <code>delete_project</code> ve{" "}
            <code>ingest_traces</code> gateway tarafından engellenir; <code>project</code> argümanı
            sabitlenmiştir ve <code>list_projects</code> yalnızca bu repoyu döndürür.
          </p>
        </div>
      </div>
    </Panel>
  );
}
