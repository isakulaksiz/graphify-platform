import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { indexRepository, invalidateProjectCache } from "./cbm.js";
import type { IndexResult, JobEvent, JobState } from "./types.js";

interface Job {
  id: string;
  repoPath: string;
  repoName: string;
  state: JobState;
  events: JobEvent[];
  emitter: EventEmitter;
  result?: IndexResult;
  error?: string;
  cancel?: () => void;
}

const jobs = new Map<string, Job>();

/** Aynı repoya eşzamanlı iş açılmasını engeller — CBM'de proje bazlı kilit var. */
const activeByPath = new Map<string, string>();

function push(job: Job, event: JobEvent): void {
  job.events.push(event);
  job.emitter.emit("event", event);
}

export function createJob(repoPath: string, repoName: string): Job {
  const existing = activeByPath.get(repoPath);
  if (existing) {
    const running = jobs.get(existing);
    if (running && (running.state === "queued" || running.state === "running")) {
      return running;
    }
  }

  const job: Job = {
    id: randomUUID(),
    repoPath,
    repoName,
    state: "queued",
    events: [],
    emitter: new EventEmitter(),
  };
  jobs.set(job.id, job);
  activeByPath.set(repoPath, job.id);

  // Abonelerin bağlanmasına fırsat vermek için bir tick sonra başlat.
  setImmediate(() => void run(job));
  return job;
}

async function run(job: Job): Promise<void> {
  job.state = "running";
  push(job, { type: "state", at: new Date().toISOString(), state: "running" });
  push(job, {
    type: "log",
    at: new Date().toISOString(),
    message: `İndeksleme başlatılıyor: ${job.repoPath}`,
  });

  const handle = indexRepository(job.repoPath, (line) => {
    push(job, { type: "log", at: new Date().toISOString(), message: line });
  });
  job.cancel = handle.cancel;

  try {
    const result = await handle.done;
    invalidateProjectCache();
    job.result = result;
    job.state = "succeeded";
    push(job, { type: "result", at: new Date().toISOString(), result });
    push(job, { type: "state", at: new Date().toISOString(), state: "succeeded" });
  } catch (error) {
    job.error = String(error);
    job.state = "failed";
    push(job, { type: "log", at: new Date().toISOString(), message: job.error });
    push(job, { type: "state", at: new Date().toISOString(), state: "failed" });
  } finally {
    activeByPath.delete(job.repoPath);
    job.emitter.emit("end");
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export type { Job };
