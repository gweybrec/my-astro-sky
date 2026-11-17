import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitPlateSolve = vi.fn();
const pollPlateSolve = vi.fn();
const resumePlateSolve = vi.fn();
const uploadPhoto = vi.fn();
const reuseAstrometrySubmission = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  reuseAstrometrySubmission: (...a: unknown[]) => reuseAstrometrySubmission(...a),
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
const showError = vi.fn();
const showWarning = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showNotice, showError, showWarning }),
}));

import {
  addPendingPhoto,
  resetPendingPhotos,
  pendingPlacement,
  pendingPhotos,
  setPendingState,
} from '../src/pending-photos';
import {
  POLL_INTERVAL_MS,
  fetchPendingResult,
  resumePendingSolves,
  shownPendingId,
  reusePendingSolution,
  solvePendingOnline,
  solvedPhotoCount,
  hintFovDeg,
} from '../src/pending-solve';

const corr = [{ pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '' }];
const nextPoll = () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
/** An error as the API facade throws it: the message, and the code of a refused call. */
const refused = (message: string, code?: string) => Object.assign(new Error(message), { code });
const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);

describe('the field width of the solve hint', () => {
  it('reads a width typed with a comma or a point, and nothing outside 0.1 to 180 degrees', () => {
    expect(hintFovDeg('2,5')).toBe(2.5);
    expect(hintFovDeg(' 1.2 ')).toBe(1.2);
    expect(hintFovDeg('')).toBeNull();
    expect(hintFovDeg('abc')).toBeNull();
    expect(hintFovDeg('0')).toBeNull();
    expect(hintFovDeg('200')).toBeNull();
  });
});

describe('solving a waiting photo online', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.useFakeTimers();
    resetPendingPhotos();
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

  it('sends the picture, follows the job, then stores a waiting photo of the gallery with its metadata', async () => {
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
    expect(metadata).toMatchObject({ dsoIds: ['M45'], displayName: 'M45_RGB', labels: [] });
    expect(pendingPhotos.value).toEqual([]);
    expect(solvedPhotoCount.value).toBe(before + 1);
  });

  it('holds the placement of a photo of the import, or whose page is open, until Importer or Enregistrer', async () => {
    const inImport = await addPendingPhoto(new Blob(['x']), 'M45.jpg', undefined, undefined, {
      inImport: true,
    });
    const shown = await addPendingPhoto(new Blob(['y']), 'M31.jpg');
    shownPendingId.value = shown.id;
    submitPlateSolve.mockResolvedValue({ jobId: 'job-1' });
    pollPlateSolve.mockResolvedValue({ jobId: 'job-1', status: 'solved', correspondences: corr });
    await solvePendingOnline(inImport.id);
    await solvePendingOnline(shown.id);
    await nextPoll();
    await nextPoll();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(pendingPhotos.value.map((p) => [p.name, p.state, p.placedBy])).toEqual([
      ['M45.jpg', 'placed', 'solved'],
      ['M31.jpg', 'placed', 'solved'],
    ]);
    expect(await pendingPlacement(inImport.id)).toEqual({
      correspondences: corr,
      dsoIds: ['M45'],
      by: 'solved',
    });
    shownPendingId.value = null;
  });

  it('submits the original raw file while the pending picture remains the converted PNG', async () => {
    const raw = new File(['fits-bytes'], 'M45.fit', { type: 'application/fits' });
    const photo = await addPendingPhoto(
      new Blob(['png-bytes'], { type: 'image/png' }),
      'M45.fit',
      undefined,
      raw,
    );
    submitPlateSolve.mockResolvedValue({ jobId: 'job-raw' });

    await solvePendingOnline(photo.id);

    const sent = submitPlateSolve.mock.calls[0][0];
    expect([sent.name, sent.type, await sent.text()]).toEqual([
      'M45.fit',
      'application/fits',
      'fits-bytes',
    ]);
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

  it('marks the photo as failed with the reason when the solve fails or cannot be sent', async () => {
    const failing = await addPendingPhoto(new Blob(['x']), 'a.jpg');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockResolvedValue({ jobId: 'j', status: 'failed', error: 'no stars' });
    await solvePendingOnline(failing.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'no stars' });
    expect(pendingPhotos.value[0].jobId).toBeUndefined();

    submitPlateSolve.mockRejectedValue(new Error('no connection'));
    await solvePendingOnline(failing.id);
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'no connection' });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('marks a solve astrometry.net has not finished in time as unfinished, not failed, and says its result will be fetched', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'NGC7000.tif');
    submitPlateSolve.mockResolvedValue({ jobId: 'j' });
    pollPlateSolve.mockResolvedValue({ jobId: 'j', status: 'timeout', submissionId: 42 });
    await solvePendingOnline(photo.id);
    await nextPoll();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'unfinished', submissionId: 42 });
    expect(pendingPhotos.value[0].error).toBeUndefined();
    expect(showWarning).toHaveBeenCalledWith(
      "astrometry.net n'a pas encore fini, la résolution continue de son côté. Le résultat sera récupéré automatiquement.",
    );
    // Not followed again on its own here: "Récupérer le résultat" or the stored photo's follower fetches it.
    pollPlateSolve.mockClear();
    await resumePendingSolves();
    await nextPoll();
    expect(pollPlateSolve).not.toHaveBeenCalled();
    expect(pendingPhotos.value[0].state).toBe('unfinished');
  });

  it('fetches the result of a solve astrometry.net went on with, from its submission, as a FITS when one was sent', async () => {
    const photo = await addPendingPhoto(new Blob(['x'], { type: 'image/png' }), 'M1.fit');
    await setPendingState(photo.id, 'unfinished', { submissionId: 42, fits: true, sentAt: 's' });
    resumePlateSolve.mockResolvedValue({ jobId: 'again' });
    pollPlateSolve.mockReturnValue(new Promise(() => {}));
    await fetchPendingResult(photo.id);
    expect(pendingPhotos.value[0].state).toBe('solving');
    await nextPoll();
    expect(resumePlateSolve).toHaveBeenCalledWith(expect.any(File), 42, { fits: true });
    expect(submitPlateSolve).not.toHaveBeenCalled();
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
    resetPendingPhotos();
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
    resetPendingPhotos();
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

describe('reusing a solution of the astrometry.net account', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    resetPendingPhotos();
    vi.clearAllMocks();
    findDsoIds.mockReturnValue([]);
  });

  it('reads the solution of the job for the kept picture, then holds the placement for its page', async () => {
    const photo = await addPendingPhoto(new Blob(['png'], { type: 'image/png' }), 'M35.fit');
    let settle: (v: unknown) => void = () => {};
    reuseAstrometrySubmission.mockReturnValue(new Promise((r) => (settle = r)));
    uploadPhoto.mockResolvedValue({ id: 'p1' });

    const running = reusePendingSolution(photo.id, 17323748);
    await vi.waitFor(() => expect(pendingPhotos.value[0].state).toBe('solving'));
    const [file, jobId] = reuseAstrometrySubmission.mock.calls[0];
    // The PNG made from the FITS goes under a PNG name: under the FITS name its size was read from a FITS header.
    expect([file.name, file.type, jobId]).toEqual(['M35.png', 'image/png', 17323748]);
    expect(submitPlateSolve).not.toHaveBeenCalled();

    settle({ success: true, correspondences: corr, dsoIds: ['M35'] });
    await running;
    // Reusing is asked from the photo's page, where Enregistrer stores it.
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'placed', placedBy: 'solved' });
    expect(await pendingPlacement(photo.id)).toEqual({
      correspondences: corr,
      dsoIds: ['M35'],
      by: 'solved',
    });
  });

  it('puts the photo back as it was and shows why when the solution cannot be used', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M35.fit');
    await setPendingState(photo.id, 'failed', { error: 'no stars' });
    reuseAstrometrySubmission.mockResolvedValue({ success: false, error: 'another picture' });
    await reusePendingSolution(photo.id, 7);
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'failed', error: 'no stars' });
    expect(showError).toHaveBeenCalledWith('another picture');
    expect(uploadPhoto).not.toHaveBeenCalled();

    reuseAstrometrySubmission.mockRejectedValue(new Error('offline'));
    await reusePendingSolution(photo.id, 7);
    expect(pendingPhotos.value[0].state).toBe('failed');
    expect(showError).toHaveBeenLastCalledWith('offline');
  });
});
