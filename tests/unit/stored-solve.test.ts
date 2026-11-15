import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineSolve, Photo } from '@myastrosky/core/types';

// The astrometry.net calls are mocked: nothing is ever sent.
const api = {
  pollPlateSolve: vi.fn(),
  resumePlateSolve: vi.fn(),
  setPhotoOnlineSolve: vi.fn(),
  setPhotoPlacement: vi.fn(),
  storedPhotoFile: vi.fn(),
  updatePhotoMetadata: vi.fn(),
};
vi.mock('@myastrosky/app-state/api', () => api);
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: () => ['M42'],
}));

const { followStoredSolve, canFollowStoredSolve, followStoredSolves } =
  await import('@myastrosky/app-state/stored-solve');

const CORR = [
  { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' },
  { pointIndex: 1, photoX: 9, photoY: 9, starHip: 2, starName: '' },
];

function photo(solve: Partial<OnlineSolve> | null = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.png',
    originalName: 'M42',
    width: 100,
    height: 80,
    createdAt: '2026-11-15T00:00:00.000Z',
    correspondences: [],
    dsoIds: [],
    labels: ['hiver'],
    pointsOfInterest: [],
    notes: '',
    ...(solve
      ? {
          onlineSolve: {
            state: 'unfinished',
            submissionId: 42,
            sentAt: '2026-11-15T21:42:00.000Z',
            ...solve,
          } as OnlineSolve,
        }
      : {}),
  };
}

const options = {
  wait: async () => undefined,
  now: () => Date.UTC(2026, 10, 16),
  online: () => true,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.storedPhotoFile.mockResolvedValue(new File(['x'], 'p1.png'));
  api.resumePlateSolve.mockResolvedValue({ jobId: 'job-1' });
  api.setPhotoOnlineSolve.mockResolvedValue(undefined);
  api.updatePhotoMetadata.mockResolvedValue({});
});

describe('followStoredSolve', () => {
  it('follows only a solve with a submission that is not given up', () => {
    expect(canFollowStoredSolve(photo(null))).toBe(false);
    expect(canFollowStoredSolve(photo({ submissionId: undefined }))).toBe(false);
    expect(canFollowStoredSolve(photo({ state: 'failed' }))).toBe(false);
    for (const state of ['solving', 'unfinished', 'offline'] as const) {
      expect(canFollowStoredSolve(photo({ state }))).toBe(true);
    }
  });

  it('resumes the submission without a new upload, with the FITS flag, and places the solved photo', async () => {
    api.pollPlateSolve
      .mockResolvedValueOnce({ jobId: 'job-1', status: 'solving' })
      .mockResolvedValueOnce({ jobId: 'job-1', status: 'solved', correspondences: CORR });
    api.setPhotoPlacement.mockImplementation(
      async (id: string, p: { correspondences: unknown }) => ({
        ...photo(null),
        id,
        correspondences: p.correspondences,
      }),
    );
    const changes: Photo[] = [];
    const result = await followStoredSolve(photo({ fits: true }), {
      ...options,
      onChange: (p) => changes.push(p),
    });
    expect(api.resumePlateSolve).toHaveBeenCalledWith(expect.any(File), 42, { fits: true });
    expect(api.setPhotoPlacement).toHaveBeenCalledWith('p1', { correspondences: CORR });
    expect(result.correspondences).toEqual(CORR);
    expect(result.onlineSolve).toBeUndefined();
    expect(result.dsoIds).toEqual(['M42']);
    // The objects found are added; the rest of the metadata is kept.
    expect(api.updatePhotoMetadata).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ dsoIds: ['M42'], labels: ['hiver'] }),
    );
    expect(changes.at(-1)).toBe(result);
  });

  it('keeps the solve as unfinished ("En cours") when astrometry.net has not finished', async () => {
    api.pollPlateSolve.mockResolvedValue({ jobId: 'job-1', status: 'timeout' });
    const result = await followStoredSolve(photo(), options);
    expect(result.onlineSolve).toMatchObject({
      state: 'unfinished',
      submissionId: 42,
      checkedAt: '2026-11-16T00:00:00.000Z',
    });
    expect(api.setPhotoOnlineSolve).toHaveBeenLastCalledWith('p1', result.onlineSolve);
    expect(api.setPhotoPlacement).not.toHaveBeenCalled();
  });

  it('stops for want of the network, and keeps the submission', async () => {
    const result = await followStoredSolve(photo(), { ...options, online: () => false });
    expect(result.onlineSolve).toMatchObject({ state: 'offline', submissionId: 42 });
    expect(api.resumePlateSolve).not.toHaveBeenCalled();
  });

  it('marks a solve that ended without a solution as failed, with the reason', async () => {
    api.pollPlateSolve.mockResolvedValue({ jobId: 'job-1', status: 'failed', error: 'no stars' });
    const result = await followStoredSolve(photo(), options);
    expect(result.onlineSolve).toMatchObject({ state: 'failed', error: 'no stars' });
  });

  it('follows each waiting photo in turn, and leaves the others alone', async () => {
    api.pollPlateSolve.mockResolvedValue({ jobId: 'job-1', status: 'timeout' });
    await followStoredSolves(
      [photo(), photo({ state: 'failed' }), { ...photo(), id: 'p2' }],
      options,
    );
    expect(api.resumePlateSolve).toHaveBeenCalledTimes(2);
  });
});
