import { useCallback, useEffect, useState } from "react";
import {
  fetchBranches,
  fetchEndpoint,
  fetchCbmUi,
  fetchRepos,
  fetchWatchState,
  prepareRepo,
  recoverDaemon,
  startJob,
  startWatch,
  stopWatch,
  subscribeToJob,
} from "./api";
import { Stepper } from "./components/Stepper";
import { Button } from "./components/ui";
import { AutomationStep } from "./steps/AutomationStep";
import { EndpointStep } from "./steps/EndpointStep";
import { IndexStep } from "./steps/IndexStep";
import { PrecheckStep } from "./steps/PrecheckStep";
import { ScopeStep } from "./steps/ScopeStep";
import { SourceStep } from "./steps/SourceStep";
import type {
  AzdoStatus,
  EndpointInfo,
  IndexResult,
  JobState,
  PrecheckResult,
  RepoSummary,
  StepDefinition,
  StepStatus,
  WatchState,
  CbmUiStatus,
} from "./types";

const STEPS: StepDefinition[] = [
  { id: "source", title: "Kaynak", subtitle: "Repo seçimi" },
  { id: "scope", title: "Kapsam", subtitle: "Dal ve kaynak yolu" },
  { id: "precheck", title: "Ön kontrol", subtitle: "Uygunluk doğrulama" },
  { id: "index", title: "İndeksleme", subtitle: "Kod grafı çıkarma" },
  { id: "automation", title: "Otomasyon", subtitle: "Push tetikleyici" },
  { id: "endpoint", title: "Endpoint", subtitle: "MCP bağlantısı" },
];

export default function App() {
  const [current, setCurrent] = useState("source");

  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [azdo, setAzdo] = useState<AzdoStatus | null>(null);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);

  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  /** Kaynak kod yolu — kullanıcıdan istenmez, hazırlama adımında türetilir. */
  const [repoPath, setRepoPath] = useState("");

  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [precheckRunning, setPrecheckRunning] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);

  const [jobState, setJobState] = useState<JobState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);

  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(null);

  const [cbmUi, setCbmUi] = useState<CbmUiStatus | null>(null);

  const [watch, setWatch] = useState<WatchState | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  const loadRepos = useCallback((): void => {
    setReposLoading(true);
    fetchRepos()
      .then(({ repos: list, azdo: status }) => {
        setRepos(list);
        setAzdo(status);
      })
      .catch((error: unknown) => setReposError(String(error)))
      .finally(() => setReposLoading(false));
  }, []);

  useEffect(() => loadRepos(), [loadRepos]);

  /** İzleme açıkken durumu düzenli tazele — tetiklemeler arayüze yansısın. */
  useEffect(() => {
    if (!watch) return;
    const timer = setInterval(() => {
      void fetchWatchState(watch.repoPath).then((next) => {
        if (next) setWatch(next);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [watch]);

  /** Her adımın rayda görünecek durumu — tek yerden türetiliyor. */
  const statuses: Record<string, StepStatus> = {
    source: repo ? "done" : current === "source" ? "active" : "pending",
    scope: branch ? "done" : current === "scope" ? "active" : "pending",
    precheck: precheck
      ? precheck.ready
        ? "done"
        : "error"
      : precheckRunning
        ? "running"
        : current === "precheck"
          ? "active"
          : "pending",
    index:
      jobState === "succeeded"
        ? "done"
        : jobState === "failed"
          ? "error"
          : jobState === "running" || jobState === "queued"
            ? "running"
            : current === "index"
              ? "active"
              : "pending",
    automation: watch
      ? "done"
      : current === "automation" || jobState === "succeeded"
        ? "active"
        : "pending",
    endpoint: endpoint ? "done" : current === "endpoint" ? "active" : "pending",
  };

  const selectRepo = (next: RepoSummary): void => {
    setRepo(next);
    setBranch(next.defaultBranch);
    setRepoPath("");

    // Dalları yükle — kapsam adımındaki seçici bunları gösterecek.
    setBranches([]);
    setBranchesError(null);
    setBranchesLoading(true);
    fetchBranches(next.id)
      .then((list) => {
        setBranches(list.branches);
        // Varsayılan dal listede yoksa ilk dala düş.
        if (!list.branches.includes(next.defaultBranch) && list.branches.length > 0) {
          setBranch(list.branches[0]);
        }
      })
      .catch((error: unknown) => setBranchesError(String(error)))
      .finally(() => setBranchesLoading(false));

    // Repo değişince aşağıdaki tüm adımlar geçersizleşir.
    setPrecheck(null);
    setPrecheckError(null);
    setJobState(null);
    setLogs([]);
    setIndexResult(null);
    setCbmUi(null);
    setEndpoint(null);
    setWatch(null);
    setWatchError(null);
  };

  const toggleWatch = useCallback(
    async (enable: boolean): Promise<void> => {
      if (!repo) return;
      setWatchBusy(true);
      setWatchError(null);
      try {
        if (enable) {
          setWatch(await startWatch(repoPath, repo.name, branch));
        } else {
          await stopWatch(repoPath);
          setWatch(null);
        }
      } catch (error) {
        setWatchError(String(error));
      } finally {
        setWatchBusy(false);
      }
    },
    [repo, repoPath, branch],
  );

  const doPrepare = useCallback(async (): Promise<void> => {
    if (!repo) return;
    setCurrent("precheck");
    setPrecheckRunning(true);
    setPrecheckError(null);
    try {
      const result = await prepareRepo(repo.id, branch);
      setPrecheck(result);
      // Kaynak kod yolu burada belli oluyor; sonraki adımlar bunu kullanır.
      setRepoPath(result.path);
    } catch (error) {
      setPrecheckError(String(error));
    } finally {
      setPrecheckRunning(false);
    }
  }, [repo, branch]);

  const doIndex = useCallback(async (): Promise<void> => {
    if (!repo) return;
    setCurrent("index");
    setLogs([]);
    setIndexResult(null);
    setCbmUi(null);
    setJobState("queued");

    try {
      const { jobId } = await startJob(repoPath, repo.name);
      subscribeToJob(
        jobId,
        (event) => {
          if (event.type === "log" && event.message) {
            setLogs((previous) => [...previous, event.message!]);
          } else if (event.type === "state" && event.state) {
            setJobState(event.state);
          } else if (event.type === "result" && event.result) {
            setIndexResult(event.result);
            void fetchEndpoint(event.result.project).then(setEndpoint).catch(() => undefined);
            void fetchCbmUi(event.result.project).then(setCbmUi).catch(() => undefined);
          }
        },
        () => undefined,
      );
    } catch (error) {
      setLogs((previous) => [...previous, String(error)]);
      setJobState("failed");
    }
  }, [repo, repoPath]);


  const navButtons = (
    back: string | null,
    next: { label: string; action: () => void; disabled?: boolean } | null,
  ) => (
    <>
      {back && (
        <Button variant="ghost" onClick={() => setCurrent(back)}>
          Geri
        </Button>
      )}
      {next && (
        <Button onClick={next.action} disabled={next.disabled}>
          {next.label}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-edge)] px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-gray-100">Graphify</h1>
          <span className="text-xs text-gray-500">kod grafı indeksleme ve MCP yayını</span>
        </div>
        {azdo?.org && (
          <span className="font-mono text-xs text-gray-500">
            {azdo.configured ? "✓" : "✕"} dev.azure.com/{azdo.org}
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-6 p-6">
        <aside className="min-h-0 overflow-y-auto">
          <Stepper steps={STEPS} statuses={statuses} current={current} onSelect={setCurrent} />
        </aside>

        <main className="min-h-0">
          {current === "source" && (
            <SourceStep
              repos={repos}
              azdo={azdo}
              loading={reposLoading}
              error={reposError}
              selected={repo}
              onSelect={selectRepo}
              onAzdoChange={(status) => {
                setAzdo(status);
                loadRepos();
              }}
              footer={navButtons(null, {
                label: "Devam",
                action: () => setCurrent("scope"),
                disabled: !repo,
              })}
            />
          )}

          {current === "scope" && repo && (
            <ScopeStep
              repo={repo}
              branch={branch}
              onBranchChange={setBranch}
              branches={branches}
              branchesLoading={branchesLoading}
              branchesError={branchesError}
              footer={navButtons("source", {
                label:
                  repo.source === "local" ? "Ön kontrolü çalıştır" : "Kodu getir ve doğrula",
                action: () => void doPrepare(),
                disabled: !branch || branchesLoading,
              })}
            />
          )}

          {current === "precheck" && (
            <PrecheckStep
              result={precheck}
              running={precheckRunning}
              error={precheckError}
              footer={navButtons("scope", {
                label: "İndekslemeyi başlat",
                action: () => void doIndex(),
                disabled: !precheck || precheckRunning,
              })}
            />
          )}

          {current === "index" && (
            <IndexStep
              state={jobState}
              logs={logs}
              result={indexResult}
              cbmUi={cbmUi}
              footer={
                <>
                  {jobState === "failed" && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void recoverDaemon().then((r) =>
                          setLogs((previous) => [...previous, `[kurtarma] ${r.message}`]),
                        )
                      }
                    >
                      Daemon'ı kurtar
                    </Button>
                  )}
                  {navButtons("precheck", {
                    label: jobState === "failed" ? "Tekrar dene" : "Devam",
                    action:
                      jobState === "failed" ? () => void doIndex() : () => setCurrent("automation"),
                    disabled: jobState === "running" || jobState === "queued",
                  })}
                </>
              }
            />
          )}

          {current === "automation" && repo && (
            <AutomationStep
              repo={repo}
              branch={branch}
              watch={watch}
              busy={watchBusy}
              error={watchError}
              onStart={() => void toggleWatch(true)}
              onStop={() => void toggleWatch(false)}
              footer={navButtons("index", {
                label: "Endpoint'i göster",
                action: () => setCurrent("endpoint"),
              })}
            />
          )}

          {current === "endpoint" && (
            <EndpointStep endpoint={endpoint} footer={navButtons("automation", null)} />
          )}
        </main>
      </div>
    </div>
  );
}
