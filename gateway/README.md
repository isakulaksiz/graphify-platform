# graphify-gateway

`codebase-memory-mcp`'nin stdio-only MCP sunucusunu **SSE** ve **Streamable HTTP**
üzerinden yayınlayan, proje bazlı yetkilendirme yapan gateway.

## Neden var

CBM yalnızca stdio üzerinden MCP konuşur — SSE veya Streamable HTTP desteği yoktur.
(`--ui=true --port=9749` yalnızca 3D graf görselleştirme arayüzüdür, MCP endpoint'i
değildir.) Copilot / Codex / Claude Code'a HTTP üzerinden endpoint verebilmek için
bu köprü gerekiyor.

İkinci ve daha kritik sebep: CBM tek OS hesabında **tek canonical cache root**'a izin
verir. Farklı `CBM_CACHE_DIR` ile eşzamanlı process reddedilir — yani repo başına ayrı
veritabanı ile izolasyon **yapılamaz**. Tüm repoların grafı tek DB dizininde durur ve
her araç `project` argümanı ile hedefini seçer.

**Sonuç: izolasyonun tek yeri bu gateway'dir.** [`src/mcp/scope.ts`](src/mcp/scope.ts)
devre dışı kalırsa A reposuna yetkili bir geliştirici `project: "B"` göndererek yetkisi
olmayan repoyu okur.

## Uçlar

| Yöntem | Yol | Amaç |
|---|---|---|
| `POST` | `/mcp/:project` | Streamable HTTP (tercih edilen) |
| `GET` | `/mcp/:project` | Streamable HTTP bildirim akışı |
| `DELETE` | `/mcp/:project` | Oturum sonlandırma |
| `GET` | `/mcp/:project/sse` | SSE (eski protokol) |
| `POST` | `/mcp/:project/messages?sessionId=…` | SSE mesaj kanalı |
| `GET` | `/healthz` | Sağlık kontrolü |

Kimlik `GATEWAY_AUTH` ile kontrol edilir:

| Mod | Davranış |
|---|---|
| `none` (varsayılan) | Token istenmez — adresi yapıştırmak yeterli |
| `bearer` | `Authorization: Bearer <token>` zorunlu; yetkisiz token `401`, yetkisi olmayan proje `403` |

Mod ne olursa olsun proje kapsamlaması ve araç allowlist'i uygulanır.

## Güvenlik modeli

1. **`project` argümanı koşulsuz ezilir.** İstemcinin gönderdiği değer yok sayılır,
   URL'deki proje adı yazılır.
2. **Varsayılan reddet.** Allowlist'te olmayan araç reddedilir. Bu, CBM sürüm
   yükseltmelerinde yeni bir aracın sessizce yetki sınırını delmesini engeller —
   ve pratikte işe yaradı: `check_index_coverage` README'de yokken bu şekilde yakalandı.
3. **`list_projects` süzülür.** Hem `content[]` hem `structuredContent` alanı
   tek projeye indirgenir. *Yalnızca `content` süzmek yetmez* — modern MCP
   istemcileri `structuredContent`'i tercih eder ve diğer tüm repoların adlarını görürdü.
4. **Mutasyon araçları engellidir.** `index_repository` ve `delete_project` gateway
   üzerinden çağrılamaz; indeksleme indexer worker'ından geçer.
5. **Yetki bazlı araçlar.** `manage_adr` yazma modları `adr:write`, `ingest_traces`
   `traces:write` gerektirir.

### Araç görünürlüğü (v0.10.3 ile doğrulandı)

| Durum | Araçlar |
|---|---|
| ✅ `read` ile görünür (12) | `check_index_coverage` `detect_changes` `get_architecture` `get_code_snippet` `get_graph_schema` `index_status` `list_projects` `manage_adr` `query_graph` `search_code` `search_graph` `trace_path` |
| ⛔ Engelli (3) | `index_repository` `delete_project` `ingest_traces` |

> `semantic_query` CBM README'sinde listeleniyor ama binary sunmuyor — allowlist'e alınmadı.

## Daemon kurtarma

Yarıda kesilen bir CBM oturumu daemon'u *version cohort claim* tutar halde bırakabiliyor;
sonraki her komut 30 sn bekleyip hata veriyor. Tek cache root modelinde bu, **tek bir bozuk
oturumun tüm repoları kilitlemesi** demek. [`src/cbm/upstream.ts`](src/cbm/upstream.ts)
periyodik sağlık kontrolü yapar ve takılmada bağlantıyı kapatıp container içindeki kalan
CBM süreçlerini temizler.

## Çalıştırma

```bash
npm install
cp .env.example .env   # değerleri doldurun
npm run dev
```

Zorunlu ortam değişkenleri [`.env.example`](.env.example) içinde.

**OpenShift notu:** rastgele UID ile çalışıldığı ve `$HOME` yazılabilir olmayabileceği
için `CBM_CACHE_DIR` mutlaka PVC üzerindeki bir yola sabitlenmeli. `CBM_WORKERS` ve
`CBM_MEM_BUDGET_MB` de elle verilmeli — CBM cgroup limitleri yerine host CPU/RAM'ini okur.

## İstemci yapılandırması

`GATEWAY_AUTH=none` (varsayılan) — sadece adres, header yok:

```jsonc
{
  "servers": {
    "graphify": {
      "type": "http",
      "url": "http://localhost:8099/mcp/<repo-adi>"
    }
  }
}
```

SSE isteyen eski istemciler için aynı adresin `/sse` sonekli hali:

```jsonc
{
  "mcpServers": {
    "graphify": { "url": "http://localhost:8099/mcp/<repo-adi>/sse" }
  }
}
```

`GATEWAY_AUTH=bearer` ise her ikisine de
`"headers": { "Authorization": "Bearer <token>" }` eklenir. Arayüzün Endpoint adımı
gateway'in `/healthz` ucundan modu okuyup snippet'i buna göre üretir — elle
düzeltmeniz gerekmez.

## Doğrulanan durum

Yerel testte teyit edildi: initialize → tools/list → tools/call zinciri her iki
transport'ta çalışıyor; `project` ezme, `list_projects` süzme, engelli araçlar ve
401/403 yolları test edildi.

**Yapılmadı:** kalıcılık yok (oturumlar bellekte), token deposu ortam değişkeninde
(Faz 5'te Entra ID + Azure DevOps repo yetkilerine bağlanacak), otomatik test yok.

## Tarayıcıda açıldığında

MCP uçları gezilebilir sayfa değildir — JSON-RPC konuşurlar. Adres tarayıcıya
yapıştırıldığında ham bir 404 yerine yapılandırma bilgisi gösterilir.

Ayrım `Accept` başlığıyla yapılır: tarayıcılar `text/html` ister, MCP istemcileri
`application/json, text/event-stream`. Protokol davranışı bundan etkilenmez.

`GET /mcp/:project` bir MCP istemcisinden `mcp-session-id` başlığı olmadan gelirse
404 döner — bu uç, açık bir oturumun bildirim akışıdır, giriş noktası değil. Giriş
her zaman `POST` + `initialize`'dır.
