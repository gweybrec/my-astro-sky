import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitPlateSolve = vi.fn();
const pollPlateSolve = vi.fn();
const uploadPhoto = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: (...a: unknown[]) => pollPlateSolve(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
}));
const findDsoIds = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: (...a: unknown[]) => findDsoIds(...a),
}));
vi.mock('@myastrosky/core/platform/error-hook', () => ({ reportError: vi.fn() }));

import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  pendingPhotos,
  setPendingState,
} from '../src/pending-photos';
import {
  POLL_INTERVAL_MS,
  resumePendingSolves,
  solvePendingOnline,
  solvedPhotoCount,
} from '../src/pending-solve';

const corr = [{ pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '' }];
const nextPoll = () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

describe('solving a waiting photo online', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.useFakeTimers();
    configurePendingStore(createMemoryPendingStore());
    vi.clearAllMocks();
    findDsoIds.mockReturnValue(['M45']);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 300, height: 200, close: vi.fn() })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the picture, follows the job, then stores the photo placed and forgets the waiting one', async () => {
    const photo = await addPendingPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'M45_RGB.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'job-1' });
    pollPlateSolve
      .mockResolvedValueOnce({ jobId: 'job-1', status: 'solving' })
      .mockResolvedValueOnce({ jobId: 'job-1', status: 'solved', correspondences: corr });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    const before = solvedPhotoCount.value;

    await solvePendingOnline(photo.id);
    expect(submitPlateSolve.mock.calls[0][0].name).toBe('M45_RGB.jpg');
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'solving', jobId: 'job-1' });

    await nextPoll();
    expect(pendingPhotos.value[0].state).toBe('solving');
    await nextPoll();
    expect(pollPlateSolve).toHaveBeenCalledWith('job-1');
    const [file, correspondences, manual, , metadata] = uploadPhoto.mock.calls[0];
    expect([file.name, correspondences, manual]).toEqual(['M45_RGB.jpg', corr, undefined]);
    // The solver named no object: they are found from the solution and the picture's size.
    expect(findDsoIds).toHaveBeenCalledWith(corr, 300, 200);
    expect(metadata).toEqual({ dsoIds: ['M45'], displayName: 'M45_RGB' });
    expect(pendingPhotos.value).toEqual([]);
    expect(solvedPhotoCount.value).toBe(before + 1);
  });

  it("keeps the solver's own objects when it names some", async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockResolvedValue({
      jobId: 'j',
      status: 'solved',
      correspondences: corr,
      dsoIds: ['NGC7000'],
    });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    await solvePendingOnline(photo.id);
    await nextPoll();
    expect(findDsoIds).not.toHaveBeenCalled();
    expect(uploadPhoto.mock.calls[0][4].dsoIds).toEqual(['NGC7000']);
  });

  it('marks the photo as failed with the reason when the solve fails, times out or cannot be sent', async () => {
    const failing = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockResolvedValue({ jobId: 'j', status: 'failed', error: 'no stars' });
    await solvePendingOnline(failing.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'no stars' });
    expect(pendingPhotos.value[0].jobId).toBeUndefined();

    pollPlateSolve.mockResolvedValue({ jobId: 'j', status: 'timeout' });
    await solvePendingOnline(failing.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'Résolution échouée' });

    submitPlateSolve.mockRejectedValue(new Error('no connection'));
    await solvePendingOnline(failing.id);
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'no connection' });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('marks the photo as failed when it is solved but cannot be stored', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockResolvedValue({ jobId: 'j', status: 'solved', correspondences: corr });
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    await solvePendingOnline(photo.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'disk full' });
  });

  it('follows again a solve that was running, once, and fails one whose job was never created', async () => {
    const running = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    const lost = await addPendingPhoto(new Blob(['y']), 'b.jpg');
    await setPendingState(running.id, 'solving', { jobId: 'job-9' });
    await setPendingState(lost.id, 'solving');
    pollPlateSolve.mockResolvedValue({ jobId: 'job-9', status: 'solving' });

    await resumePendingSolves();
    await resumePendingSolves();
    await nextPoll();
    expect(pollPlateSolve).toHaveBeenCalledTimes(1);
    expect(pollPlateSolve).toHaveBeenCalledWith('job-9');
    expect(pendingPhotos.value.map((p) => p.state)).toEqual(['solving', 'failed']);

    // A photo removed while its solve runs is no longer followed.
    pollPlateSolve.mockClear();
    configurePendingStore(createMemoryPendingStore());
    await nextPoll();
    expect(pollPlateSolve).not.toHaveBeenCalled();
  });
});
