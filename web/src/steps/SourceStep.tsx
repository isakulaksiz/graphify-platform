import { useMemo, useState } from "react";
import { AzdoConnect } from "../components/AzdoConnect";
import { Callout, Panel, TextInput } from "../components/ui";
import type { AzdoStatus, RepoSummary } from "../types";

export function SourceStep({
  repos,
  azdo,
  loading,
  error,
  selected,
  onSelect,
  onAzdoChange,
  footer,
}: {
  repos: RepoSummary[];
  azdo: AzdoStatus | null;
  loading: boolean;
  error: string | null;
  selected: RepoSummary | null;
  onSelect: (repo: RepoSummary) => void;
  onAzdoChange: (status: AzdoStatus) => void;
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
            {filtered.map((repo) => {
              const isSelected = selected?.id === repo.id;
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(repo)}
                    className={`flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20"
                        : "border-[var(--color-edge)] hover:bg-[var(--color-panel-soft)]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-gray-100">{repo.name}</span>
                        {repo.indexedAs && (
                          <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            indekslenmiş
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
