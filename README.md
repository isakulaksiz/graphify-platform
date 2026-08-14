# graphify-platform

**Türkçe** · [English](README.en.md)

Repo kod grafını `codebase-memory-mcp` ile çıkarıp Copilot / Codex / Claude Code'a
MCP endpoint'i olarak sunan iç platform.

## Ekran görüntüleri

**İndeksleme** — canlı ilerleme, node/edge sayaçları, indekslenmeyen dizin uyarısı
ve CBM'in 3D graf arayüzüne bağlantı.

![İndeksleme adımı](docs/screenshot-indexing.png)

**Endpoint** — üretilen MCP adresleri ve dört istemci için hazır yapılandırma.

![Endpoint adımı](docs/screenshot-endpoint.png)

## Bileşenler

| Dizin | Ne yapar | Port |
|---|---|---|
| [`gateway/`](gateway) | CBM stdio sunucusunu SSE + Streamable HTTP olarak yayınlar, proje bazlı yetki uygular | 8099 |
| [`control-api/`](control-api) | Arayüzün konuştuğu kontrol düzlemi: repo listeleme, indeksleme işleri, endpoint bilgisi | 8090 |
| [`web/`](web) | n8n tarzı adımlı arayüz | 5180 |

İndekslenecek repolar bu depoda değil — platform onları Azure DevOps'tan çeker veya
diskteki yerel klonları kullanır.

## Docker ile çalıştırma

```bash
cp .env.example .env      # değerleri doldurun
docker compose up -d --build
```

Arayüz: **http://localhost:5180**

| Servis | Port | Not |
|---|---|---|
| `web` | 5180 | nginx; `/api` isteklerini control-api'ye yönlendirir |
| `gateway` | 8099 | MCP endpoint'leri |
| CBM graf arayüzü | 9749 | gateway konteynerindeki daemon sunar |
| `control-api` | — | dışarı açılmaz, yalnızca nginx üzerinden erişilir |

Durdurmak: `docker compose down` · verileri de silmek: `docker compose down -v`

### Neden gateway ve control-api aynı imaj

İkisi de CBM binary'sine ihtiyaç duyuyor (297 MB). Ayrı imajlar yapmak onu iki kez
saklamak olurdu; tek imaj kurulup compose'da farklı komutlarla çalıştırılıyor.

CBM veritabanını **paylaşıyorlar** — `cbm-data` volume'ü. Bunun çalıştığını deneyle
doğruladım: ayrı konteynerler aynı volume üzerinden eşzamanlı çalışabiliyor, biri
MCP oturumu açıkken diğeri CLI komutu çalıştırabiliyor.

> ⚠️ **control-api tek replika olmalı.** İki kopya aynı anda indeksleme yaparsa
> CBM'in proje bazlı kilitleri üzerinden yarışırlar. Ölçekleme gerekiyorsa repoları
> ayrı compose grupları/namespace'lere bölün.

### Şirket içi Azure DevOps (on-prem)

Adres yapısı bulut ile aynı şekle sahip, sadece taban adres ve koleksiyon değişiyor:

```
https://devops.kurum.com.tr / DefaultCollection / proje / _git / repo
└──────── AZDO_BASE_URL ────┘ └─── AZDO_ORG ───┘
```

```bash
AZDO_BASE_URL=https://devops.kurum.com.tr
AZDO_ORG=DefaultCollection
```

Koleksiyon seviyesinden sorgulandığı için o koleksiyondaki **tüm projelerin**
repoları listeye düşer. Adres arayüzden de girilebilir (Kaynak adımı).

Eski sunucular API 7.1'i desteklemeyebilir — `AZDO_API_VERSION` ile düşürün
(2019 → `5.1`, 2020 → `6.0`).

### Karşılaşacağınız üç şey

**1. İç CA sertifikası.** Sunucunuz kurum CA'sı ile imzalıysa Node
`unable to verify the first certificate` der. Sertifikayı `certs/` altına koyup:

```bash
NODE_EXTRA_CA_CERTS=/certs/kurum-ca.crt
```

`certs/` dizini konteynere salt okunur bağlanır ve `.gitignore`'dadır.

**2. Kapalı ortamda imaj kurulumu.** `Dockerfile` CBM'i npm'den çekiyor. İnternet
yoksa `npm install -g` satırını iç registry'nize yönlendirin veya binary'yi
`COPY` ile imaja gömün. Çalışma anında indirmeye bırakmayın.

**3. Genel adresler.** `GATEWAY_PUBLIC_URL` ve `CBM_UI_PUBLIC_URL` kullanıcının
tarayıcısından erişilebilen adresler olmalı — arayüz bunları istemci
yapılandırmalarında gösteriyor. Sunucuya kurarken `localhost` bırakmayın.

### Docker'a özel çözülen sorun

CBM cache dizini **sahibine özel (0700)** olmak zorunda. Dünyaya açık bırakılırsa
şu hatayla reddediyor ve hiçbir komut çalışmıyor:

```
secure CLI coordination could not be created (cache-private)
```

`Dockerfile` bu yüzden `chmod 777` değil, `node` kullanıcısına ait `0700` veriyor.
OpenShift'e taşırken rastgele UID nedeniyle bu kısmın gözden geçirilmesi gerekecek.

## Yerel çalıştırma (Docker'sız)

Üçünü ayrı terminallerde:

```bash
cd gateway && CBM_BINARY=$(which codebase-memory-mcp) GATEWAY_AUTH=none PORT=8099 npm run dev
```

```bash
cd control-api && CBM_BINARY=$(which codebase-memory-mcp) PORT=8090 \
  GATEWAY_BASE_URL=http://localhost:8099 WEBHOOK_SECRET=degistirin \
  LOCAL_REPO_ROOTS="$HOME/Desktop/graphify-repo" npm run dev
```

```bash
cd web && npm run dev
```

Arayüz: http://localhost:5180

Azure DevOps repolarını listelemek için organizasyon ve PAT'i **arayüzden** girin
(Kaynak adımı). Token yalnızca control-api'nin belleğinde tutulur; diske yazılmaz,
log'lanmaz ve hiçbir yanıtta geri dönmez. `AZDO_ORG` / `AZDO_PAT` ortam değişkenleriyle
de verilebilir.

## Kimlik doğrulama modları

Gateway `GATEWAY_AUTH` ile iki modda çalışır:

| Mod | Davranış |
|---|---|
| `none` (varsayılan) | Token istenmez, doğrudan bağlanılır |
| `bearer` | `Authorization: Bearer <token>` zorunlu, `GATEWAY_TOKENS`'tan proje eşlemesi |

> ⚠️ `none` modunda gateway'e ağdan erişebilen herkes **her repoyu** okuyabilir.
> Lokal geliştirme için uygundur; OpenShift'e çıkarken `bearer`'a alın —
> tek ortam değişkeni değişikliği, kod değişikliği gerekmez.

Mod ne olursa olsun **proje kapsamlaması ve araç allowlist'i uygulanır**: bağlantı
URL'deki repoya kilitlidir, `index_repository` / `delete_project` / `ingest_traces`
engellidir.

## Arayüz adımları

1. **Kaynak** — Azure DevOps bağlantısı (org + PAT) ve repo seçimi; indekslenenler işaretli
2. **Kapsam** — dal seçimi (aranabilir açılır liste, repodan canlı çekilir)
3. **Ön kontrol** — kaynak kodu getirir (klonlar/günceller) ve doğrular
4. **İndeksleme** — SSE ile canlı log, node/edge sayaçları, indekslenmeyen dizin uyarısı
   ve **kod grafı görselleştirmesi**
5. **Otomasyon** — otomatik güncelleme anahtarı + webhook aboneliği
6. **Endpoint** — MCP URL'leri + 4 istemci için hazır yapılandırma

## Kaynak kodu nereden gelir

Kullanıcıdan yol istenmez. Ön kontrol adımı repoyu indekslemeye hazırlar:

| Repo türü | Davranış |
|---|---|
| Azure DevOps | Klon yoksa açar, varsa `git fetch` eder; seçilen dala geçer |
| Yerel | Diskteki yolu doğrudan kullanır, klonlama yapmaz |

Klonlar `CLONE_ROOT` altında tutulur (varsayılan `~/.cache/graphify/repos`), dizin adı
`<proje>-<repo>-<id>` biçiminde deterministiktir; aynı repo hep aynı dizini kullanır.

PAT git'e **header ile** geçirilir (`http.extraHeader`), URL'ye gömülmez — gömülseydi
remote config'e, reflog'a ve `ps` çıktısına sızardı. `GIT_TERMINAL_PROMPT=0` ve
`stdio: ignore` ile kimlik istemi çıkması hâlinde asılmak yerine hata verilir.

## Graf görselleştirmesi

CBM'in kendi 3D graf arayüzü kullanılıyor — node tipi ve ilişki süzgeçleri,
ölü kod tespiti, klasör ağacı ile birlikte. İndeksleme adımı, projeye deep-link
veren bir düğme gösterir:

```
http://localhost:9749/?tab=graph&project=<proje-adi>
```

**Neden gömülemiyor:** CBM `Content-Security-Policy: … frame-ancestors 'none'`
gönderiyor. Bu iframe'lemeyi kesin olarak engeller; istemci tarafında aşılamaz.
Bu yüzden yeni sekmede açılıyor.

**Ayrı süreç yönetmeye gerek yok.** `--ui=true` kalıcı bir ayardır (`config list`
çıktısında görünmez ama etkilidir). Bir kez çalıştırıldıktan sonra, gateway MCP
oturumu açtığında başlayan daemon UI'ı da ayağa kaldırır:

```bash
codebase-memory-mcp --ui=true --port=9749   # bir kez; ayar kalıcı
```

`/api/cbm-ui?project=<ad>` ucu arayüzün ayakta olup olmadığını bildirir; kapalıysa
düğme devre dışı kalır ve yukarıdaki komut gösterilir.

## Otomatik graf güncelleme

Dal değiştiğinde graf kendiliğinden yeniden çıkarılır. İki tetikleme yolu aynı
birleştirme penceresini paylaşır:

| Yol | Nasıl | Ne zaman |
|---|---|---|
| **Yoklama** | `git fetch` + `rev-parse origin/<dal>`, `WATCH_POLL_MS` aralığıyla | Her zaman — dışarıya açık adres gerektirmez |
| **Webhook** | `POST /webhooks/azdo` — Azure DevOps `git.push` gövdesi | Platform Azure DevOps'tan erişilebilir olduğunda |

Değişiklik görüldükten sonra `WATCH_DEBOUNCE_MS` kadar beklenir; arka arkaya gelen
push'lar tek indekslemede birleşir. Repo başına eşzamanlılık 1.

```bash
# izlemeyi başlat / durdur / durum
POST   /api/watch    {repoPath, repoName, branch}
DELETE /api/watch?repoPath=…
GET    /api/watch/state?repoPath=…
```

Webhook doğrulaması: `WEBHOOK_SECRET` tanımlıysa basic auth parolası kontrol edilir.
Azure DevOps HMAC imzası göndermediği için üretimde **IP allowlist** de gerekir.

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `WATCH_POLL_MS` | 15000 | Git kontrol sıklığı |
| `WATCH_DEBOUNCE_MS` | 5000 | Push birleştirme penceresi (üretimde 60000 önerilir) |
| `WEBHOOK_SECRET` | — | Webhook basic auth parolası |

## CBM'i programatik çağırırken bilinmesi gerekenler

Deneyle bulunmuş, dokümante edilmemiş davranışlar. Faz 2'de indexer worker'ı yazarken
aynı tuzaklar geçerli.

### ‼️ stdin kapatılmalı — yoksa süreç sonsuza kadar asılır

`cbm cli <tool>` argümanlarını stdin'den de kabul ediyor ve stdin **açık bir boru**
ise EOF bekleyerek asılıyor. Node'un `spawn`/`execFile` varsayılanı stdin'i açık boru
verdiği için, stdin'i kapatmayan her programatik çağrı kilitlenir:

```
cbm cli list_projects < /dev/null    → anında döner
sleep 30 | cbm cli list_projects     → asılı kalır
```

Çözüm: `spawn(..., { stdio: ["ignore", "pipe", "pipe"] })`. Bkz.
[`control-api/src/cbm.ts`](control-api/src/cbm.ts).

### Her CLI çağrısına timeout koyun

CBM asılırsa HTTP isteği de sonsuza kadar askıda kalır. Control-API 30 sn'de
süreci `SIGKILL` ile öldürür.

### Eşzamanlı CLI çağrılarını tekilleştirin

CBM komutları admission barrier üzerinden serileştiriyor; her HTTP isteğinde ayrı
süreç başlatmak hem birbirini bekletiyor hem ~2 sn süreç başlatma bedeli ödüyor.
Control-API 5 sn'lik önbellek + tek uçuşlu istek kullanıyor.

### 3D graf UI'ı (`--ui=true`) daemon bırakıyor

TTY gerektiriyor ve kapatıldıktan sonra daemon geride kalabiliyor; bu durumda diğer
CBM komutları 30 sn bekleyip hata veriyor. Kurtarma: `pkill -f codebase-memory-mcp`
veya arayüzdeki **Daemon'ı kurtar** düğmesi.

### Gateway ile CLI çakışmıyor

Gateway'in açık MCP oturumu `cbm cli` komutlarını engellemiyor — test edildi.

## Doğrulanan durum

Uçtan uca tarayıcıda çalıştırıldı: repo seçimi → ön kontrol → gerçek indeksleme
(293 node / 662 edge, 2.4 sn) → arayüzün ürettiği endpoint'e MCP bağlantısı →
aynı grafın dönmesi. Konsol hatası yok.

Otomatik güncelleme ayrı bir test reposuyla doğrulandı:

| Test | Sonuç |
|---|---|
| Commit → yoklama → yeniden indeksleme | 17/16 → 19/20 node/edge (eklenen 2 fonksiyon) |
| Webhook (doğru secret) | `matched:1`, tetikleme kaynağı `webhook`, 19/20 → 20/22 |
| Webhook (yanlış secret) | HTTP 401 |
| Streamable HTTP — hiç header yok | Bağlandı, `query_graph` çalıştı |
| SSE — hiç header yok | Bağlandı, `get_graph_schema` yanıtı akıştan geldi |
| Üretilen snippet'ler (`authMode=none`) | 4 snippet'in hiçbirinde `Authorization` yok |
| Klonlama — ilk çağrı | `cloned`, `main` @ fe80d0fb |
| Klonlama — farklı dal, ikinci çağrı | `updated`, `feature/yeni-ozellik` @ 3eba1c69, aynı dizin |
| Yerel repo dal listesi + hazırlama | `master`, klonlama atlandı, `ready: true` |
| Azure DevOps — canlı repo (GRAPHIFY) | Klonlandı, 2 dal listelendi, indekslendi (293/662) |
| Endpoint testi — her iki transport | `test-endpoint.sh` ile 7 kontrolün tamamı geçti |
| Docker: uçtan uca (web → nginx → control-api → CBM) | Konteynerde gerçek indeksleme, 18 node / 18 edge |

**Yapılmadı:** service hook aboneliğinin arayüzden otomatik kurulması, kalıcı iş/izleme
kaydı ve PAT saklama (süreç yeniden başlarsa sıfırlanır), Entra ID entegrasyonu,
otomatik test.

## Endpoint'i test etme

MCP uçları **tarayıcıda test edilemez**: tarayıcı `GET` yapar, MCP ise
`POST` + JSON-RPC ile başlar. Aynı adres, farklı istek — farklı sonuç.

```bash
./test-endpoint.sh http://localhost:8099/mcp/<proje-adi>
```

Her iki transport'u da uçtan uca dener: oturum açma, `tools/list`, araç çağrısı,
SSE keep-alive ping'i ve mesaj kanalı.
