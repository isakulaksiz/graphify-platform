import { homedir } from "node:os";
import { join } from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Zorunlu ortam değişkeni eksik: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} sayı olmalı, gelen: ${raw}`);
  }
  return parsed;
}

/**
 * Kimlik doğrulama modu.
 *
 * `none`  — token istenmez, her istek tüm projelere yetkili sayılır.
 *           Yalnızca güvenilir ağda (lokal geliştirme) kullanın: gateway'e
 *           erişebilen herkes her repoyu okuyabilir.
 * `bearer` — `Authorization: Bearer <token>` zorunlu, token → proje eşlemesi
 *           GATEWAY_TOKENS'tan okunur. Üretim için bu.
 *
 * Mod ne olursa olsun proje kapsamlaması ve araç allowlist'i uygulanır —
 * bunlar kimlik doğrulamadan bağımsız, URL bazlı yönlendirme kuralları.
 */
export type AuthMode = "none" | "bearer";

export interface Config {
  port: number;
  host: string;
  authMode: AuthMode;
  /** codebase-memory-mcp çalıştırılabilir dosyasının yolu. */
  cbmBinary: string;
  /**
   * CBM'in graf veritabanı dizini.
   *
   * OpenShift'te bu MUTLAKA PVC üzerindeki bir yola sabitlenmeli:
   * rastgele UID ile çalışan container'da $HOME yazılabilir olmayabilir.
   */
  cbmCacheDir: string;
  /** index_repository'yi bu dizinin altına hapseder. Çok kiracılı kurulumda şart. */
  cbmAllowedRoot?: string;
  /** cgroup limitleri yanlış okunduğu için container'da elle verilmeli. */
  cbmWorkers?: string;
  cbmMemBudgetMb?: string;
  /** Upstream CBM süreci bu kadar ms yanıt vermezse ölü sayılır ve yeniden başlatılır. */
  upstreamHealthTimeoutMs: number;
  /** Sağlık kontrolü aralığı. */
  upstreamHealthIntervalMs: number;
  /** Bir HTTP oturumu bu kadar ms boşta kalırsa kapatılır. */
  sessionIdleTimeoutMs: number;
}

function authMode(): AuthMode {
  const raw = (process.env.GATEWAY_AUTH ?? "none").toLowerCase();
  if (raw !== "none" && raw !== "bearer") {
    throw new Error(`GATEWAY_AUTH 'none' veya 'bearer' olmalı, gelen: ${raw}`);
  }
  return raw;
}

export function loadConfig(): Config {
  return {
    port: int("PORT", 8080),
    host: process.env.HOST ?? "0.0.0.0",
    authMode: authMode(),
    cbmBinary: required("CBM_BINARY", "codebase-memory-mcp"),
    cbmCacheDir:
      process.env.CBM_CACHE_DIR ?? join(homedir(), ".cache", "codebase-memory-mcp"),
    cbmAllowedRoot: process.env.CBM_ALLOWED_ROOT,
    cbmWorkers: process.env.CBM_WORKERS,
    cbmMemBudgetMb: process.env.CBM_MEM_BUDGET_MB,
    upstreamHealthTimeoutMs: int("UPSTREAM_HEALTH_TIMEOUT_MS", 10_000),
    upstreamHealthIntervalMs: int("UPSTREAM_HEALTH_INTERVAL_MS", 30_000),
    sessionIdleTimeoutMs: int("SESSION_IDLE_TIMEOUT_MS", 30 * 60_000),
  };
}
