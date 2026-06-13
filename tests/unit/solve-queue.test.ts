import { describe, it, expect, vi } from 'vitest';
import { createJob, getJob, updateJob, cancelJob } from '../../server/solve-queue';

describe('solve-queue', () => {
  it('createJob returns a pending job with a valid id', () => {
    const job = createJob();
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.status).toBe('pending');
    expect(job.abortController).toBeInstanceOf(AbortController);
    expect(typeof job.createdAt).toBe('number');
  });

  it('getJob returns the job by id', () => {
    const job = createJob();
    const found = getJob(job.id);
    expect(found).toBe(job);
  });

  it('getJob returns undefined for unknown id', () => {
    expect(getJob('does-not-exist')).toBeUndefined();
  });

  it('updateJob mutates status on an existing job', () => {
    const job = createJob();
    updateJob(job.id, { status: 'running' });
    expect(getJob(job.id)!.status).toBe('running');
  });

  it('updateJob mutates result and error', () => {
    const job = createJob();
    const result = { success: true, correspondences: [] };
    updateJob(job.id, { status: 'success', result, error: undefined });
    const found = getJob(job.id)!;
    expect(found.result).toBe(result);
    expect(found.status).toBe('success');
  });

  it('updateJob is a no-op for unknown id', () => {
    expect(() => updateJob('ghost', { status: 'failed' })).not.toThrow();
  });

  it('cancelJob aborts the controller and sets status to canceled', () => {
    const job = createJob();
    const spy = vi.spyOn(job.abortController, 'abort');
    const ok = cancelJob(job.id);
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    expect(getJob(job.id)!.status).toBe('canceled');
  });

  it('cancelJob returns false for unknown id', () => {
    expect(cancelJob('nonexistent')).toBe(false);
  });

  it('cancelJob does not change status of a completed job', () => {
    const job = createJob();
    updateJob(job.id, { status: 'success' });
    cancelJob(job.id);
    expect(getJob(job.id)!.status).toBe('success');
  });

  it('concurrent jobs are independent', () => {
    const a = createJob();
    const b = createJob();
    updateJob(a.id, { status: 'running' });
    expect(getJob(b.id)!.status).toBe('pending');
    expect(getJob(a.id)!.status).toBe('running');
  });

  it('TTL eviction removes stale jobs on next createJob', () => {
    const stale = createJob();
    // Backdate the job's createdAt by 3 hours
    (stale as any).createdAt = Date.now() - 3 * 60 * 60 * 1000;
    // Trigger eviction via a new createJob call
    createJob();
    expect(getJob(stale.id)).toBeUndefined();
  });
});
