#!/usr/bin/env bash
# MCP endpoint'ini uçtan uca test eder — tarayıcıda yapılamayan şeyi yapar.
#
# Kullanım:
#   ./test-endpoint.sh <mcp-url>
#
# Örnek:
#   ./test-endpoint.sh http://localhost:8099/mcp/Users-isakulaksiz-Desktop-graphify-repo

set -u

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Kullanım: $0 <mcp-url>"
  echo "Örnek:   $0 http://localhost:8099/mcp/<proje-adi>"
  exit 1
fi
URL="${URL%/}"; URL="${URL%/sse}"   # sonundaki /sse veya / varsa at

H='Content-Type: application/json'
A='Accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test-endpoint.sh","version":"1"}}}'

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }

echo "Hedef: $URL"
echo

# ── 1) Streamable HTTP ───────────────────────────────────────────────────────
echo "STREAMABLE HTTP"
HEADERS=$(mktemp)
BODY=$(curl -s -D "$HEADERS" -H "$H" -H "$A" -X POST "$URL" -d "$INIT")
SID=$(grep -i '^mcp-session-id' "$HEADERS" | tr -d '\r' | cut -d' ' -f2)
rm -f "$HEADERS"

if [ -z "$SID" ]; then
  fail "initialize başarısız"
  echo "     yanıt: $(echo "$BODY" | head -c 200)"
else
  ok "oturum açıldı ($SID)"
  curl -s -H "$H" -H "$A" -H "mcp-session-id: $SID" -X POST "$URL" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

  TOOLS=$(curl -s -H "$H" -H "$A" -H "mcp-session-id: $SID" -X POST "$URL" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | sed -n 's/^data: //p' | head -1)
  COUNT=$(printf '%s' "$TOOLS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["result"]["tools"]))' 2>/dev/null)
  [ -n "$COUNT" ] && ok "tools/list → $COUNT araç" || fail "tools/list başarısız"

  RESULT=$(curl -s -H "$H" -H "$A" -H "mcp-session-id: $SID" -X POST "$URL" \
    -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_graph_schema","arguments":{}}}' \
    | sed -n 's/^data: //p' | head -1)
  printf '%s' "$RESULT" | grep -q '"result"' \
    && ok "araç çağrısı çalıştı (get_graph_schema)" \
    || fail "araç çağrısı başarısız"

  curl -s -X DELETE "$URL" -H "mcp-session-id: $SID" >/dev/null 2>&1
fi

echo

# ── 2) SSE ───────────────────────────────────────────────────────────────────
echo "SSE"
STREAM=$(mktemp)
curl -sN --max-time 6 "$URL/sse" > "$STREAM" 2>&1 &
CURL_PID=$!
sleep 3

SSID=$(grep -o 'sessionId=[a-f0-9-]*' "$STREAM" | head -1 | cut -d= -f2)
if [ -z "$SSID" ]; then
  fail "endpoint olayı gelmedi"
else
  ok "oturum açıldı ($SSID)"
  grep -q '^: ping' "$STREAM" && ok "keep-alive ping alındı" || fail "ping gelmedi"

  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -X POST "$URL/messages?sessionId=$SSID" -d "$INIT")
  [ "$CODE" = "202" ] && ok "mesaj kanalı kabul etti (HTTP $CODE)" || fail "mesaj kanalı HTTP $CODE"

  sleep 2
  grep -q 'serverInfo' "$STREAM" && ok "yanıt akıştan geldi" || fail "yanıt akışa düşmedi"
fi

kill "$CURL_PID" 2>/dev/null
wait "$CURL_PID" 2>/dev/null
rm -f "$STREAM"

echo
echo "Not: Bu adresleri tarayıcıda açmak çalışmaz — tarayıcı GET yapar,"
echo "     MCP ise POST + JSON-RPC ile başlar."
