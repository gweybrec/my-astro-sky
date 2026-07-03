import { randomUUID } from 'crypto';

export interface LocalSolveJob {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'canceled';
  result?: unknown;
  error?: string;
  abortController: AbortController;
  createdAt: number;
}

const jobs = new Map<string, LocalSolveJob>();
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function createJob(): LocalSolveJob {
  evictStaleJobs();
  const job: LocalSolveJob = {
    id: randomUUID(),
    status: 'pending',
    abortController: new AbortController(),
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): LocalSolveJob | undefined {
  return jobs.get(id);
}

export function updateJob(
  id: string,
  updates: Partial<Pick<LocalSolveJob, 'status' | 'result' | 'error'>>,
): void {
  const job = jobs.get(id);
  if (job) Object.assign(job, updates);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.abortController.abort();
  if (job.status !== 'success' && job.status !== 'failed') {
    job.status = 'canceled';
  }
  return true;
}
