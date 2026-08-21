import { BranchSelect } from "../components/BranchSelect";
import { FolderPicker } from "../components/FolderPicker";
import { Callout, Field, Panel } from "../components/ui";
import type { RepoSummary } from "../types";

export function ScopeStep({
  repo,
  branch,
  onBranchChange,
  branches,
  branchesLoading,
  branchesError,
  folders,
  onFoldersChange,
  footer,
}: {
  repo: RepoSummary;
  branch: string;
  onBranchChange: (value: string) => void;
  branches: string[];
  branchesLoading: boolean;
  branchesError: string | null;
  folders: string[];
  onFoldersChange: (folders: string[]) => void;
  footer: React.ReactNode;
}) {
  return (
    <Panel
      title="Kapsam"
      description="Hangi dalın ve hangi klasörlerin grafı çıkarılacak."
      footer={footer}
    >
      <div className="max-w-2xl space-y-5">
        <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-soft)] px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Seçilen repo</p>
          <p className="mt-1 font-medium text-gray-100">{repo.name}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {repo.source === "local" ? "yerel klon" : `Azure DevOps · ${repo.project ?? ""}`}
          </p>
        </div>

        <Field label="Dal" hint="Otomatik güncelleme bu dala gelen commit'lerle tetiklenecek.">
          <BranchSelect
            branches={branches}
            value={branch}
            onChange={onBranchChange}
            loading={branchesLoading}
            error={branchesError}
            defaultBranch={repo.defaultBranch}
          />
        </Field>

        {repo.source === "local" ? (
          <Callout tone="info" title="Klasör kapsamı yerel repolarda kullanılamaz">
            Kapsamı daraltmak çalışma kopyanızdan dosya kaldırmak anlamına gelirdi.
            Azure DevOps üzerinden seçilen repolarda platform kendi klonunu açtığı için
            bu güvenle yapılabiliyor.
          </Callout>
        ) : (
          <Field
            label="Klasörler"
            hint="Seçim yapmazsanız tüm repo indekslenir. Üst klasörü seçmek altındakileri de kapsar."
          >
            <FolderPicker
              repoId={repo.id}
              branch={branch}
              selected={folders}
              onChange={onFoldersChange}
              disabled={!branch}
            />
          </Field>
        )}

        {folders.length > 0 && (
          <Callout tone="info" title="Kapsam dışı dosyalar diske hiç inmiyor">
            <p>
              CBM'in indeksleme aracı klasör filtresi almıyor, dolayısıyla kapsamı git
              tarafında uyguluyoruz: <code>sparse-checkout</code> ile yalnızca seçtiğiniz
              klasörler çalışma kopyasına yazılıyor. İndirilmeyen dosya için ne ayrıştırma
              ne LSP çözümlemesi yapılıyor — kazanç buradan geliyor.
            </p>
            <p className="mt-2">
              Seçilen klasörler arasındaki çağrı ve veri akışı ilişkileri korunur; kapsam
              dışında kalan klasörlere giden bağlantılar grafta görünmez. Repo kökündeki
              dosyalar (README, derleme yapılandırmaları) her zaman dahil edilir.
            </p>
          </Callout>
        )}

        <Callout tone="info" title="Kaynak kodu platform kendisi getirir">
          {repo.source === "local" ? (
            <p>
              Bu repo diskte hazır olduğu için klonlama yapılmaz; doğrudan indekslenir.
            </p>
          ) : (
            <p>
              Bir sonraki adımda repo klonlanır (varsa mevcut klon güncellenir) ve seçtiğiniz
              dala geçilir. Erişim için girdiğiniz token kullanılır; token URL'ye gömülmez,
              her git çağrısında header olarak geçirilir.
            </p>
          )}
        </Callout>

        <Callout tone="info" title="İndeksleme kapsamı">
          CBM <code>.gitignore</code> hiyerarşisini ve <code>.cbmignore</code> dosyasını uygular.
          Üretilmiş kod ve vendor dizinlerini repo köküne koyacağınız bir <code>.cbmignore</code>{" "}
          ile eleyebilirsiniz.
        </Callout>
      </div>
    </Panel>
  );
}
