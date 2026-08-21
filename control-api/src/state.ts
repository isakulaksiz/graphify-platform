import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CLONE_ROOT } from "./clone.js";

/**
 * İndekslenen projelerin kalıcı kaydı.
 *
 * NEDEN VAR: bir grafın hangi daldan çıkarıldığı, indekslemeden sonra hiçbir
 * yerde yazmıyordu. CBM proje listesinde dal bilgisi yok, izleme kaydı ise
 * yalnızca bellekteydi. Sonuç olarak:
 *
 *   - katalog "bu graf hangi koddan çıktı" sorusunu cevaplayamıyordu,
 *   - otomatik güncelleme dal bilgisi verilmediğinde 'master'a düşüyordu —
 *     kapsam adımında başka bir dal seçilmiş olsa bile,
 *   - konteyner yeniden başlatılınca izleme sessizce kapanıyordu.
 *
 * Kayıt tek bir JSON dosyası: kayıt sayısı repo sayısı kadar, veritabanı
 * getirisi yok.
 */

/**
 * Kayıt dosyası klon kökünün İÇİNDE duruyor.
 *
 * Docker'da yalnızca /data/cbm ve /data/repos birer volume; /data'nın kendisi
 * konteynerin yazılabilir katmanı. Dosyayı /data'ya koymak `--force-recreate`
 * sonrası kaydı sessizce yok ederdi. Klon kökü aynı zamanda doğru yer: kayıt
 * zaten oradaki klonları tarif ediyor, hacim silinirse ikisi birlikte gider.
 */
const STATE_FILE = resolve(
  process.env.STATE_FILE ?? join(CLONE_ROOT, ".graphify-state.json"),
);

export interface IndexRecord {
  /** Kaynak kodun diskteki yolu — kayıtların anahtarı. */
  repoPath: string;
  repoName: string;
  /** İndekslemede kullanılan dal. Otomatik güncelleme bunu izler. */
  branch: string;
  repoId?: string;
  /** Uygulanan klasör kapsamı; boş/eksik = tüm repo. */
  folders?: string[];
  /** İndekslemenin yapıldığı commit. */
  sha?: string;
  indexedAt: string;
  /** Otomatik güncelleme açık mı — yeniden başlatmada geri kurulur. */
  autoUpdate: boolean;
}

let records = new Map<string, IndexRecord>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;

  if (!existsSync(STATE_FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { records?: IndexRecord[] };
    for (const record of parsed.records ?? []) {
      if (record.repoPath && record.branch) records.set(resolve(record.repoPath), record);
    }
    console.info(`[state] ${records.size} kayıt okundu: ${STATE_FILE}`);
  } catch (error) {
    // Bozuk dosya yüzünden servis açılmasın diye yutuyoruz; kayıtlar yeniden
    // indekslemede kendiliğinden oluşur.
    console.error(`[state] okunamadı (${STATE_FILE}): ${String(error)}`);
    records = new Map();
  }
}

/** Atomik yazım: yarım yazılmış dosya bir sonraki açılışta kaydı yok etmesin. */
function persist(): void {
  const payload = JSON.stringify({ records: [...records.values()] }, null, 2);
  const temporary = `${STATE_FILE}.tmp`;
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(temporary, payload, "utf8");
    renameSync(temporary, STATE_FILE);
  } catch (error) {
    console.error(`[state] yazılamadı (${STATE_FILE}): ${String(error)}`);
  }
}

export function getRecord(repoPath: string): IndexRecord | undefined {
  load();
  return records.get(resolve(repoPath));
}

export function listRecords(): IndexRecord[] {
  load();
  return [...records.values()];
}

/** İndeksleme sonrası çağrılır; dal ve commit bilgisini kalıcı hale getirir. */
export function recordIndex(input: {
  repoPath: string;
  repoName: string;
  branch: string;
  repoId?: string;
  folders?: string[];
  sha?: string;
}): IndexRecord {
  load();
  const key = resolve(input.repoPath);
  const previous = records.get(key);

  const record: IndexRecord = {
    ...previous,
    repoPath: key,
    repoName: input.repoName,
    branch: input.branch,
    repoId: input.repoId ?? previous?.repoId,
    folders: input.folders ?? previous?.folders ?? [],
    sha: input.sha ?? previous?.sha,
    indexedAt: new Date().toISOString(),
    autoUpdate: previous?.autoUpdate ?? false,
  };

  records.set(key, record);
  persist();
  return record;
}

export function setAutoUpdate(repoPath: string, enabled: boolean, branch?: string): void {
  load();
  const key = resolve(repoPath);
  const record = records.get(key);
  if (!record) return;

  record.autoUpdate = enabled;
  if (branch) record.branch = branch;
  persist();
}

export function forgetRecord(repoPath: string): void {
  load();
  if (records.delete(resolve(repoPath))) persist();
}

export function stateFilePath(): string {
  return STATE_FILE;
}

/**
 * Kaynak kodu artık diskte olmayan kayıtları atar.
 *
 * Kayıt yalnızca graf CBM'den silinirken temizleniyordu; klon elle kaldırılmış
 * ya da graf başka bir yoldan yok olmuşsa kayıt sonsuza kadar kalıyor ve
 * açılışta "yol yok" uyarısı üretiyordu. Açılışta bir kez süpürmek yeterli.
 */
export function pruneMissing(): number {
  load();
  let removed = 0;
  for (const [key, record] of records) {
    if (existsSync(record.repoPath)) continue;
    records.delete(key);
    removed += 1;
    console.info(`[state] kayıt atıldı, kaynak kod yok: ${record.repoName} (${record.repoPath})`);
  }
  if (removed > 0) persist();
  return removed;
}
