import { useMemo, useState } from "react";
import { deleteProject } from "../api";
import { AzdoConnect } from "../components/AzdoConnect";
import { Callout, Panel, TextInput } from "../components/ui";
import type { AzdoStatus, IndexedEntry, RepoSummary } from "../types";

/**
 * Tek repo satırı.
 *
 * Kart tıklanabilir olduğu için seçim alanı ve silme düğmesi KARDEŞ elemanlar;
 * butonu butonun içine koymak geçersiz HTML olurdu ve tıklamalar çakışırdı.
 */
/**
 * Bir repodan çıkarılmış tek grafın satırı.
 *
 * Bir repo birden çok klasör kapsamıyla indekslenmiş olabilir; her kapsam ayrı
 * graf, ayrı MCP adresi, ayrı silme. Tek bir "indekslenmiş" etiketi hangi
 * kapsamın var olduğunu söylemiyordu.
 */
function IndexedRow({ entry, onDeleted }: { entry: IndexedEntry; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteProject(entry.project);
      setConfirming(false);
      onDeleted();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-2 border-l border-[var(--color-edge)] pl-3">
      <div className="flex items-center gap-2 py-1">
        <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
          indekslenmiş
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
          {entry.folders.length === 0 ? (
            "tüm repo"
          ) : (
            <>
              kapsam{" "}
              {entry.folders.map((folder) => (
                <code
                  key={folder}
                  className="mr-1 rounded bg-[var(--color-panel-soft)] px-1 py-0.5 font-mono text-[11px] text-gray-300"
                >
                  {folder}
                </code>
              ))}
            </>
          )}
          <span className="ml-1 text-gray-600">
            · {entry.nodes} node / {entry.edges} edge
          </span>
        </span>

        {confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-lg bg-red-900/70 px-2.5 py-1 text-xs font-medium text-red-100 hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? "…" : "Evet"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
            >
              vazgeç
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-lg border border-[var(--color-edge)] px-2.5 py-1 text-xs text-gray-400 hover:border-red-900 hover:bg-red-950/40 hover:text-red-300"
          >
            İndeksi sil
          </button>
        )}
      </div>

      {confirming && (
        <p className="pb-1 text-xs text-amber-300/80">
          Bu grafın MCP adresi çalışmayı bırakacak. Kaynak kod klonu diskte kalır.
        </p>
      )}
      {error && <p className="pb-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Tek repo satırı.
 *
 * Kart tıklanabilir olduğu için seçim alanı ve indeks satırları KARDEŞ
 * elemanlar; butonu butonun içine koymak geçersiz HTML olurdu.
 */
function RepoRow({
  repo,
  selected,
  onSelect,
  onDeleted,
}: {
  repo: RepoSummary;
  selected: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const entries = repo.indexed ?? [];

  return (
    <li>
      <div
        className={`rounded-lg border px-2 py-1 transition-colors ${
          selected
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20"
            : "border-[var(--color-edge)] hover:bg-[var(--color-panel-soft)]"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full min-w-0 items-center justify-between gap-4 px-2 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-gray-100">{repo.name}</span>
              {entries.length > 1 && (
                <span className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 text-[10px] text-gray-400">
                  {entries.length} graf
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate font-mono text-xs text-gray-500">
              {repo.localPath ?? repo.project ?? repo.webUrl}
            </span>
          </span>
          <span className="shrink-0 rounded border border-[var(--color-edge)] px-2 py-1 text-[11px] text-gray-400">
            {repo.source === "local" ? "yerel" : "Azure DevOps"}
          </span>
        </button>

        {entries.map((entry) => (
          <IndexedRow key={entry.project} entry={entry} onDeleted={onDeleted} />
        ))}
      </div>
    </li>
  );
}

export function SourceStep({
  repos,
  azdo,
  loading,
  error,
  selected,
  onSelect,
  onAzdoChange,
  onReload,
  footer,
}: {
  repos: RepoSummary[];
  azdo: AzdoStatus | null;
  loading: boolean;
  error: string | null;
  selected: RepoSummary | null;
  onSelect: (repo: RepoSummary) => void;
  onAzdoChange: (status: AzdoStatus) => void;
  onReload: () => void;
  footer: React.ReactNode;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(needle) ||
        (repo.project ?? "").toLowerCase().includes(needle),
    );
  }, [repos, query]);

  return (
    <Panel
      title="Kaynak seçimi"
      description="İndekslenecek repoyu seçin. Azure DevOps repoları ve diskteki yerel kopyalar birlikte listelenir."
      footer={footer}
    >
      <div className="space-y-4">
        {azdo && <AzdoConnect status={azdo} onChange={onAzdoChange} />}
        {error && <Callout tone="error" title="Repo listesi alınamadı">{error}</Callout>}

        <TextInput value={query} onChange={setQuery} placeholder="Repo ara…" />

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-500">Repolar yükleniyor…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Repo bulunamadı. <code className="text-gray-400">LOCAL_REPO_ROOTS</code> ayarını veya
            Azure DevOps PAT'ini kontrol edin.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((repo) => (
              <RepoRow
                key={repo.id}
                repo={repo}
                selected={selected?.id === repo.id}
                onSelect={() => onSelect(repo)}
                onDeleted={onReload}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
