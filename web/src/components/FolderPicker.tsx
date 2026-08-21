import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFolders } from "../api";
import type { FolderEntry } from "../types";

/**
 * İndeksleme kapsamı için klasör seçici.
 *
 * Büyük monorepo'da (mobil + internet + çağrı merkezi aynı repoda) tüm repoyu
 * indekslemek uzun sürüyor. Burada seçilen klasörler dışındaki dosyalar diske
 * hiç indirilmiyor, dolayısıyla ne yazılıyor ne ayrıştırılıyor.
 *
 * Ağaç isteğe göre açılıyor: bir monorepo'nun kökü `apps/`, `services/` gibi
 * birkaç klasör olabilir, asıl ayrım bir seviye aşağıdadır.
 */
export function FolderPicker({
  repoId,
  branch,
  selected,
  onChange,
  disabled,
}: {
  repoId: string;
  branch: string;
  selected: string[];
  onChange: (folders: string[]) => void;
  disabled?: boolean;
}) {
  const [roots, setRoots] = useState<FolderEntry[]>([]);
  const [children, setChildren] = useState<Record<string, FolderEntry[]>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCounts, setHasCounts] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!repoId || !branch) return;
    setRoots([]);
    setChildren({});
    setExpanded([]);
    setError(null);
    setLoading(true);

    fetchFolders(repoId, branch)
      .then((list) => {
        setRoots(list.folders);
        setHasCounts(list.counts);
      })
      .catch((caught: unknown) => setError(String(caught instanceof Error ? caught.message : caught)))
      .finally(() => setLoading(false));
  }, [repoId, branch]);

  const expand = useCallback(
    async (path: string): Promise<void> => {
      if (expanded.includes(path)) {
        setExpanded((current) => current.filter((p) => p !== path));
        return;
      }
      setExpanded((current) => [...current, path]);
      if (children[path]) return;

      setLoadingPath(path);
      try {
        const list = await fetchFolders(repoId, branch, path);
        setChildren((current) => ({ ...current, [path]: list.folders }));
      } catch (caught) {
        setError(String(caught instanceof Error ? caught.message : caught));
      } finally {
        setLoadingPath(null);
      }
    },
    [branch, children, expanded, repoId],
  );

  /**
   * Bir klasör seçilince alt/üst seçimleri temizliyoruz.
   *
   * sparse-checkout'ta `services` ile `services/api` birlikte anlamsız — üst
   * klasör alt klasörü zaten kapsıyor. Kullanıcı bunu düşünmek zorunda kalmasın.
   */
  const toggle = (path: string): void => {
    if (selected.includes(path)) {
      onChange(selected.filter((p) => p !== path));
      return;
    }
    const kept = selected.filter(
      (p) => !p.startsWith(`${path}/`) && !path.startsWith(`${p}/`),
    );
    onChange([...kept, path].sort());
  };

  const totalFiles = useMemo(() => {
    if (!hasCounts) return -1;
    const all = [...roots, ...Object.values(children).flat()];
    return selected.reduce((sum, path) => {
      const entry = all.find((f) => f.path === path);
      return sum + Math.max(entry?.fileCount ?? 0, 0);
    }, 0);
  }, [children, hasCounts, roots, selected]);

  const visible = (entries: FolderEntry[]): FolderEntry[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.path.toLowerCase().includes(needle));
  };

  const row = (entry: FolderEntry, depth: number): React.ReactNode => {
    const checked = selected.includes(entry.path);
    // Üst klasör seçiliyse alt klasör de kapsam içinde — ayrıca işaretlenmesin.
    const covered = selected.some((p) => entry.path.startsWith(`${p}/`));
    const isOpen = expanded.includes(entry.path);

    return (
      <div key={entry.path}>
        <div
          className={`flex items-center gap-2 rounded px-2 py-1.5 ${
            checked ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel-soft)]"
          }`}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          {entry.hasChildren ? (
            <button
              type="button"
              onClick={() => void expand(entry.path)}
              className="w-4 shrink-0 text-xs text-gray-500 hover:text-gray-300"
              aria-label={isOpen ? "kapat" : "aç"}
            >
              {loadingPath === entry.path ? "·" : isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={checked || covered}
              disabled={disabled || covered}
              onChange={() => toggle(entry.path)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <span
              className={`min-w-0 truncate font-mono text-xs ${
                covered ? "text-gray-500" : "text-gray-200"
              }`}
            >
              {entry.name}
            </span>
            {entry.fileCount >= 0 && (
              <span className="shrink-0 text-[11px] text-gray-600">{entry.fileCount} dosya</span>
            )}
          </label>
        </div>

        {isOpen && children[entry.path] && (
          <div>{visible(children[entry.path]).map((child) => row(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {selected.length === 0 ? (
            <>
              Tüm repo indekslenecek. Klasör seçmek büyük repolarda süreyi belirgin
              şekilde kısaltır.
            </>
          ) : (
            <>
              <span className="text-gray-300">{selected.length} klasör</span> seçili
              {totalFiles > 0 && <> · yaklaşık {totalFiles} dosya</>}
            </>
          )}
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="shrink-0 text-xs text-gray-400 underline hover:text-gray-200"
          >
            seçimi temizle
          </button>
        )}
      </div>

      {roots.length > 8 && (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Klasör ara…"
          className="w-full rounded-md border border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-[var(--color-accent)]"
        />
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-soft)] py-1">
        {loading && <p className="px-3 py-4 text-xs text-gray-500">Klasörler okunuyor…</p>}
        {error && <p className="px-3 py-4 text-xs text-red-300">{error}</p>}
        {!loading && !error && roots.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-500">
            Bu dalda üst düzey klasör bulunamadı — repo kökündeki dosyalar indekslenir.
          </p>
        )}
        {visible(roots).map((entry) => row(entry, 0))}
      </div>

      {!hasCounts && roots.length > 0 && (
        <p className="text-[11px] text-gray-600">
          Dosya sayıları gösterilmiyor: klasörler henüz klon açılmadan Azure DevOps API'si
          üzerinden listelendi. Klon açıldıktan sonra sayımlar görünür.
        </p>
      )}
    </div>
  );
}
