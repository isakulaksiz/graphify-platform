import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CbmUpstream } from "../cbm/upstream.js";
import type { Principal } from "../auth.js";
import {
  evaluateCall,
  filterProjectList,
  isToolVisible,
  rewriteArguments,
} from "./scope.js";

interface TextContent {
  type: "text";
  text: string;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }] as TextContent[], isError };
}

/**
 * list_projects yanıtını tek projeye indirger.
 *
 * DİKKAT — iki alan birden süzülmeli:
 * CBM sonucu hem `content[]` (metin içinde JSON) hem de `structuredContent`
 * (ayrıştırılmış nesne) olarak döndürüyor. Modern MCP istemcileri
 * `structuredContent`'i tercih eder. Yalnızca `content` süzülürse istemci
 * diğer tüm repoların adlarını, yollarını ve boyutlarını görür.
 *
 * Bu sızıntı testle doğrulandı ve buradaki iki aşamalı süzme ile kapatıldı.
 */
function filterListProjectsResult(result: unknown, project: string): unknown {
  if (typeof result !== "object" || result === null) return result;
  const record = result as Record<string, unknown>;

  const filtered: Record<string, unknown> = { ...record };

  if (record.structuredContent !== undefined) {
    filtered.structuredContent = filterProjectList(record.structuredContent, project);
  }

  if (!Array.isArray(record.content)) return filtered;

  const content = record.content.map((block) => {
    if (
      typeof block !== "object" ||
      block === null ||
      (block as Record<string, unknown>).type !== "text"
    ) {
      return block;
    }
    const raw = (block as Record<string, unknown>).text;
    if (typeof raw !== "string") return block;

    try {
      const parsed: unknown = JSON.parse(raw);
      return { type: "text", text: JSON.stringify(filterProjectList(parsed, project)) };
    } catch {
      return {
        type: "text",
        text: JSON.stringify({
          projects: [],
          note: "Yanıt süzülemediği için gizlendi.",
        }),
      };
    }
  });

  return { ...filtered, content };
}

/**
 * Tek bir proje ve tek bir kimlik için kapsamlanmış MCP sunucusu üretir.
 *
 * Her HTTP oturumu kendi Server örneğini alır; hepsi aynı paylaşımlı CBM
 * bağlantısına delege eder.
 */
export function createScopedServer(
  upstream: CbmUpstream,
  project: string,
  principal: Principal,
): Server {
  const server = new Server(
    { name: `graphify-gateway/${project}`, version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        `Bu bağlantı '${project}' reposunun kod grafına salt okunur erişim sağlar. ` +
        `Araçların 'project' argümanı gateway tarafından sabitlenmiştir; ` +
        `göndereceğiniz değer yok sayılır.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const client = await upstream.getClient();
    const upstreamTools = await client.listTools();
    const tools = upstreamTools.tools.filter((tool) =>
      isToolVisible(tool.name, principal.scopes),
    );
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const policy = evaluateCall(toolName, args, principal.scopes);
    if (!policy.allowed) {
      console.warn(
        `[acl] REDDEDİLDİ subject=${principal.subject} project=${project} tool=${toolName} sebep="${policy.reason}"`,
      );
      return textResult(policy.reason ?? "Bu araç bu bağlantıda kullanılamaz.", true);
    }

    // Kritik satır: istemcinin 'project' değeri koşulsuz eziliyor.
    const scopedArgs = rewriteArguments(toolName, args, project);

    console.info(
      `[call] subject=${principal.subject} project=${project} tool=${toolName}`,
    );

    const client = await upstream.getClient();
    const result = await client.callTool({ name: toolName, arguments: scopedArgs });

    if (toolName === "list_projects") {
      return filterListProjectsResult(result, project) as typeof result;
    }
    return result;
  });

  return server;
}
