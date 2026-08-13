import type { Request } from "express";
import type { Scope } from "./mcp/scope.js";

export interface Principal {
  /** Token sahibinin kimliği — log ve denetim izi için. */
  subject: string;
  /** Bu token'ın erişebildiği proje adları. */
  projects: readonly string[];
  scopes: readonly Scope[];
}

/**
 * Geçici token deposu.
 *
 * FAZ 5'TE DEĞİŞECEK: burası Entra ID doğrulaması ve Azure DevOps repo
 * yetkilerinden türetilen bir yetki servisine bağlanacak. Şimdilik POC için
 * ortam değişkeninden okunuyor.
 *
 * Format (GATEWAY_TOKENS):
 *   <token>:<subject>:<proje1,proje2>:<yetki1,yetki2>;<token2>:...
 */
export function loadTokens(raw: string | undefined): Map<string, Principal> {
  const tokens = new Map<string, Principal>();
  if (!raw) return tokens;

  for (const entry of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [token, subject, projects, scopes] = entry.split(":");
    if (!token || !subject) {
      throw new Error(`GATEWAY_TOKENS ayrıştırılamadı: '${entry}'`);
    }
    tokens.set(token, {
      subject,
      projects: (projects ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      scopes: ((scopes ?? "read").split(",").map((s) => s.trim()).filter(Boolean) as Scope[]),
    });
  }
  return tokens;
}

function extractBearer(request: Request): string | null {
  const header = request.header("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value;
}

export type AuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403; message: string };

/**
 * `none` modunda kullanılan kimlik.
 *
 * Tüm okuma yetkilerine sahip ama yazma yetkileri (`adr:write`, `traces:write`)
 * verilmez — kimlik doğrulaması yokken mutasyona izin vermek makul değil.
 */
function anonymousPrincipal(project: string): Principal {
  return { subject: "anonim", projects: [project], scopes: ["read"] };
}

/**
 * İsteği yetkilendirir.
 *
 * `none` modunda token istenmez; istenen proje koşulsuz açılır. Proje
 * kapsamlaması ve araç allowlist'i yine de uygulanır (bkz. mcp/scope.ts) —
 * yani bağlantı hâlâ tek repoya kilitlidir, sadece kimin bağlandığı sorulmaz.
 */
export function authorize(
  request: Request,
  project: string,
  tokens: Map<string, Principal>,
  mode: "none" | "bearer" = "bearer",
): AuthResult {
  if (mode === "none") {
    return { ok: true, principal: anonymousPrincipal(project) };
  }

  const token = extractBearer(request);
  if (!token) {
    return { ok: false, status: 401, message: "Authorization: Bearer <token> başlığı gerekli." };
  }

  const principal = tokens.get(token);
  if (!principal) {
    return { ok: false, status: 401, message: "Geçersiz token." };
  }

  if (!principal.projects.includes(project)) {
    // Yetkisi olmayan projeyi 404 değil 403 ile reddediyoruz: proje adı zaten
    // URL'de, varlığını gizlemek anlamsız. Denetim izi için de daha net.
    return {
      ok: false,
      status: 403,
      message: `'${project}' projesine erişim yetkiniz yok.`,
    };
  }

  return { ok: true, principal };
}
