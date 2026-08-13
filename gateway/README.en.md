# graphify-gateway

[Türkçe](README.md) · **English**

Gateway that publishes `codebase-memory-mcp`'s stdio-only MCP server over **SSE**
and **Streamable HTTP**, with per-project authorization.

## Why it exists

CBM speaks MCP over stdio only — there is no SSE or Streamable HTTP support.
(`--ui=true --port=9749` is just the 3D graph visualization UI, not an MCP
endpoint.) This bridge is what makes an HTTP endpoint possible for
Copilot / Codex / Claude Code.

The second and more critical reason: CBM allows only **one canonical cache root**
per OS account. Concurrent processes with a different `CBM_CACHE_DIR` are rejected —
so per-repository isolation via separate databases is **impossible**. Every
repository's graph lives in one database directory, and each tool selects its
target through a `project` argument.

**Consequence: this gateway is the only place isolation happens.** If
[`src/mcp/scope.ts`](src/mcp/scope.ts) stops working, a developer authorized for
repo A can read repo B by sending `project: "B"`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp/:project` | Streamable HTTP (preferred) |
| `GET` | `/mcp/:project` | Streamable HTTP notification stream |
| `DELETE` | `/mcp/:project` | Terminate session |
| `GET` | `/mcp/:project/sse` | SSE (legacy protocol) |
| `POST` | `/mcp/:project/messages?sessionId=…` | SSE message channel |
| `GET` | `/healthz` | Health check |

Authentication is controlled by `GATEWAY_AUTH`:

| Mode | Behavior |
|---|---|
| `none` (default) | No token required — pasting the address is enough |
| `bearer` | `Authorization: Bearer <token>` required; invalid token `401`, unauthorized project `403` |

Project scoping and the tool allowlist apply in both modes.

## Security model

1. **The `project` argument is overwritten unconditionally.** Whatever the client
   sends is discarded and replaced with the project name from the URL.
2. **Deny by default.** Any tool not on the allowlist is rejected. This prevents a
   new tool from silently crossing the authorization boundary on a CBM upgrade —
   and it worked in practice: `check_index_coverage` was caught this way while
   absent from the README.
3. **`list_projects` is filtered.** Both the `content[]` and `structuredContent`
   fields are reduced to a single project. *Filtering only `content` is not
   enough* — modern MCP clients prefer `structuredContent` and would see the names
   of every other repository.
4. **Mutation tools are blocked.** `index_repository` and `delete_project` cannot be
   called through the gateway; indexing goes through the indexer worker.
5. **Scope-gated tools.** `manage_adr` write modes require `adr:write`,
   `ingest_traces` requires `traces:write`.

### Tool visibility (verified against v0.10.3)

| Status | Tools |
|---|---|
| ✅ Visible with `read` (12) | `check_index_coverage` `detect_changes` `get_architecture` `get_code_snippet` `get_graph_schema` `index_status` `list_projects` `manage_adr` `query_graph` `search_code` `search_graph` `trace_path` |
| ⛔ Blocked (3) | `index_repository` `delete_project` `ingest_traces` |

> `semantic_query` is listed in CBM's README but the binary does not expose it — it
> was left off the allowlist.

## Daemon recovery

An interrupted CBM session can leave the daemon holding a *version cohort claim*;
every subsequent command then waits 30 s and fails. In the single-cache-root model
that means **one broken session locks every repository**.
[`src/cbm/upstream.ts`](src/cbm/upstream.ts) runs a periodic health check and, on a
hang, closes the connection and cleans up any remaining CBM processes in the
container.

## Running

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```

Required environment variables are in [`.env.example`](.env.example).

**OpenShift note:** because it runs with a random UID and `$HOME` may not be
writable, `CBM_CACHE_DIR` must be pinned to a path on a PVC. `CBM_WORKERS` and
`CBM_MEM_BUDGET_MB` must also be set explicitly — CBM reads host CPU/RAM rather
than the cgroup limits.

## Client configuration

`GATEWAY_AUTH=none` (default) — address only, no headers:

```jsonc
{
  "servers": {
    "graphify": {
      "type": "http",
      "url": "http://localhost:8099/mcp/<repo-name>"
    }
  }
}
```

For legacy clients that want SSE, the same address with a `/sse` suffix:

```jsonc
{
  "mcpServers": {
    "graphify": { "url": "http://localhost:8099/mcp/<repo-name>/sse" }
  }
}
```

With `GATEWAY_AUTH=bearer`, both gain
`"headers": { "Authorization": "Bearer <token>" }`. The UI's Endpoint step reads
the mode from the gateway's `/healthz` and generates the snippet accordingly — no
manual editing needed.

## SSE keep-alive

The SDK's legacy `SSEServerTransport` — unlike Streamable HTTP — sends no
keep-alive. Without pings the stream is silently dropped by an intervening proxy's
idle timeout. The gateway sends an SSE comment line immediately on connect and then
every `SSE_KEEP_ALIVE_MS` (default 15000):

```
: ping 2026-08-13T19:21:52.708Z
```

## Verified state

Confirmed locally: the initialize → tools/list → tools/call chain works on both
transports; `project` overriding, `list_projects` filtering, blocked tools, and the
401/403 paths were all tested. Claude Code connects over both transports
(`✓ Connected`).

**Not done:** no persistence (sessions live in memory), token store is an
environment variable (to be wired to Entra ID + Azure DevOps repo permissions),
no automated tests.

## Opening the endpoints in a browser

They will not work. A browser issues `GET`; MCP starts with `POST` + JSON-RPC.
`GET /mcp/:project` without an `mcp-session-id` header returns 404 — that endpoint
is an open session's notification stream, not an entry point. Use
[`../test-endpoint.sh`](../test-endpoint.sh) to verify an endpoint instead.
