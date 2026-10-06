/**
 * `src/api.ts` is a facade over the backend: what it hands the backend, what it gives back, and how it
 * turns the backend's `DomainError` into the plain `Error` the screens show. A fake backend stands in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Backend } from '@myastrosky/core/backend';
import { DomainError, type DomainErrorKind } from '@myastrosky/core/domain/errors';
import type { ErrorCode } from '@myastrosky/core/domain/error-codes';
import { t } from '../../src/i18n';
import { setBackend } from '../../src/backend';
import * as api from '../../src/api';

const fail = (kind: DomainErrorKind, message: string, code: string) =>
  new DomainError(kind, message, { code: code as ErrorCode });

/** A backend of vi.fn() members; each test sets what it needs. */
function fake() {
  const backend = {
    capabilities: { localSolvers: true },
    files: { url: vi.fn((name: string) => `/stored/${name}`) },
    catalog: { starCatalogUrl: vi.fn() },
    plans: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      addEntry: vi.fn(),
      removeEntry: vi.fn(),
      updateEntry: vi.fn(),
    },
    photos: { upload: vi.fn(), listWithSizes: vi.fn() },
    gear: { listCatalog: vi.fn(), listSetups: vi.fn() },
    settings: { readPublic: vi.fn() },
    stars: { search: vi.fn(), nearby: vi.fn() },
    version: { getLatest: vi.fn() },
    identify: { getCometElements: vi.fn() },
    novaSolve: { getJob: vi.fn(), reuse: vi.fn(), submit: vi.fn() },
    solvedImport: { solveWcs: vi.fn(), convert: vi.fn() },
    backup: { exportToUser: vi.fn() },
    localSolvers: { submit: vi.fn(), poll: vi.fn(), cancel: vi.fn(), probe: vi.fn() },
  };
  setBackend(backend as unknown as Backend);
  return backend;
}

let backend: ReturnType<typeof fake>;
beforeEach(() => {
  backend = fake();
});

async function thrown(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    return e as Error;
  }
  throw new Error('it resolved');
}

describe('errors', () => {
  it('shows the message of the error code, as a plain Error', async () => {
    backend.plans.list.mockRejectedValue(fail('invalid', 'raw text', 'MISSING_NAME'));
    const e = await thrown(api.getPlans());
    expect(e).not.toBeInstanceOf(DomainError);
    expect(e.message).toBe(t('serverErrors.MISSING_NAME'));
  });

  it('shows the error message when the code has no message of its own', async () => {
    backend.plans.list.mockRejectedValue(fail('upstream', 'raw text', 'NO_SUCH_CODE'));
    expect((await thrown(api.getPlans())).message).toBe('raw text');
  });

  it('falls back to the function text when there is neither', async () => {
    backend.plans.list.mockRejectedValue(fail('upstream', '', 'NO_SUCH_CODE'));
    expect((await thrown(api.getPlans())).message).toBe(t('errors.loadPlans'));
  });

  it('lets a cancelled transfer through as it is', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    backend.solvedImport.convert.mockRejectedValue(abort);
    const e = await thrown(api.convertRawPhoto(new File(['x'], 'a.fits')));
    expect(e).toBe(abort);
  });
});

describe('ordinary functions', () => {
  it('createPlanAPI passes the name and returns the id', async () => {
    backend.plans.create.mockResolvedValue({ id: 'p1' });
    expect(await api.createPlanAPI('Night')).toEqual({ id: 'p1' });
    expect(backend.plans.create).toHaveBeenCalledWith({ name: 'Night' });
  });

  it('removePlanEntryAPI and updatePlanEntryPAAPI pass the real plan id', async () => {
    await api.removePlanEntryAPI('plan-1', 'entry-1');
    expect(backend.plans.removeEntry).toHaveBeenCalledWith('entry-1', 'plan-1');
    await api.updatePlanEntryPAAPI('plan-1', 'entry-1', 45);
    expect(backend.plans.updateEntry).toHaveBeenCalledWith('entry-1', { paDeg: 45 }, 'plan-1');
    await api.updatePlanEntryPositionAPI('plan-1', 'entry-1', { ra: 1, dec: 2 });
    expect(backend.plans.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      { ra: 1, dec: 2 },
      'plan-1',
    );
  });

  it('uploadPhoto sends the file as a FileSource and the fields as text', async () => {
    const photo = { id: 'ph1' };
    backend.photos.upload.mockResolvedValue(photo);
    const file = new File(['abc'], 'm31.jpg');
    const onProgress = vi.fn();
    const corr = [{ pointIndex: 0 }] as never;
    expect(await api.uploadPhoto(file, corr, undefined, onProgress, { notes: 'hi' })).toBe(photo);
    const [source, fields, options] = backend.photos.upload.mock.calls[0];
    expect([source.name, source.size, source.native]).toEqual(['m31.jpg', 3, file]);
    expect(fields).toEqual({ correspondences: JSON.stringify(corr), notes: 'hi' });
    expect(options).toEqual({ onProgress });
    expect(await source.read()).toEqual(new Uint8Array([97, 98, 99]));
  });

  it('getGearCatalog and photoFileUrl go to the backend', async () => {
    backend.gear.listCatalog.mockResolvedValue([{ id: 't' }]);
    expect(await api.getGearCatalog('telescope')).toEqual([{ id: 't' }]);
    expect(backend.gear.listCatalog).toHaveBeenCalledWith('telescope');
    expect(api.photoFileUrl('a.jpg')).toBe('/stored/a.jpg');
  });

  it('loadServerSettings returns the settings and translates its failure', async () => {
    backend.settings.readPublic.mockResolvedValueOnce({ apiKeySet: true });
    expect(await api.loadServerSettings()).toEqual({ apiKeySet: true });
    backend.settings.readPublic.mockRejectedValue(fail('upstream', 'x', 'NETWORK_ERROR'));
    expect((await thrown(api.loadServerSettings())).message).toBe(t('serverErrors.NETWORK_ERROR'));
  });

  it('exportData hands the request over and returns nothing', async () => {
    backend.backup.exportToUser.mockResolvedValue(undefined);
    expect(await api.exportData({} as never, ['a'], { k: 1 })).toBeUndefined();
    expect(backend.backup.exportToUser).toHaveBeenCalledWith({
      options: {},
      ids: ['a'],
      shortcuts: { k: 1 },
    });
  });
});

describe('special cases', () => {
  it('searchStarsAPI and searchStarsByPosition answer [] on any error', async () => {
    backend.stars.search.mockRejectedValue(new Error('x'));
    backend.stars.nearby.mockRejectedValue(new Error('x'));
    expect(await api.searchStarsAPI('vega')).toEqual([]);
    expect(await api.searchStarsByPosition({ ra: 1, dec: 2, radius: 3 })).toEqual([]);
    backend.stars.search.mockResolvedValue([{ hip: 1 }]);
    expect(await api.searchStarsAPI('vega', 5)).toEqual([{ hip: 1 }]);
    expect(backend.stars.search).toHaveBeenLastCalledWith('vega', 5);
  });

  it('getLatestVersion answers null on any error', async () => {
    backend.version.getLatest.mockRejectedValue(new Error('offline'));
    expect(await api.getLatestVersion()).toBeNull();
  });

  it('reuseAstrometrySubmission returns a failed result instead of throwing', async () => {
    backend.novaSolve.reuse.mockRejectedValue(fail('invalid', 'raw', 'NO_SUCH_CODE'));
    expect(await api.reuseAstrometrySubmission(new File(['x'], 'a.jpg'), 7)).toEqual({
      success: false,
      error: 'raw',
    });
    expect(backend.novaSolve.reuse.mock.calls[0][1]).toBe(7);
  });

  it('pollPlateSolve answers "solving" when rate limited, and throws other errors', async () => {
    backend.novaSolve.getJob.mockRejectedValueOnce(fail('rateLimited', 'slow', 'HTTP_429'));
    expect(await api.pollPlateSolve('j1')).toEqual({ jobId: 'j1', status: 'solving' });
    backend.novaSolve.getJob.mockRejectedValueOnce(fail('notFound', 'gone', 'NO_SUCH_CODE'));
    expect((await thrown(api.pollPlateSolve('j1'))).message).toBe('gone');
  });

  it('pollLocalSolveJob answers "pending" when rate limited', async () => {
    backend.localSolvers.poll.mockRejectedValueOnce(fail('rateLimited', 'slow', 'HTTP_429'));
    expect(await api.pollLocalSolveJob('/api/solve-astap', 'j1')).toEqual({ status: 'pending' });
    expect(backend.localSolvers.poll).toHaveBeenCalledWith('astap', 'j1');
  });

  it('submitLocalSolveJob names the solver and passes the signal as the cancel', async () => {
    backend.localSolvers.submit.mockResolvedValue('job-9');
    const signal = new AbortController().signal;
    const hints = { ra: 1 };
    expect(
      await api.submitLocalSolveJob('/api/solve-field', new File(['x'], 'a.jpg'), hints, signal),
    ).toEqual({ jobId: 'job-9' });
    const [solver, , sentHints, options] = backend.localSolvers.submit.mock.calls[0];
    expect([solver, sentHints, options]).toEqual(['solve-field', hints, { cancel: signal }]);
  });

  it('cancelLocalSolveJob swallows errors', async () => {
    backend.localSolvers.cancel.mockRejectedValue(fail('notFound', 'x', 'JOB_NOT_FOUND'));
    await expect(api.cancelLocalSolveJob('/api/solve-astap', 'j1')).resolves.toBeUndefined();
  });

  it('the local-solver functions fail with LOCAL_SOLVERS_UNAVAILABLE when there are none', async () => {
    delete (backend as { localSolvers?: unknown }).localSolvers;
    const e = await thrown(api.probeLocalSolver('astap', { path: '/a' }));
    expect(e.message).toBe(t('serverErrors.LOCAL_SOLVERS_UNAVAILABLE'));
    expect((await thrown(api.pollLocalSolveJob('/api/solve-astap', 'j'))).message).toBe(
      t('serverErrors.LOCAL_SOLVERS_UNAVAILABLE'),
    );
    await expect(api.cancelLocalSolveJob('/api/solve-astap', 'j')).resolves.toBeUndefined();
  });

  it('cometElementsAPI keeps the last successful answer and retries after a failure', async () => {
    backend.identify.getCometElements.mockRejectedValueOnce(fail('upstream', 'x', 'NETWORK_ERROR'));
    await thrown(api.cometElementsAPI());
    backend.identify.getCometElements.mockResolvedValue([{ name: 'C' }]);
    expect(await api.cometElementsAPI()).toEqual([{ name: 'C' }]);
    expect(await api.cometElementsAPI()).toEqual([{ name: 'C' }]);
    expect(backend.identify.getCometElements).toHaveBeenCalledTimes(2);
  });

  it('convertRawPhoto returns a browser File built from the returned picture', async () => {
    backend.solvedImport.convert.mockResolvedValue({
      png: new Uint8Array([1, 2, 3]),
      success: true,
      width: 10,
      height: 20,
    });
    const onProgress = vi.fn();
    const result = await api.convertRawPhoto(new File(['raw'], 'M31.fits'), onProgress);
    expect(result.png).toBeInstanceOf(File);
    expect([result.png.name, result.png.type, result.png.size]).toEqual([
      'M31.png',
      'image/png',
      3,
    ]);
    expect(result.meta).toEqual({ success: true, width: 10, height: 20 });
    expect(backend.solvedImport.convert.mock.calls[0][1]).toEqual({
      onProgress,
      cancel: undefined,
    });
  });

  it('solveWCS keeps the failure result with its translated text', async () => {
    backend.solvedImport.solveWcs.mockResolvedValue({ success: false, code: 'NO_WCS_DATA' });
    const result = await api.solveWCS(new File(['x'], 'a.fits'), 100, 200);
    expect(result).toEqual({
      success: false,
      code: 'NO_WCS_DATA',
      error: t('serverErrors.NO_WCS_DATA'),
    });
    expect(backend.solvedImport.solveWcs.mock.calls[0][1]).toEqual({ width: 100, height: 200 });
  });
});
