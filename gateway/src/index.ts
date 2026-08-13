import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { authorize, loadTokens, type Principal } from "./auth.js";
import { CbmUpstream } from "./cbm/upstream.js";
import { loadConfig } from "./config.js";
import { createScopedServer } from "./mcp/server-factory.js";

const config = loadConfig();
const tokens = loadTokens(process.env.GATEWAY_TOKENS);
const upstream = new CbmUpstream(config);

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  project: string;
  subject: string;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

/** SSE keep-alive aralığı — SDK'nın Streamable HTTP tarafındaki varsayılanla aynı. */
const SSE_KEEP_ALIVE_MS = Number(process.env.SSE_KEEP_ALIVE_MS ?? 15_000);

function touch(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastSeen = Date.now();
}

async function dropSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.transport.close().catch(() => undefined);
  console.info(`[session] kapandı id=${sessionId} project=${session.project}`);
}

/** Boşta kalan oturumları temizler — sızan süreç ve bellek bırakmamak için. */
setInterval(() => {
  const cutoff = Date.now() - config.sessionIdleTimeoutMs;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) {
      console.info(`[session] boşta kaldığı için düşürülüyor id=${id}`);
      void dropSession(id);
    }
  }
}, 60_000).unref();

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/healthz", (_req: Request, res: Response) => {
  // authMode'u yayınlıyoruz ki control-api istemci yapılandırmalarını
  // doğru üretebilsin (token'sız modda Authorization header'ı basmasın).
  res.json({ status: "ok", sessions: sessions.size, authMode: config.authMode });
});

/**
 * Route parametresini tek bir string'e indirger.
 *
 * Express 5 `req.params` değerlerini `string | string[]` olarak tipliyor;
 * tek segmentli `:project` için dizi gelmez ama tip güvenliği için normalize ediyoruz.
 */
function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * İstek için kimlik doğrular. Başarısızsa yanıtı yazar ve null döner.
 */
function requireAuth(req: Request, res: Response, project: string): Principal | null {
  const auth = authorize(req, project, tokens, config.authMode);
  if (!auth.ok) {
    console.warn(`[auth] ${auth.status} project=${project} sebep="${auth.message}"`);
    res.status(auth.status).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: auth.message },
      id: null,
    });
    return null;
  }
  return auth.principal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamable HTTP transport  —  Copilot, Codex ve Claude Code'un tercih ettiği yol
// ─────────────────────────────────────────────────────────────────────────────

app.post("/mcp/:project", async (req: Request, res: Response) => {
  const project = param(req.params.project);
  const principal = requireAuth(req, res, project);
  if (!principal) return;

  const sessionId = req.header("mcp-session-id");

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.project !== project) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Oturum bulunamadı veya bu projeye ait değil." },
        id: null,
      });
      return;
    }
    touch(sessionId);
    await (session.transport as StreamableHTTPServerTransport).handleRequest(
      req,
      res,
      req.body,
    );
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Oturum yok: önce initialize isteği gönderin." },
      id: null,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, {
        server,
        transport,
        project,
        subject: principal.subject,
        lastSeen: Date.now(),
      });
      console.info(
        `[session] açıldı id=${id} project=${project} subject=${principal.subject} transport=streamable-http`,
      );
    },
    onsessionclosed: (id) => {
      void dropSession(id);
    },
  });

  const server = createScopedServer(upstream, project, principal);
  transport.onclose = () => {
    if (transport.sessionId) void dropSession(transport.sessionId);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

/** Sunucudan istemciye giden bağımsız SSE akışı (bildirimler için). */
app.get("/mcp/:project", async (req: Request, res: Response) => {
  const project = param(req.params.project);
  if (!requireAuth(req, res, project)) return;

  const sessionId = req.header("mcp-session-id");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.project !== project) {
    res.status(404).json({
      error: "Oturum bulunamadı.",
      hint:
        "Bu uç, açık bir MCP oturumunun bildirim akışıdır ve 'mcp-session-id' başlığı ister. " +
        "Giriş noktası POST + 'initialize'dır.",
    });
    return;
  }
  touch(session.transport.sessionId!);
  await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res);
});

app.delete("/mcp/:project", async (req: Request, res: Response) => {
  const project = param(req.params.project);
  if (!requireAuth(req, res, project)) return;

  const sessionId = req.header("mcp-session-id");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.project !== project) {
    res.status(404).send("Oturum bulunamadı.");
    return;
  }
  await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res);
  await dropSession(sessionId!);
});

// ─────────────────────────────────────────────────────────────────────────────
// SSE transport (eski protokol)  —  Streamable HTTP desteklemeyen istemciler için
// ─────────────────────────────────────────────────────────────────────────────

/** SSE akışı. */
app.get("/mcp/:project/sse", async (req: Request, res: Response) => {
  const project = param(req.params.project);
  const principal = requireAuth(req, res, project);
  if (!principal) return;

  const transport = new SSEServerTransport(`/mcp/${project}/messages`, res);
  const server = createScopedServer(upstream, project, principal);

  /**
   * Keep-alive ping'leri.
   *
   * SDK'nın eski SSEServerTransport'u — Streamable HTTP'nin aksine — keep-alive
   * göndermiyor. Ping'siz akış, araya giren proxy/load balancer'ın idle
   * zaman aşımıyla sessizce düşer ve istemci bunu fark etmez. ':' ile başlayan
   * satır SSE yorumudur: istemciler yok sayar, bağlantı canlı kalır.
   */
  const ping = (): void => {
    if (!res.writableEnded) res.write(`: ping ${new Date().toISOString()}\n\n`);
  };
  // İlk ping'i hemen gönder: akışın canlı olduğu ilk saniyede görünsün,
  // 15 sn beklemek gerekmesin.
  setTimeout(ping, 50);
  const keepAlive = setInterval(ping, SSE_KEEP_ALIVE_MS);
  keepAlive.unref();
  res.on("close", () => clearInterval(keepAlive));

  sessions.set(transport.sessionId, {
    server,
    transport,
    project,
    subject: principal.subject,
    lastSeen: Date.now(),
  });
  console.info(
    `[session] açıldı id=${transport.sessionId} project=${project} subject=${principal.subject} transport=sse`,
  );

  transport.onclose = () => {
    void dropSession(transport.sessionId);
  };
  res.on("close", () => {
    void dropSession(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/mcp/:project/messages", async (req: Request, res: Response) => {
  const project = param(req.params.project);
  if (!requireAuth(req, res, project)) return;

  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.project !== project) {
    res.status(404).send("Oturum bulunamadı.");
    return;
  }
  touch(sessionId!);
  await (session.transport as SSEServerTransport).handlePostMessage(req, res, req.body);
});

// ─────────────────────────────────────────────────────────────────────────────

const httpServer = app.listen(config.port, config.host, () => {
  console.info(`[gateway] dinlemede http://${config.host}:${config.port}`);
  console.info(`[gateway] CBM cache dizini: ${config.cbmCacheDir}`);
  if (config.authMode === "none") {
    console.warn(
      "[gateway] ⚠️  kimlik doğrulama KAPALI (GATEWAY_AUTH=none) — " +
        "gateway'e erişebilen herkes tüm projeleri okuyabilir. Üretimde 'bearer' kullanın.",
    );
  } else {
    console.info(`[gateway] kimlik doğrulama: bearer, tanımlı token: ${tokens.size}`);
  }
  upstream.startHealthLoop();
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[gateway] ${signal} alındı, kapanıyor...`);
  httpServer.close();
  for (const id of [...sessions.keys()]) await dropSession(id);
  await upstream.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
