import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config } from "../config.js";

const execFileAsync = promisify(execFile);

/**
 * codebase-memory-mcp'ye giden TEK paylaşımlı stdio bağlantısı.
 *
 * Neden tek: CBM tek OS hesabında tek canonical cache root'a izin veriyor ve
 * tüm projelerin grafı o tek veritabanında duruyor. Proje başına ayrı süreç
 * açmak reddedilir. Kapsamlama bu yüzden protokol katmanında yapılır
 * (bkz. mcp/scope.ts).
 *
 * Neden sağlık kontrolü: yarıda kesilen bir CBM oturumu daemon'u "version
 * cohort claim" tutar halde bırakabiliyor. Bu durumda sonraki her komut 30
 * saniye bekleyip şu hatayı veriyor:
 *
 *   CBM daemon is active or starting but could not accept this client within 30000 ms
 *
 * Tek cache root modelinde bu, tek bir bozuk oturumun TÜM repoları kilitlemesi
 * demek. Otomatik kurtarma bu yüzden opsiyonel değil.
 */
export class CbmUpstream {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private starting: Promise<Client> | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly config: Config) {}

  /** Hazır bir istemci döndürür; gerekiyorsa upstream'i başlatır. */
  async getClient(): Promise<Client> {
    if (this.closed) {
      throw new Error("Gateway kapanıyor, yeni upstream bağlantısı açılmıyor.");
    }
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      CBM_CACHE_DIR: this.config.cbmCacheDir,
      CBM_LOG_LEVEL: process.env.CBM_LOG_LEVEL ?? "warn",
    };
    // Container'da cgroup limitleri yanlış okunduğu için elle verilir.
    if (this.config.cbmWorkers) env.CBM_WORKERS = this.config.cbmWorkers;
    if (this.config.cbmMemBudgetMb) env.CBM_MEM_BUDGET_MB = this.config.cbmMemBudgetMb;
    // Çok kiracılı kurulumda indekslemeyi tek köke hapseder.
    if (this.config.cbmAllowedRoot) env.CBM_ALLOWED_ROOT = this.config.cbmAllowedRoot;
    return env;
  }

  private async start(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: this.config.cbmBinary,
      env: this.buildEnv(),
      stderr: "pipe",
    });

    transport.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.error(`[cbm] ${line}`);
    });

    const client = new Client(
      { name: "graphify-gateway", version: "0.1.0" },
      { capabilities: {} },
    );

    transport.onclose = () => {
      if (this.transport === transport) {
        console.error("[upstream] CBM bağlantısı kapandı; sonraki istekte yeniden açılacak.");
        this.client = null;
        this.transport = null;
      }
    };

    await client.connect(transport);

    this.client = client;
    this.transport = transport;
    console.error(`[upstream] CBM bağlandı (pid=${transport.pid ?? "?"})`);
    return client;
  }

  /**
   * Takılı upstream'i kurtarır.
   *
   * Sıra önemli: önce kendi bağlantımızı kapatırız, sonra bu container'da
   * kalan CBM süreçlerini temizleriz. İkinci adım olmadan takılı daemon
   * cohort claim'i tutmaya devam eder ve yeni süreç de 30 sn sonra hata verir.
   *
   * NOT: pkill bu container'ın PID namespace'i ile sınırlıdır. Indexer worker
   * ayrı bir pod'da çalıştığı için onun süreçleri etkilenmez.
   */
  async recover(reason: string): Promise<void> {
    console.error(`[upstream] kurtarma başlatıldı: ${reason}`);
    const transport = this.transport;
    this.client = null;
    this.transport = null;

    if (transport) {
      await transport.close().catch((error: unknown) => {
        console.error(`[upstream] transport kapatılamadı: ${String(error)}`);
      });
    }

    try {
      await execFileAsync("pkill", ["-f", "codebase-memory-mcp"]);
      console.error("[upstream] kalan CBM süreçleri temizlendi");
    } catch {
      // pkill eşleşme bulamazsa 1 ile çıkar — bu normal, temizlenecek bir şey yoktu.
    }
  }

  /** Upstream'in yanıt verdiğini doğrular. */
  private async probe(): Promise<void> {
    const client = await this.getClient();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`sağlık kontrolü ${this.config.upstreamHealthTimeoutMs} ms içinde yanıtlamadı`)),
        this.config.upstreamHealthTimeoutMs,
      );
    });
    await Promise.race([client.listTools(), timeout]);
  }

  /** Periyodik sağlık kontrolünü başlatır. */
  startHealthLoop(): void {
    this.healthTimer = setInterval(() => {
      void this.probe().catch(async (error: unknown) => {
        await this.recover(`sağlık kontrolü başarısız: ${String(error)}`);
      });
    }, this.config.upstreamHealthIntervalMs);
    this.healthTimer.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (transport) await transport.close().catch(() => undefined);
  }
}
