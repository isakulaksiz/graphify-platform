/**
 * OpenAPI 3.1 şeması.
 *
 * Elle yazıldı — kod üreteci bir bağımlılık daha demekti ve yüzey küçük.
 * Uç eklendiğinde burası da güncellenmeli; şema kodun peşinden sürüklenirse
 * yanlış dokümantasyon hiç dokümantasyon olmamasından kötüdür.
 */
export function openApiDocument(): unknown {
  const commit = {
    type: "object",
    nullable: true,
    properties: {
      sha: { type: "string" },
      shortSha: { type: "string" },
      author: { type: "string" },
      date: { type: "string", format: "date-time" },
      subject: { type: "string" },
    },
  };

  const catalogEntry = {
    type: "object",
    properties: {
      project: { type: "string", description: "CBM'deki teknik proje adı — MCP adresi bunu kullanır" },
      displayName: { type: "string", description: "Okunabilir ad" },
      rootPath: { type: "string", description: "Kaynak kodun diskteki yolu" },
      branch: { type: "string" },
      nodes: { type: "integer" },
      edges: { type: "integer" },
      sizeBytes: { type: "integer" },
      streamableHttpUrl: { type: "string" },
      sseUrl: { type: "string" },
      graphUrl: { type: "string", description: "CBM 3D graf arayüzüne deep link" },
      lastCommit: commit,
      autoUpdate: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          branch: { type: "string" },
          lastSha: { type: "string", nullable: true },
          lastTrigger: {
            type: "object",
            properties: {
              at: { type: "string", format: "date-time" },
              sha: { type: "string" },
              source: { type: "string", enum: ["poll", "webhook"] },
            },
          },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "graphify control-api",
      version: "0.1.0",
      description:
        "Repo kod grafı indeksleme platformunun kontrol düzlemi. Katalog ucu, " +
        "indekslenmiş her projenin MCP adreslerini ve istatistiklerini döndürür; " +
        "MCP sunucu envanteri gibi dış sistemler bu ucu okuyabilir.",
    },
    paths: {
      "/api/catalog": {
        get: {
          summary: "İndekslenmiş projeler, MCP adresleri ve son commit bilgisi",
          description:
            "Geliştiricilere paylaşılan katalog ekranının ve dış envanter " +
            "sistemlerinin kullandığı uç.",
          responses: {
            "200": {
              description: "Katalog",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      authMode: { type: "string", enum: ["none", "bearer"] },
                      gatewayBaseUrl: { type: "string" },
                      cbmUiAvailable: { type: "boolean" },
                      projects: { type: "array", items: catalogEntry },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects": {
        get: {
          summary: "İndekslenmiş projelerin ham listesi",
          responses: { "200": { description: "Liste" } },
        },
      },
      "/api/projects/{name}": {
        delete: {
          summary: "Bir projenin grafını sil",
          description:
            "Önce izleme durdurulur (yoksa bir sonraki yoklama projeyi hemen " +
            "yeniden indeksler), sonra graf silinir. Klonlanan kaynak kod diskte kalır.",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Silindi" }, "500": { description: "Hata" } },
        },
      },
      "/api/projects/{name}/endpoint": {
        get: {
          summary: "Bir projenin MCP adresleri ve istemci yapılandırmaları",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Adresler ve snippet'ler" } },
        },
      },
      "/api/repos": {
        get: {
          summary: "İndekslenebilir repolar (Azure DevOps + yerel)",
          responses: { "200": { description: "Liste" } },
        },
      },
      "/api/repos/{id}/branches": {
        get: {
          summary: "Bir reponun dalları",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Dal listesi" } },
        },
      },
      "/api/repos/{id}/folders": {
        get: {
          summary: "Bir dalın klasörleri (indeksleme kapsamı seçimi için)",
          description:
            "Klon varsa git'ten (dosya sayılarıyla), yoksa Azure DevOps API'sinden " +
            "listelenir. path verilirse o klasörün altındakiler döner.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "branch", in: "query", required: true, schema: { type: "string" } },
            { name: "path", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Klasör listesi" }, "400": { description: "Hata" } },
        },
      },
      "/api/prepare": {
        post: {
          summary: "Kaynak kodu hazırla (klonla/güncelle) ve doğrula",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["repoId", "branch"],
                  properties: {
                    repoId: { type: "string" },
                    branch: { type: "string" },
                    folders: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "İndekslenecek klasörler. Boş/verilmezse tüm repo. " +
                        "sparse-checkout ile uygulanır: kapsam dışı dosyalar diske inmez.",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Hazır" }, "400": { description: "Hata" } },
        },
      },
      "/api/jobs": {
        post: {
          summary: "İndeksleme işi başlat",
          responses: { "202": { description: "Kuyruğa alındı" } },
        },
      },
      "/api/jobs/{id}/events": {
        get: {
          summary: "İş ilerlemesi (SSE)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "text/event-stream" } },
        },
      },
      "/api/watch": {
        get: { summary: "Aktif izlemeler", responses: { "200": { description: "Liste" } } },
        post: { summary: "İzlemeyi başlat", responses: { "200": { description: "Başladı" } } },
        delete: { summary: "İzlemeyi durdur", responses: { "200": { description: "Durdu" } } },
      },
      "/api/cbm-ui": {
        get: {
          summary: "CBM graf arayüzünün durumu ve deep link",
          parameters: [{ name: "project", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Durum" } },
        },
      },
      "/webhooks/azdo": {
        post: {
          summary: "Azure DevOps git.push alıcısı",
          description:
            "WEBHOOK_SECRET tanımlıysa basic auth parolası kontrol edilir. " +
            "Azure DevOps HMAC imzası göndermediği için üretimde IP allowlist de gerekir.",
          responses: { "200": { description: "Alındı" }, "401": { description: "Yetkisiz" } },
        },
      },
      "/api/health": {
        get: { summary: "Servis durumu", responses: { "200": { description: "ok" } } },
      },
    },
  };
}
