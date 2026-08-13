import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)]">
      <header className="border-b border-[var(--color-edge)] px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-400">{description}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-3 border-t border-[var(--color-edge)] px-6 py-4">
          {footer}
        </footer>
      )}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}) {
  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-[var(--color-accent)] text-gray-950 hover:bg-orange-400"
      : "border border-[var(--color-edge)] text-gray-300 hover:bg-[var(--color-panel-soft)]";
  return (
    <button type="button" className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-300">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[var(--color-accent)] ${
        mono ? "font-mono text-xs" : ""
      }`}
    />
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error";
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    info: "border-sky-900 bg-sky-950/40 text-sky-200",
    warn: "border-amber-900 bg-amber-950/40 text-amber-200",
    error: "border-red-900 bg-red-950/40 text-red-200",
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-[13px] opacity-90">{children}</div>}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-xl text-gray-100">{value}</p>
    </div>
  );
}

export function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)]">
      <div className="flex items-center justify-between border-b border-[var(--color-edge)] px-3 py-2">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(value)}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-[var(--color-panel-soft)] hover:text-gray-200"
        >
          kopyala
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-gray-300">
        {value}
      </pre>
    </div>
  );
}
