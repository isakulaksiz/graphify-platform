import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Aranabilir dal seçici.
 *
 * Kurumsal repolarda yüzlerce dal olabildiği için düz `<select>` yerine
 * filtrelenebilir bir liste kullanıyoruz.
 */
export function BranchSelect({
  branches,
  value,
  onChange,
  loading,
  error,
  defaultBranch,
}: {
  branches: string[];
  value: string;
  onChange: (branch: string) => void;
  loading: boolean;
  error: string | null;
  defaultBranch?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Dışarı tıklayınca kapat.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) => branch.toLowerCase().includes(needle));
  }, [branches, query]);

  const select = (branch: string): void => {
    onChange(branch);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={loading || branches.length === 0}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)] px-3 py-2 text-left text-sm text-gray-100 outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
      >
        <span className="truncate font-mono">
          {loading ? "dallar yükleniyor…" : value || "dal seçin"}
        </span>
        <span className="ml-2 shrink-0 text-xs text-gray-500">
          {branches.length > 0 && `${branches.length} dal`} ▾
        </span>
      </button>

      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Dal ara…"
            className="w-full border-b border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-3 py-2 text-sm text-gray-100 outline-none"
          />
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">Eşleşen dal yok.</li>
            ) : (
              filtered.map((branch) => (
                <li key={branch}>
                  <button
                    type="button"
                    onClick={() => select(branch)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-sm hover:bg-[var(--color-panel-soft)] ${
                      branch === value ? "text-[var(--color-accent)]" : "text-gray-300"
                    }`}
                  >
                    <span className="truncate">{branch}</span>
                    {branch === defaultBranch && (
                      <span className="shrink-0 rounded bg-[var(--color-panel-soft)] px-1.5 py-0.5 font-sans text-[10px] text-gray-400">
                        varsayılan
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
