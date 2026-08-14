import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteProject, fetchCatalog } from "../api";
import { Button, Callout, TextInput } from "../components/ui";
import type { CatalogEntry, CatalogResponse } from "../types";

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "bugün";
  if (days === 1) return "dün";
  if (days < 30) return `${days} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Adresi ve yanında kopyala düğmesini gösterir. */
function UrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 text-xs text-gray-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] text-gray-300">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-[var(--color-canvas)] hover:text-gray-200"
      >
        {copied ? "kopyalandı" : "kopyala"}
      </button>
    </div>
  );
}

function ProjectCard({
  entry,
  authMode,
  cbmUiAvailable,
  onDeleted,
}: {
  entry: CatalogEntry;
  authMode: "none" | "bearer";
  cbmUiAvailable: boolean;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteProject(entry.project);
      onDeleted();
    } catch (caught) {
      setError(String(caught));
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-100">
            {entry.displayName}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-gray-600">
            {entry.project}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>
              <span className="text-gray-300">{entry.nodes.toLocaleString("tr-TR")}</span> node
            </span>
            <span>
              <span className="text-gray-300">{entry.edges.toLocaleString("tr-TR")}</span> edge
            </span>
            <span>{formatSize(entry.sizeBytes)}</span>
            {entry.branch && <span className="font-mono">{entry.branch}</span>}
            {entry.autoUpdate.enabled ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                otomatik güncelleme açık
              </span>
            ) : (
              <span className="text-gray-600">otomatik güncelleme kapalı</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {cbmUiAvailable && (
            <a
              href={entry.graphUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--color-edge)] px-3 py-1.5 text-xs text-gray-300 hover:bg-[var(--color-panel-soft)]"
            >
              Graf ↗
            </a>
          )}
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-[var(--color-edge)] px-3 py-1.5 text-xs text-gray-400 hover:border-red-900 hover:bg-red-950/40 hover:text-red-300"
            >
              Sil
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-lg bg-red-900/70 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800 disabled:opacity-50"
              >
                {busy ? "siliniyor…" : "Evet, sil"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
              >
                vazgeç
              </button>
            </span>
          )}
        </div>
      </header>

      {entry.lastCommit && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[var(--color-edge)] pt-3 text-xs text-gray-500">
          <span className="font-mono text-gray-400">{entry.lastCommit.shortSha}</span>
          <span className="min-w-0 truncate text-gray-300">{entry.lastCommit.subject}</span>
          <span>· {entry.lastCommit.author}</span>
          <span>· {relativeDate(entry.lastCommit.date)}</span>
        </p>
      )}

      {confirming && !busy && (
        <p className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          Graf silinecek ve bu adresler çalışmayı bırakacak. Kaynak kod klonu diskte
          kalır; istenirse yeniden indekslenebilir.
        </p>
      )}

      {error && (
        <div className="mt-3">
          <Callout tone="error" title="Silinemedi">{error}</Callout>
        </div>
      )}

      <div className="mt-4 space-y-1.5 border-t border-[var(--color-edge)] pt-4">
        <UrlRow label="Streamable HTTP" url={entry.streamableHttpUrl} />
        <UrlRow label="SSE" url={entry.sseUrl} />
        <UrlRow
          label="Claude Code"
          url={
            authMode === "bearer"
              ? `claude mcp add --transport http graphify ${entry.streamableHttpUrl} --header "Authorization: Bearer <TOKEN>"`
              : `claude mcp add --transport http graphify ${entry.streamableHttpUrl}`
          }
        />
        <UrlRow
          label="Codex CLI"
          url={
            authMode === "bearer"
              ? `[mcp_servers.graphify]\nurl = "${entry.streamableHttpUrl}"\nhttp_headers = { Authorization = "Bearer <TOKEN>" }`
              : `[mcp_servers.graphify]\nurl = "${entry.streamableHttpUrl}"`
          }
        />
        <UrlRow
          label="VS Code Copilot"
          url={JSON.stringify(
            {
              servers: {
                graphify: {
                  type: "http",
                  url: entry.streamableHttpUrl,
                  ...(authMode === "bearer"
                    ? { headers: { Authorization: "Bearer <TOKEN>" } }
                    : {}),
                },
              },
            },
            null,
            2,
          )}
        />
      </div>
    </article>
  );
}

/**
 * Katalog ekranı — geliştiricilerle paylaşılan sayfa.
 *
 * Bir geliştirici bunu açar, kendi reposunu bulur, MCP adresini kopyalar.
 * Ayrıca artık gerekmeyen graflar buradan silinir.
 */
export function CatalogView() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback((): void => {
    setLoading(true);
    fetchCatalog()
      .then(setData)
      .catch((caught: unknown) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const projects = data?.projects ?? [];
    if (!needle) return projects;
    return projects.filter(
      (p) =>
        p.displayName.toLowerCase().includes(needle) ||
        p.project.toLowerCase().includes(needle) ||
        p.rootPath.toLowerCase().includes(needle),
    );
  }, [data, query]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">İndekslenmiş projeler</h2>
          <p className="mt-1 text-sm text-gray-400">
            Kendi reponuzu bulup MCP adresini kod asistanınıza tanımlayın.
            {data && data.authMode === "none" && " Token gerekmiyor."}
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? "yükleniyor…" : "yenile"}
        </Button>
      </header>

      {error && <Callout tone="error" title="Katalog alınamadı">{error}</Callout>}

      {data && data.projects.length > 3 && (
        <div className="mb-4 max-w-md">
          <TextInput value={query} onChange={setQuery} placeholder="Proje ara…" />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {loading && !data ? (
          <p className="py-12 text-center text-sm text-gray-500">Yükleniyor…</p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            {data?.projects.length === 0
              ? "Henüz indekslenmiş proje yok. İndeksleme sekmesinden başlayın."
              : "Eşleşen proje yok."}
          </p>
        ) : (
          filtered.map((entry) => (
            <ProjectCard
              key={entry.project}
              entry={entry}
              authMode={data?.authMode ?? "bearer"}
              cbmUiAvailable={data?.cbmUiAvailable ?? false}
              onDeleted={load}
            />
          ))
        )}
      </div>
    </section>
  );
}
