import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import express, { type Request, type Response } from "express";
import {
  azdoStatus,
  clearCredentials,
  listBranches,
  listFolderItems,
  listRepos,
  setCredentials,
} from "./azdo.js";
import {
  CLONE_ROOT,
  clonePathFor,
  currentBranch,
  displayName,
  lastCommit,
  listFolders,
  localBranches,
  prepareRepo,
  readScope,
  scopeLabel,
} from "./clone.js";
import { deleteProject, listProjects, recoverDaemon } from "./cbm.js";
import { cancelJobsForProject, createJob, getJob, hasActiveJobs } from "./jobs.js";
import { forgetRecord, getRecord, pruneMissing, recordIndex, stateFilePath } from "./state.js";
import type { EndpointInfo, RepoSummary } from "./types.js";
import {
  getWatch,
  listWatches,
  notifyPush,
  restoreWatches,
  startWatch,
  stopWatch,
} from "./watcher.js";
import { openApiDocument } from "./openapi.js";

const PORT = Number(process.env.PORT ?? 8090);
/**
 * Adresler ikiye ayrılır — konteynerde ikisi aynı olamaz.
 *
 * PUBLIC : kullanıcının tarayıcısından erişilebilen adres. Arayüzde gösterilir,
 *          istemci yapılandırmalarına yazılır.
 * INTERNAL: bu servisin kendi ağından erişebildiği adres. Sağlık kontrolü ve
 *          yoklama için kullanılır.
 *
 * Docker'da control-api için `localhost` kendi konteyneridir; gateway'e
 * `http://gateway:8099` ile ulaşır. Bu ayrım yapılmazsa yoklamalar sessizce
 * başarısız olur ve arayüz yanlış bilgi gösterir (ör. token gerekmiyorken
 * gerekiyormuş gibi).
 */
const GATEWAY_BASE = process.env.GATEWAY_BASE_URL ?? "http://localhost:8099";
const GATEWAY_INTERNAL = (process.env.GATEWAY_INTERNAL_URL ?? GATEWAY_BASE).replace(/\/$/, "");

/** CBM'in 3D graf arayüzü. */
const CBM_UI_URL = (process.env.CBM_UI_URL ?? "http://localhost:9749").replace(/\/$/, "");
/** Yerel repoların aranacağı kök dizinler (virgülle ayrılmış). */
const LOCAL_ROOTS = (process.env.LOCAL_REPO_ROOTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * İndekslemeye izin verilen kökler.
 *
 * `/api/jobs` ve `/api/watch` uçları kaynak kod yolunu istekten alıyor ve
 * doğrulama yalnızca "bu dizin var mı" kontrolüydü. Sonuç: konteynerdeki
 * HERHANGİ bir dizin indekslenip MCP üzerinden yayınlanabiliyordu
 * (`/usr/local/lib/node_modules` ile doğrulandı, 202 döndü).
 *
 * `CBM_ALLOWED_ROOT` yalnızca gateway servisinde tanımlıydı; indekslemeyi
 * çalıştıran servis control-api olduğu için orada hiçbir sınır yoktu.
 * Sınırı burada uyguluyoruz: hem klon kökü hem de operatörün açıkça izin
 * verdiği yerel repo kökleri kapsanıyor.
 */
const ALLOWED_ROOTS = [CLONE_ROOT, ...LOCAL_ROOTS.map((root) => resolve(root))];

function isAllowedRepoPath(candidate: string): boolean {
  const path = resolve(candidate);
  return ALLOWED_ROOTS.some((root) => path === root || path.startsWith(`${root}${sep}`));
}

const app = express();
app.use(express.json());

// POC'de arayüz ayrı portta (Vite) çalışıyor.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", azdo: azdoStatus(), gatewayBase: GATEWAY_BASE });
});

// ── OpenAPI ─────────────────────────────────────────────────────────────────

app.get("/api/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiDocument());
});

/** Uçların insan-okur özeti. Ham şema /api/openapi.json adresinde. */
app.get("/api/docs", (_req: Request, res: Response) => {
  res.type("html").send(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>API — graphify control-api</title>
<style>body{font:14px/1.6 ui-sans-serif,system-ui;background:#f5f6f8;color:#1a1f2b;margin:0;padding:40px}
main{max-width:760px;margin:0 auto}code{font-family:ui-monospace,monospace;background:#fff;border:1px solid #e2e5ea;padding:1px 5px;border-radius:4px}
a{color:#0b4f9e}table{border-collapse:collapse;width:100%;margin-top:16px;background:#fff;border:1px solid #e2e5ea}
td,th{border-bottom:1px solid #e2e5ea;padding:8px 10px;text-align:left;font-size:13px}
h1{font-size:20px}</style></head>
<body><main>
<h1>graphify control-api</h1>
<p>OpenAPI şeması: <a href="/api/openapi.json">/api/openapi.json</a></p>
<p>Katalog ucu, indekslenmiş her projenin MCP adreslerini ve istatistiklerini döndürür;
MCP sunucu envanteri gibi dış sistemler bu ucu okuyabilir.</p>
<table>
<tr><th>Yöntem</th><th>Yol</th><th>Ne döner</th></tr>
<tr><td>GET</td><td><code>/api/catalog</code></td><td>Projeler, MCP adresleri, son commit</td></tr>
<tr><td>GET</td><td><code>/api/projects</code></td><td>Ham proje listesi</td></tr>
<tr><td>DELETE</td><td><code>/api/projects/:name</code></td><td>Grafı siler</td></tr>
<tr><td>GET</td><td><code>/api/repos</code></td><td>İndekslenebilir repolar</td></tr>
<tr><td>POST</td><td><code>/api/prepare</code></td><td>Kaynak kodu hazırlar</td></tr>
<tr><td>POST</td><td><code>/api/jobs</code></td><td>İndeksleme başlatır</td></tr>
<tr><td>GET</td><td><code>/api/jobs/:id/events</code></td><td>İlerleme (SSE)</td></tr>
<tr><td>GET/POST/DELETE</td><td><code>/api/watch</code></td><td>Otomatik güncelleme</td></tr>
<tr><td>POST</td><td><code>/webhooks/azdo</code></td><td>Azure DevOps push alıcısı</td></tr>
</table>
</main></body></html>`);
});

// ── Azure DevOps kimlik bilgisi ──────────────────────────────────────────────

app.get("/api/azdo", (_req: Request, res: Response) => {
  res.json(azdoStatus());
});

/**
 * Organizasyon + PAT alır, bağlantıyı doğrular ve belleğe yazar.
 *
 * PAT diske yazılmaz, log'lanmaz ve hiçbir yanıtta geri dönmez. Süreç yeniden
 * başlarsa tekrar girilmesi gerekir.
 */
app.post("/api/azdo", async (req: Request, res: Response) => {
  const org = typeof req.body?.org === "string" ? req.body.org.trim() : "";
  const pat = typeof req.body?.pat === "string" ? req.body.pat : "";
  const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl : undefined;

  if (!org || !pat) {
    res.status(400).json({ error: "org ve pat zorunlu." });
    return;
  }

  try {
    res.json(await setCredentials(org, pat, baseUrl));
  } catch (error) {
    // Hata mesajını olduğu gibi geçiyoruz; token değerini içermez.
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

app.delete("/api/azdo", (_req: Request, res: Response) => {
  clearCredentials();
  res.json(azdoStatus());
});

/**
 * Yerel diskte duran, indekslenebilir repoları toplar.
 *
 * Varsayılan dal repodan okunuyor; sabit 'master' yazmak `main` kullanan bir
 * repoda kapsam adımına var olmayan bir dal önerirdi.
 */
async function localRepos(): Promise<RepoSummary[]> {
  const found: RepoSummary[] = [];
  for (const root of LOCAL_ROOTS) {
    const path = resolve(root);
    if (!existsSync(path) || !statSync(path).isDirectory()) continue;

    const head = await currentBranch(path).catch(() => null);
    found.push({
      id: `local:${path}`,
      name: path.split("/").at(-1) ?? path,
      defaultBranch: head ?? "main",
      localPath: path,
      source: "local",
    });
  }
  return found;
}

/** Yerel + Azure DevOps repolarının birleşik listesi. */
async function allRepos(): Promise<RepoSummary[]> {
  const azure = await listRepos().catch((error: unknown) => {
    console.error("[repos] Azure DevOps listesi alınamadı:", String(error));
    return [] as RepoSummary[];
  });
  return [...(await localRepos()), ...azure];
}

async function findRepo(id: string): Promise<RepoSummary | undefined> {
  return (await allRepos()).find((repo) => repo.id === id);
}

app.get("/api/repos", async (_req: Request, res: Response) => {
  try {
    const [repos, indexed] = await Promise.all([allRepos(), listProjects().catch(() => [])]);

    /**
     * İndekslenmiş grafları repolara eşle.
     *
     * Tam yol eşitliği YETMEZ: klasör kapsamı kullanıldığında klon yolunun
     * sonuna kapsam anahtarı ekleniyor (`...-2b08ec87-services-3e7aaa`).
     * Kapsamsız yolu arayan eski eşleştirme, kapsamla indekslenmiş bir repoyu
     * "hiç indekslenmemiş" gösteriyordu.
     *
     * Bir repo birden çok kapsamla indekslenmiş olabilir, o yüzden liste.
     */
    for (const repo of repos) {
      const base = repo.source === "local" ? repo.localPath : clonePathFor(repo);
      if (!base) continue;

      const matches = indexed.filter(
        (p) => p.rootPath === base || p.rootPath.startsWith(`${base}-`),
      );
      if (matches.length === 0) continue;

      repo.indexed = await Promise.all(
        matches.map(async (p) => ({
          project: p.name,
          rootPath: p.rootPath,
          folders: getRecord(p.rootPath)?.folders?.length
            ? (getRecord(p.rootPath)?.folders ?? [])
            : await readScope(p.rootPath).catch(() => []),
          nodes: p.nodes,
          edges: p.edges,
        })),
      );
      // Kapsamsız olan (tüm repo) varsa onu başa al — en genel kayıt o.
      repo.indexed.sort((a, b) => a.folders.length - b.folders.length);
      repo.indexedAs = repo.indexed[0]?.project;
    }

    res.json({ repos, azdo: azdoStatus() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** Bir reponun dallarını listeler. Arayüzdeki dal seçici bunu kullanır. */
app.get("/api/repos/:id/branches", async (req: Request, res: Response) => {
  try {
    const repo = await findRepo(String(req.params.id));
    if (!repo) {
      res.status(404).json({ error: "Repo bulunamadı." });
      return;
    }

    const branches =
      repo.source === "local"
        ? await localBranches(repo.localPath!)
        : await listBranches(repo.id);

    res.json({ branches, defaultBranch: repo.defaultBranch });
  } catch (error) {
    res.status(500).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/**
 * CBM'in kendi 3D graf arayüzünün durumu.
 *
 * Arayüzü iframe'e gömemiyoruz: CBM `frame-ancestors 'none'` CSP başlığı
 * gönderiyor. Bu yüzden yeni sekmede açıyoruz.
 *
 * Ayrı bir süreç yönetmemize gerek yok — `--ui=true` kalıcı bir ayar olduğu
 * için, gateway MCP oturumu açtığında başlayan daemon UI'ı da ayağa kaldırıyor.
 */
app.get("/api/cbm-ui", async (req: Request, res: Response) => {
  const project = typeof req.query.project === "string" ? req.query.project : "";
  const deepLink = project
    ? `${CBM_UI_URL}/?tab=graph&project=${encodeURIComponent(project)}`
    : CBM_UI_URL;

  const health = await gatewayHealth();
  const available = health?.cbmUi?.available === true;

  res.json({
    available,
    url: deepLink,
    baseUrl: CBM_UI_URL,
    ...(available
      ? {}
      : {
          reason:
            "CBM graf arayüzü yanıt vermiyor. Arayüz, gateway bir MCP oturumu " +
            "açtığında daemon tarafından başlatılır — henüz hiç bağlantı olmadıysa kapalıdır.",
        }),
  });
});

/**
 * Katalog — indekslenmiş her projenin adı, istatistikleri ve MCP adresleri.
 *
 * Geliştiricilere paylaşılan ekran bunu kullanıyor: kendi reposunu bulup
 * MCP adresini kopyalıyor.
 */
app.get("/api/catalog", async (_req: Request, res: Response) => {
  try {
    const [projects, health, repos] = await Promise.all([
      listProjects(),
      gatewayHealth(),
      allRepos().catch(() => [] as RepoSummary[]),
    ]);
    const authMode = health?.authMode === "none" ? "none" : "bearer";
    const watches = listWatches();

    const entries = await Promise.all(projects.map(async (p) => {
      const watch = watches.find((w) => w.repoPath === p.rootPath);
      // Dal sırayla: indeksleme kaydı → CBM → çalışma kopyasının hâli.
      const record = getRecord(p.rootPath);
      const branch = record?.branch ?? p.branch ?? (await currentBranch(p.rootPath).catch(() => null));
      const folders =
        record?.folders && record.folders.length > 0
          ? record.folders
          : await readScope(p.rootPath).catch(() => []);
      // Kapsamlı projede reponun tepe commit'i değil, kapsama dokunan son commit.
      const commit = await lastCommit(p.rootPath, folders).catch(() => null);

      /**
       * Okunabilir ad — yol ayrıştırmak son çare.
       *
       * Sıra: kalıcı kayıt → canlı repo listesi → dizin adından türetme.
       * Kayıt önce geliyor çünkü katalog sayfası PAT girilmeden de açılıyor
       * (geliştiricilerle paylaşılan ekran bu); o durumda repo listesi boş.
       */
      const owner = repos.find((repo) => {
        const base = repo.source === "local" ? repo.localPath : clonePathFor(repo);
        return Boolean(base) && (p.rootPath === base || p.rootPath.startsWith(`${base}-`));
      });
      const repoName = record?.repoName ?? owner?.name ?? displayName(p.rootPath);

      // Kaydı yoksa doldur: bir sonraki açılışta repo listesine ihtiyaç kalmasın.
      if (!record && owner) {
        recordIndex({
          repoPath: p.rootPath,
          repoName: owner.name,
          branch: branch ?? owner.defaultBranch,
          repoId: owner.id,
          folders,
        });
      }

      const scope = scopeLabel(folders);
      return {
        project: p.name,
        displayName: scope ? `${repoName} · ${scope}` : repoName,
        repoName,
        lastCommit: commit,
        rootPath: p.rootPath,
        branch: branch ?? undefined,
        folders,
        indexedAt: record?.indexedAt,
        nodes: p.nodes,
        edges: p.edges,
        sizeBytes: p.sizeBytes,
        streamableHttpUrl: `${GATEWAY_BASE}/mcp/${p.name}`,
        sseUrl: `${GATEWAY_BASE}/mcp/${p.name}/sse`,
        graphUrl: `${CBM_UI_URL}/?tab=graph&project=${encodeURIComponent(p.name)}`,
        autoUpdate: watch
          ? {
              enabled: true,
              branch: watch.branch,
              lastSha: watch.lastSha,
              lastTrigger: watch.lastTrigger,
              // Grafın gerçekten yenilendiğini gösteren tek bilgi bu.
              lastIndex: watch.lastIndex,
            }
          : { enabled: false },
      };
    }));

    res.json({
      authMode,
      gatewayBaseUrl: GATEWAY_BASE,
      cbmUiAvailable: health?.cbmUi?.available === true,
      projects: entries,
    });
  } catch (error) {
    res.status(500).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/**
 * Bir projenin grafını siler.
 *
 * Sıra önemli: önce izlemeyi durdur (yoksa bir sonraki yoklama projeyi
 * hemen yeniden indeksler), sonra grafı sil. Klonlanan kaynak kod diskte
 * kalır — yeniden indekslemek istenirse tekrar klonlama maliyeti ödenmesin.
 */
app.delete("/api/projects/:name", async (req: Request, res: Response) => {
  const project = String(req.params.name);
  try {
    /**
     * İzlemeyi KÖK YOL üzerinden buluyoruz.
     *
     * Eskiden CBM'in proje adı (`data-repos-X-Y-abc123`) ile izlemenin
     * repoName/repoPath alanları karşılaştırılıyordu; bunlar hiçbir zaman
     * eşleşmiyordu. Sonuç: silinen bir proje otomatik güncelleme açıksa bir
     * sonraki push'ta kendiliğinden geri geliyordu.
     */
    const rootPath =
      (await listProjects().catch(() => [])).find((p) => p.name === project)?.rootPath ?? "";
    const watch = rootPath
      ? listWatches().find((w) => w.repoPath === rootPath)
      : listWatches().find((w) => w.repoName === project);

    if (watch) stopWatch(watch.repoPath);

    /**
     * Süren indekslemeyi iptal et.
     *
     * CBM proje bazlı kilit tutuyor: indeksleme sürerken silme
     * "project operation cancelled or blocked by an active index" ile
     * reddediliyor. Kullanıcı silmek istediğine göre o indekslemeyi
     * sürdürmenin anlamı da yok.
     */
    const cancelled = cancelJobsForProject(project);
    if (cancelled) {
      // SIGTERM'in işlenip kilidin bırakılması için kısa bir pay.
      await new Promise((done) => setTimeout(done, 1500));
    }

    if (rootPath) forgetRecord(rootPath);

    // Çalışan iş varken daemon kurtarma yapılmaz — o işi de öldürürdü.
    const result = await deleteProject(project, { allowRecovery: !hasActiveJobs() });
    console.info(
      `[katalog] proje silindi: ${project} (${result.status})` +
        `${watch ? " — izleme de durduruldu" : ""}${result.recovered ? " — daemon temizlendi" : ""}`,
    );
    res.json({
      deleted: project,
      status: result.status,
      recovered: result.recovered,
      watchStopped: Boolean(watch),
      indexCancelled: cancelled,
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    // Kilit çatışması sunucu hatası değil: 409 ile ayırıyoruz ki arayüz
    // "tekrar deneyin" diyebilsin.
    const blocked = /blocked by an active index|operation cancelled/i.test(message);
    res.status(blocked ? 409 : 500).json({
      error: blocked
        ? "Graf şu anda indeksleme kilidi altında olduğu için silinemedi. " +
          `Birkaç saniye sonra tekrar deneyin. (CBM: ${message})`
        : message,
      retryable: blocked,
    });
  }
});

app.get("/api/projects", async (_req: Request, res: Response) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Repoyu indekslemeye hazırlar ve uygunluğunu doğrular.
 *
 * Azure DevOps repolarında klonlar/fetch eder — kullanıcıdan yol istenmez.
 * Kaynak kod yolu bu adımda türetilir ve sonraki adımlara aktarılır.
 */
/**
 * Bir dalın klasörlerini listeler — indeksleme kapsamı seçimi için.
 *
 * Kaynak sırası: yerel klon (dosya sayısı da verir) → Azure DevOps API
 * (klon gerektirmez, ama sayım vermez). Büyük repoda klasör seçebilmek için
 * tam klonu beklemek gerekmiyor.
 */
app.get("/api/repos/:id/folders", async (req: Request, res: Response) => {
  const branch = typeof req.query.branch === "string" ? req.query.branch : "";
  const path = typeof req.query.path === "string" ? req.query.path : "";

  const repo = await findRepo(String(req.params.id));
  if (!repo) {
    res.status(404).json({ error: "Repo bulunamadı." });
    return;
  }
  if (!branch) {
    res.status(400).json({ error: "branch zorunlu." });
    return;
  }

  try {
    const local = repo.source === "local" ? repo.localPath : clonePathFor(repo);
    if (local && existsSync(resolve(local, ".git"))) {
      res.json({ folders: await listFolders(local, branch, path), source: "git", counts: true });
      return;
    }

    const names = await listFolderItems(repo.id, branch, path);
    res.json({
      folders: names.map((folder) => ({
        path: folder,
        name: folder.split("/").at(-1) ?? folder,
        // API tek seviye döndüğü için alt klasör ve sayım bilinmiyor;
        // arayüz yine de açmayı denesin.
        hasChildren: true,
        fileCount: -1,
      })),
      source: "azure-devops",
      counts: false,
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

app.post("/api/prepare", async (req: Request, res: Response) => {
  const repoId = typeof req.body?.repoId === "string" ? req.body.repoId : "";
  const branch = typeof req.body?.branch === "string" ? req.body.branch : "";
  const folders = Array.isArray(req.body?.folders)
    ? (req.body.folders as unknown[]).filter((f): f is string => typeof f === "string")
    : [];

  if (!repoId || !branch) {
    res.status(400).json({ error: "repoId ve branch zorunlu." });
    return;
  }

  const repo = await findRepo(repoId);
  if (!repo) {
    res.status(404).json({ error: "Repo bulunamadı." });
    return;
  }

  const logs: string[] = [];
  try {
    const prepared = await prepareRepo(repo, branch, folders, (line) => logs.push(line));
    const path = prepared.repoPath;

    // Seçilen dal ve klasör kapsamını burada kalıcı hale getiriyoruz:
    // indeksleme ve otomatik güncelleme bundan sonra bunları esas alır.
    recordIndex({
      repoPath: path,
      repoName: repo.name,
      branch,
      repoId: repo.id,
      folders: prepared.folders,
      sha: prepared.sha,
    });

    const checks = [
      { name: "Kaynak kod hazır", ok: existsSync(path) && statSync(path).isDirectory() },
      { name: "Git reposu", ok: existsSync(resolve(path, ".git")) },
      {
        name: "'deploy' dizini yok",
        ok: !existsSync(resolve(path, "deploy")),
        note: "CBM 'deploy' adlı dizini hardcoded olarak eler; manifestleriniz oradaysa graf sessizce eksik çıkar.",
      },
    ];

    res.json({
      path,
      action: prepared.action,
      sha: prepared.sha,
      folders: prepared.folders,
      fileCount: prepared.fileCount,
      logs,
      checks,
      ready: checks.every((c) => c.ok),
    });
  } catch (error) {
    res.status(400).json({
      error: String(error instanceof Error ? error.message : error),
      logs,
    });
  }
});

app.post("/api/jobs", (req: Request, res: Response) => {
  const repoPath = typeof req.body?.repoPath === "string" ? req.body.repoPath : "";
  const repoName = typeof req.body?.repoName === "string" ? req.body.repoName : repoPath;
  if (!repoPath || !existsSync(resolve(repoPath))) {
    res.status(400).json({ error: "Geçerli bir repoPath gerekli." });
    return;
  }
  if (!isAllowedRepoPath(repoPath)) {
    res.status(400).json({
      error:
        "Bu yol indekslenemez. Yalnızca platformun kendi klon kökü ve " +
        "LOCAL_REPO_ROOTS ile açıkça izin verilen dizinler indekslenebilir.",
    });
    return;
  }

  const path = resolve(repoPath);

  // Doğrudan bu uca gelen çağrılarda da dal kaydı düşülsün.
  const branch =
    (typeof req.body?.branch === "string" && req.body.branch) || getRecord(path)?.branch;
  if (branch) recordIndex({ repoPath: path, repoName, branch });

  const job = createJob(path, repoName);
  res.status(202).json({ jobId: job.id, state: job.state });
});

/** İş ilerlemesini SSE ile akıtır. */
app.get("/api/jobs/:id/events", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: "İş bulunamadı." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const send = (event: unknown): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Geç bağlanan istemci için geçmişi tekrar oynat.
  for (const event of job.events) send(event);

  if (job.state === "succeeded" || job.state === "failed") {
    res.end();
    return;
  }

  const onEvent = (event: unknown): void => send(event);
  const onEnd = (): void => {
    res.end();
  };
  job.emitter.on("event", onEvent);
  job.emitter.once("end", onEnd);

  req.on("close", () => {
    job.emitter.off("event", onEvent);
    job.emitter.off("end", onEnd);
  });
});

interface GatewayHealth {
  authMode?: string;
  cbmUi?: { available?: boolean };
}

/**
 * Gateway'in sağlık bilgisini okur — kimlik modu ve CBM arayüz durumu.
 *
 * UI yoklamasını gateway yapıyor: CBM'in arayüzü Host başlığını denetlediği
 * için başka konteynerden doğrudan sorulduğunda 403 dönüyor.
 */
async function gatewayHealth(): Promise<GatewayHealth | null> {
  try {
    const response = await fetch(`${GATEWAY_INTERNAL}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? ((await response.json()) as GatewayHealth) : null;
  } catch {
    return null;
  }
}

/** Ulaşılamazsa 'bearer' varsayıyoruz: fazladan header zararsız, eksik header sessiz 401. */
async function gatewayAuthMode(): Promise<"none" | "bearer"> {
  const health = await gatewayHealth();
  return health?.authMode === "none" ? "none" : "bearer";
}

app.get("/api/projects/:name/endpoint", async (req: Request, res: Response) => {
  const project = String(req.params.name);
  const streamableHttpUrl = `${GATEWAY_BASE}/mcp/${project}`;
  const sseUrl = `${GATEWAY_BASE}/mcp/${project}/sse`;
  const mode = await gatewayAuthMode();
  const needsToken = mode === "bearer";

  const headers = needsToken ? { headers: { Authorization: "Bearer <TOKEN>" } } : {};

  const info: EndpointInfo = {
    project,
    streamableHttpUrl,
    sseUrl,
    authMode: mode,
    snippets: {
      "VS Code Copilot": JSON.stringify(
        { servers: { graphify: { type: "http", url: streamableHttpUrl, ...headers } } },
        null,
        2,
      ),
      "Claude Code": needsToken
        ? `claude mcp add --transport http graphify ${streamableHttpUrl} \\\n  --header "Authorization: Bearer <TOKEN>"`
        : `claude mcp add --transport http graphify ${streamableHttpUrl}`,
      "Codex CLI": needsToken
        ? `[mcp_servers.graphify]\nurl = "${streamableHttpUrl}"\nhttp_headers = { Authorization = "Bearer <TOKEN>" }`
        : `[mcp_servers.graphify]\nurl = "${streamableHttpUrl}"`,
      "SSE (eski istemciler)": JSON.stringify(
        { mcpServers: { graphify: { url: sseUrl, ...headers } } },
        null,
        2,
      ),
    },
  };
  res.json(info);
});

// ── Otomatik güncelleme: izleme + webhook ────────────────────────────────────

app.get("/api/watch", (_req: Request, res: Response) => {
  res.json({ watches: listWatches() });
});

/** Bir repoyu izlemeye alır: dal değişince graf kendiliğinden güncellenir. */
app.post("/api/watch", async (req: Request, res: Response) => {
  const repoPath = typeof req.body?.repoPath === "string" ? req.body.repoPath : "";
  const repoName = typeof req.body?.repoName === "string" ? req.body.repoName : repoPath;

  if (!repoPath || !existsSync(resolve(repoPath))) {
    res.status(400).json({ error: "Geçerli bir repoPath gerekli." });
    return;
  }
  if (!isAllowedRepoPath(repoPath)) {
    res.status(400).json({ error: "Bu yol izlenemez — izin verilen kökler dışında." });
    return;
  }

  const path = resolve(repoPath);
  /**
   * Dal sırasıyla: istekten → indeksleme kaydından → çalışma kopyasının
   * bulunduğu daldan. Eskiden burada 'master' sabiti vardı; kapsam adımında
   * başka bir dal seçilmiş olsa bile izleme master'a bakıyordu.
   */
  const branch =
    (typeof req.body?.branch === "string" && req.body.branch) ||
    getRecord(path)?.branch ||
    (await currentBranch(path).catch(() => null));

  if (!branch) {
    res.status(400).json({
      error: "İzlenecek dal belirlenemedi. Önce hazırlık adımını çalıştırın veya branch gönderin.",
    });
    return;
  }

  // Kapsam kayıtta yoksa klondan oku: izleme yanlış kapsamla çalışmasın.
  if ((getRecord(path)?.folders ?? []).length === 0) {
    const applied = await readScope(path).catch(() => []);
    if (applied.length > 0) {
      recordIndex({ repoPath: path, repoName, branch, folders: applied });
    }
  }

  res.json(startWatch(path, repoName, branch));
});

app.delete("/api/watch", (req: Request, res: Response) => {
  const repoPath = typeof req.query.repoPath === "string" ? resolve(req.query.repoPath) : "";
  res.json({ stopped: stopWatch(repoPath), watches: listWatches() });
});

app.get("/api/watch/state", (req: Request, res: Response) => {
  const repoPath = typeof req.query.repoPath === "string" ? resolve(req.query.repoPath) : "";
  res.json(getWatch(repoPath) ?? null);
});

/**
 * Azure DevOps service hook alıcısı (`git.push`).
 *
 * DİKKAT: Azure DevOps GitHub'dan farklı olarak HMAC imzalı gövde göndermez.
 * Doğrulama basic auth + IP allowlist ile yapılır. WEBHOOK_SECRET tanımlıysa
 * basic auth parolası olarak kontrol edilir.
 */
app.post("/webhooks/azdo", async (req: Request, res: Response) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const header = req.header("authorization") ?? "";
    const [scheme, value] = header.split(" ");
    const supplied =
      scheme?.toLowerCase() === "basic" && value
        ? Buffer.from(value, "base64").toString().split(":")[1]
        : undefined;
    if (supplied !== secret) {
      console.warn("[webhook] reddedildi: basic auth eşleşmedi");
      res.status(401).json({ error: "Yetkisiz." });
      return;
    }
  }

  const resource = req.body?.resource as Record<string, unknown> | undefined;
  const repository = resource?.repository as Record<string, unknown> | undefined;
  const repoName = typeof repository?.name === "string" ? repository.name : "";
  const refUpdates = Array.isArray(resource?.refUpdates) ? resource.refUpdates : [];
  const refName =
    refUpdates.length > 0 && typeof refUpdates[0]?.name === "string"
      ? String(refUpdates[0].name).replace("refs/heads/", "")
      : "";

  console.info(`[webhook] git.push alındı: repo=${repoName} ref=${refName}`);

  if (!repoName || !refName) {
    // 200 dönüyoruz: Azure DevOps hata alırsa aboneliği devre dışı bırakabilir.
    res.json({ ok: true, matched: 0, note: "Beklenen alanlar bulunamadı." });
    return;
  }

  const matched = await notifyPush(repoName, refName);
  res.json({ ok: true, matched });
});

/** Takılı CBM daemon'ını kurtarır. */
app.post("/api/recover", async (_req: Request, res: Response) => {
  await recoverDaemon();
  res.json({ ok: true, message: "Kalan CBM süreçleri temizlendi." });
});

app.listen(PORT, () => {
  console.info(`[control-api] dinlemede http://localhost:${PORT}`);
  console.info(`[control-api] gateway: ${GATEWAY_BASE}`);
  console.info(`[control-api] azure devops: ${JSON.stringify(azdoStatus())}`);
  console.info(`[control-api] durum dosyası: ${stateFilePath()}`);

  // Kaynak kodu kalmamış kayıtları at, sonra açık izlemeleri geri kur —
  // yeniden başlatma otomatik güncellemeyi sessizce kapatmasın.
  pruneMissing();
  restoreWatches();
});
