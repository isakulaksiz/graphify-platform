import type { Request } from "express";

/**
 * İstek bir tarayıcıdan mı geliyor?
 *
 * MCP istemcileri `Accept: application/json, text/event-stream` gönderir;
 * tarayıcılar `text/html` ister. Ayrım bu.
 */
export function wantsHtml(request: Request): boolean {
  const accept = request.header("accept") ?? "";
  return accept.includes("text/html");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tarayıcıda açıldığında gösterilen bilgi sayfası.
 *
 * MCP uçları gezilebilir sayfa değildir; adresi tarayıcıya yapıştıran kişi
 * ham bir 404 yerine ne yapması gerektiğini görmeli.
 */
export function infoPage(options: {
  project: string;
  baseUrl: string;
  authMode: "none" | "bearer";
}): string {
  const { project, baseUrl, authMode } = options;
  const httpUrl = `${baseUrl}/mcp/${project}`;
  const sseUrl = `${httpUrl}/sse`;
  const headerLine = authMode === "bearer" ? `,\n      "headers": { "Authorization": "Bearer <TOKEN>" }` : "";

  const config = `{
  "servers": {
    "graphify": {
      "type": "http",
      "url": "${httpUrl}"${headerLine}
    }
  }
}`;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP endpoint — ${escapeHtml(project)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0f1117; color:#e5e7eb; font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:760px; margin:0 auto; padding:48px 24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#9ca3af; font-size:14px; margin:0 0 28px; }
  .note { border:1px solid #1e3a5f; background:#0c1a2e; border-radius:8px; padding:14px 16px; margin:0 0 24px; font-size:14px; }
  .note b { color:#93c5fd; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; margin:28px 0 8px; font-weight:600; }
  pre { background:#000; border:1px solid #2a3040; border-radius:8px; padding:12px 14px; overflow-x:auto; font-size:12.5px; margin:0; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .url { display:block; background:#171a23; border:1px solid #2a3040; border-radius:8px; padding:10px 12px; font-family:ui-monospace,monospace; font-size:12.5px; word-break:break-all; margin-bottom:8px; }
  .label { color:#6b7280; font-size:12px; }
  footer { margin-top:32px; padding-top:16px; border-top:1px solid #2a3040; color:#6b7280; font-size:13px; }
  a { color:#f97316; }
</style>
</head>
<body>
<main>
  <h1>MCP endpoint</h1>
  <p class="sub"><code>${escapeHtml(project)}</code></p>

  <div class="note">
    <b>Bu adres tarayıcıda çalışmaz.</b> Bir MCP sunucusudur — JSON-RPC konuşur,
    web sayfası sunmaz. Adresi kod asistanınızın yapılandırmasına yapıştırın.
  </div>

  <h2>Adresler</h2>
  <span class="label">Streamable HTTP (tercih edilen)</span>
  <span class="url">${escapeHtml(httpUrl)}</span>
  <span class="label">SSE (eski istemciler)</span>
  <span class="url">${escapeHtml(sseUrl)}</span>

  <h2>VS Code Copilot yapılandırması</h2>
  <pre><code>${escapeHtml(config)}</code></pre>

  <h2>Claude Code</h2>
  <pre><code>claude mcp add --transport http graphify ${escapeHtml(httpUrl)}</code></pre>

  <footer>
    Kimlik doğrulama: <b>${authMode === "none" ? "kapalı — token gerekmiyor" : "bearer token gerekli"}</b><br>
    Bu bağlantı yalnızca <code>${escapeHtml(project)}</code> projesine erişir; salt okunurdur.
  </footer>
</main>
</body>
</html>`;
}
