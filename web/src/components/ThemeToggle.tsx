import type { ThemeChoice } from "../theme";

const OPTIONS: Array<{ id: ThemeChoice; label: string; title: string }> = [
  { id: "light", label: "Açık", title: "Açık tema" },
  { id: "dark", label: "Koyu", title: "Koyu tema" },
  { id: "system", label: "Sistem", title: "İşletim sisteminin tercihini izle" },
];

/** Üç durumlu tema seçici — açık, koyu, sistemi izle. */
export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Tema"
      className="flex items-center gap-0.5 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.title}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            value === option.id
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
