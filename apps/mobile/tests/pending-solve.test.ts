import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitPlateSolve = vi.fn();
const pollPlateSolve = vi.fn();
const resumePlateSolve = vi.fn();
const uploadPhoto = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: (...a: unknown[]) => pollPlateSolve(...a),
  resumePlateSolve: (...a: unknown[]) => resumePlateSolve(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
}));
const findDsoIds = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: (...a: unknown[]) => findDsoIds(...a),
}));
vi.mock('@myastrosky/core/platform/error-hook', () => ({ reportError: vi.fn() }));
const showNotice = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showNotice }) }));

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
/** An error as the API facade throws it: the message, and the code of a refused call. */
const refused = (message: string, code?: string) => Object.assign(new Error(message), { code });
const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);

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
    vi.restoreAllMocks();
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

  it('records the submission of the job, then follows it again under a new job after a restart', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'job-1' });
    pollPlateSolve.mockResolvedValue({ jobId: 'job-1', status: 'solving', submissionId: 42 });
    await solvePendingOnline(photo.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ jobId: 'job-1', submissionId: 42 });

    // The restart: the solver forgot its jobs and the following loop is gone.
    configurePendingStore(createMemoryPendingStore());
    const again = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    await setPendingState(again.id, 'solving', { jobId: 'job-1', submissionId: 42 });
    pollPlateSolve.mockReset();
    pollPlateSolve
      .mockRejectedValueOnce(refused('Job introuvable', 'JOB_NOT_FOUND'))
      .mockResolvedValue({ jobId: 'job-2', status: 'solved', correspondences: corr });
    resumePlateSolve.mockResolvedValue({ jobId: 'job-2' });
    uploadPhoto.mockResolvedValue({ id: 'p1' });

    await resumePendingSolves();
    await nextPoll();
    // The job is unknown: it is started again from its submission at the next poll.
    await nextPoll();
    expect(resumePlateSolve.mock.calls[0][0].name).toBe('a.jpg');
    expect(resumePlateSolve.mock.calls[0][1]).toBe(42);
    expect(pendingPhotos.value[0]).toMatchObject({
      state: 'solving',
      jobId: 'job-2',
      submissionId: 42,
    });
    await nextPoll();
    expect(pollPlateSolve).toHaveBeenLastCalledWith('job-2');
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('fails a job the solver no longer knows when its submission was never recorded', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    await setPendingState(photo.id, 'solving', { jobId: 'job-1' });
    pollPlateSolve.mockRejectedValue(refused('Job introuvable', 'JOB_NOT_FOUND'));
    await resumePendingSolves();
    await nextPoll();
    expect(resumePlateSolve).not.toHaveBeenCalled();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'Job introuvable' });
  });

  it('stops following without a network, keeps the job and says once where to find the result', async () => {
    const a = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    const b = await addPendingPhoto(new Blob(['y']), 'b.jpg');
    await setPendingState(a.id, 'solving', { jobId: 'job-a', submissionId: 1 });
    await setPendingState(b.id, 'solving', { jobId: 'job-b', submissionId: 2 });
    setOnline(false);
    await resumePendingSolves();
    await nextPoll();
    expect(pollPlateSolve).not.toHaveBeenCalled();
    expect(pendingPhotos.value).toMatchObject([
      { state: 'offline', jobId: 'job-a', submissionId: 1 },
      { state: 'offline', jobId: 'job-b', submissionId: 2 },
    ]);
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(showNotice.mock.calls[0][0]).toMatch(/^Pas de réseau/);

    // Still offline: nothing is followed. Online again: each solve starts again from its submission.
    await resumePendingSolves();
    await nextPoll();
    expect(resumePlateSolve).not.toHaveBeenCalled();
    setOnline(true);
    resumePlateSolve.mockImplementation(async (_f: File, sub: number) => ({ jobId: `new-${sub}` }));
    pollPlateSolve.mockImplementation(async (jobId: string) => ({ jobId, status: 'solving' }));
    await resumePendingSolves();
    await nextPoll();
    expect(resumePlateSolve.mock.calls.map((c) => c[1])).toEqual([1, 2]);
    expect(pendingPhotos.value).toMatchObject([
      { state: 'solving', jobId: 'new-1' },
      { state: 'solving', jobId: 'new-2' },
    ]);
    await nextPoll();
    expect(pollPlateSolve).toHaveBeenCalledWith('new-1');
    expect(pollPlateSolve).toHaveBeenCalledWith('new-2');
  });

  it('stops as offline when the solver cannot be reached, or its job cannot be started again', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockRejectedValue(refused('Network error', 'NETWORK_ERROR'));
    await solvePendingOnline(photo.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'offline', jobId: 'j' });
    await nextPoll();
    expect(pollPlateSolve).toHaveBeenCalledTimes(1);

    const other = await addPendingPhoto(new Blob(['y']), 'b.jpg');
    await setPendingState(other.id, 'solving', { jobId: 'job-1', submissionId: 42 });
    pollPlateSolve.mockRejectedValue(refused('Job introuvable', 'JOB_NOT_FOUND'));
    resumePlateSolve.mockRejectedValue(refused('Server error'));
    await resumePendingSolves();
    await nextPoll();
    await nextPoll();
    expect(resumePlateSolve).toHaveBeenCalledTimes(1);
    expect(pendingPhotos.value[1]).toMatchObject({ state: 'offline', submissionId: 42 });
  });

  it('follows again an offline photo sent to the solver once more, without sending the picture again', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    await setPendingState(photo.id, 'offline', { jobId: 'job-1', submissionId: 42 });
    resumePlateSolve.mockResolvedValue({ jobId: 'job-2' });
    pollPlateSolve.mockResolvedValue({ jobId: 'job-2', status: 'solving' });
    await solvePendingOnline(photo.id);
    expect(pendingPhotos.value[0].state).toBe('solving');
    await nextPoll();
    expect(submitPlateSolve).not.toHaveBeenCalled();
    expect(resumePlateSolve.mock.calls[0][1]).toBe(42);
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'solving', jobId: 'job-2' });
  });
});
