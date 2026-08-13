import type { StepDefinition, StepStatus } from "../types";

const STATUS_STYLES: Record<StepStatus, { ring: string; dot: string; label: string }> = {
  pending: { ring: "border-[var(--color-edge)] text-gray-500", dot: "bg-gray-600", label: "bekliyor" },
  active: {
    ring: "border-[var(--color-accent)] text-[var(--color-accent)]",
    dot: "bg-[var(--color-accent)]",
    label: "sırada",
  },
  running: {
    ring: "border-[var(--color-accent)] text-[var(--color-accent)] pulse-ring",
    dot: "bg-[var(--color-accent)]",
    label: "çalışıyor",
  },
  done: { ring: "border-emerald-500 text-emerald-400", dot: "bg-emerald-500", label: "tamam" },
  error: { ring: "border-red-500 text-red-400", dot: "bg-red-500", label: "hata" },
};

/**
 * n8n tarzı dikey adım rayı: numaralı düğümler, aralarında bağlantı çizgisi,
 * her düğümde durum rozeti.
 */
export function Stepper({
  steps,
  statuses,
  current,
  onSelect,
}: {
  steps: StepDefinition[];
  statuses: Record<string, StepStatus>;
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0" aria-label="İndeksleme adımları">
      {steps.map((step, index) => {
        const status = statuses[step.id] ?? "pending";
        const style = STATUS_STYLES[status];
        const isCurrent = step.id === current;
        const reachable = status !== "pending" || isCurrent;

        return (
          <div key={step.id}>
            <button
              type="button"
              onClick={() => reachable && onSelect(step.id)}
              disabled={!reachable}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                isCurrent
                  ? "border-[var(--color-edge)] bg-[var(--color-panel)]"
                  : "border-transparent hover:bg-[var(--color-panel)]/60"
              } ${reachable ? "" : "cursor-not-allowed opacity-45"}`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--color-canvas)] font-mono text-sm ${style.ring}`}
              >
                {status === "done" ? "✓" : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-200">
                  {step.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-gray-500">
                  {step.subtitle}
                </span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  <span className="text-[11px] text-gray-500">{style.label}</span>
                </span>
              </span>
            </button>

            {index < steps.length - 1 && (
              <div className="ml-[27px] h-4 w-0.5 bg-[var(--color-edge)]" aria-hidden />
            )}
          </div>
        );
      })}
    </nav>
  );
}
