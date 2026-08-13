import { useState } from "react";
import { clearAzdoCredentials, saveAzdoCredentials } from "../api";
import { Button, Callout, Field, TextInput } from "./ui";
import type { AzdoStatus } from "../types";

/**
 * Azure DevOps bağlantı formu.
 *
 * PAT doğrudan sunucuya gider, orada yalnızca bellekte tutulur ve hiçbir
 * yanıtta geri dönmez. Arayüz de saklamaz — gönderdikten sonra alan temizlenir.
 */
export function AzdoConnect({
  status,
  onChange,
}: {
  status: AzdoStatus;
  onChange: (status: AzdoStatus) => void;
}) {
  const [org, setOrg] = useState(status.org ?? "");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await saveAzdoCredentials(org, pat);
      setPat(""); // token'ı bellekte tutma
      onChange(next);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      onChange(await clearAzdoCredentials());
    } finally {
      setBusy(false);
    }
  };

  if (status.configured) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3">
        <div className="text-sm">
          <p className="font-medium text-emerald-200">
            Azure DevOps bağlı — dev.azure.com/{status.org}
          </p>
          <p className="mt-0.5 text-xs text-emerald-300/70">
            Token kaynağı: {status.source === "env" ? "ortam değişkeni" : "arayüzden girildi"}
          </p>
        </div>
        <Button variant="ghost" onClick={() => void disconnect()} disabled={busy}>
          Bağlantıyı kes
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-4">
      <div>
        <p className="text-sm font-medium text-amber-200">Azure DevOps bağlantısı yok</p>
        <p className="mt-0.5 text-xs text-amber-300/80">{status.reason}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Organizasyon">
          <TextInput value={org} onChange={setOrg} placeholder="organizasyon-adi" />
        </Field>
        <Field label="Personal Access Token">
          <input
            type="password"
            value={pat}
            onChange={(event) => setPat(event.target.value)}
            placeholder="••••••••••••"
            autoComplete="off"
            className="w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
      </div>

      <p className="text-xs text-gray-500">
        Token yalnızca sunucunun belleğinde tutulur; diske yazılmaz ve geri okunamaz.{" "}
        <span className="text-gray-400">Scope: Code (Read)</span> yeterli — klonlama da
        gerekiyorsa Code (Read &amp; Write).
      </p>

      {error && <Callout tone="error" title="Bağlanılamadı">{error}</Callout>}

      <div className="flex justify-end">
        <Button onClick={() => void connect()} disabled={busy || !org.trim() || !pat}>
          {busy ? "Doğrulanıyor…" : "Bağlan ve repoları listele"}
        </Button>
      </div>
    </div>
  );
}
