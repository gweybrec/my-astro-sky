import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '@myastrosky/core/types';

const api = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  updatePhotoMetadata: vi.fn(),
  setPhotoPlacement: vi.fn(),
  setPhotoOnlineSolve: vi.fn(),
  setPhotoFitsHeaders: vi.fn(),
  storedPhotoFile: vi.fn(),
}));
vi.mock('@myastrosky/app-state/api', () => api);

import {
  addPendingPhoto,
  holdPendingPlacement,
  openStoredPhoto,
  pendingPhotoFile,
  pictureName,
  pendingPhotoSolveFile,
  pendingPhotos,
  removePendingPhoto,
  resetPendingPhotos,
  setPendingState,
  storePendingPhoto,
} from '../src/pending-photos';

const CORR = [
  { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' },
  { pointIndex: 1, photoX: 9, photoY: 9, starHip: 2, starName: '' },
];

function stored(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'stored-1',
    filename: 'stored-1.png',
    originalName: 'NGC7000',
    width: 100,
    height: 80,
    createdAt: '2026-11-15T00:00:00.000Z',
    correspondences: [],
    dsoIds: [],
    labels: ['été'],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

describe('the photos being worked on before they are saved', () => {
  beforeEach(() => {
    resetPendingPhotos();
    for (const fn of Object.values(api)) fn.mockReset();
    // As the photo store: the photo comes back with the online solve sent with it.
    api.uploadPhoto.mockImplementation(
      async (
        _f: File,
        correspondences: unknown,
        _m: unknown,
        _p: unknown,
        metadata?: { onlineSolve?: unknown },
      ) =>
        stored({
          id: 'new-1',
          correspondences: correspondences as never,
          ...(metadata?.onlineSolve ? { onlineSolve: metadata.onlineSolve as never } : {}),
        }),
    );
    api.storedPhotoFile.mockResolvedValue(new File(['png'], 'stored-1.png', { type: 'image/png' }));
    api.setPhotoPlacement.mockImplementation(async (id: string, p: { correspondences: unknown }) =>
      stored({ id, correspondences: p.correspondences as never }),
    );
  });

  it('keeps a picture with its name, to place, and gives it back as a file', async () => {
    const added = await addPendingPhoto(new Blob(['abc'], { type: 'image/png' }), 'M42.png');
    expect(added).toMatchObject({ name: 'M42.png', state: 'toPlace' });
    expect(pendingPhotos.value).toEqual([added]);
    const file = await pendingPhotoFile(added.id);
    expect([file!.name, file!.type, await file!.text()]).toEqual(['M42.png', 'image/png', 'abc']);
    expect(await pendingPhotoFile('unknown')).toBeNull();
  });

  it('names a kept picture with the extension of its type', () => {
    expect(pictureName('M38_processed.fit', 'image/png')).toBe('M38_processed.png');
    expect(pictureName('Veil.tiff', 'image/png')).toBe('Veil.png');
    expect(pictureName('M42.JPEG', 'image/jpeg')).toBe('M42.JPEG');
    expect(pictureName('M42', 'image/webp')).toBe('M42.webp');
    expect(pictureName('M42.fit', '')).toBe('M42.fit');
  });

  it('keeps a separate raw solve file without exposing it in the list', async () => {
    const raw = new File(['fits-bytes'], 'M42.fit', { type: 'application/fits' });
    const added = await addPendingPhoto(
      new Blob(['png-bytes'], { type: 'image/png' }),
      'M42.fit',
      undefined,
      raw,
    );
    const picture = await pendingPhotoFile(added.id);
    const solveFile = await pendingPhotoSolveFile(added.id);
    expect([picture!.name, await picture!.text()]).toEqual(['M42.png', 'png-bytes']);
    expect([solveFile!.name, await solveFile!.text()]).toEqual(['M42.fit', 'fits-bytes']);
    expect(pendingPhotos.value[0]).not.toHaveProperty('solvePicture');
  });

  it('changes where a photo stands and forgets it', async () => {
    const added = await addPendingPhoto(new Blob(['x']), 'M31.jpg');
    await setPendingState(added.id, 'solving', { sentAt: 'x', fits: false });
    expect(pendingPhotos.value[0]).toMatchObject({ state: 'solving', sentAt: 'x' });
    await removePendingPhoto(added.id);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('stores a placed photo with its placement, then forgets it here', async () => {
    const added = await addPendingPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'M31.jpg');
    await holdPendingPlacement(added.id, { correspondences: CORR, dsoIds: ['M31'], by: 'solved' });
    await storePendingPhoto(added.id);
    expect(api.uploadPhoto.mock.calls[0][1]).toEqual(CORR);
    expect(api.uploadPhoto.mock.calls[0][4]).toMatchObject({ dsoIds: ['M31'] });
    expect(pendingPhotos.value).toEqual([]);
  });

  it('stores a photo not placed "À résoudre" with its astrometry.net solve, in the same request', async () => {
    const added = await addPendingPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'M45.jpg');
    await setPendingState(added.id, 'unfinished', {
      submissionId: 42,
      sentAt: '2026-11-15T21:42:00.000Z',
      fits: true,
    });
    const photo = await storePendingPhoto(added.id);
    expect(api.uploadPhoto.mock.calls[0][1]).toEqual([]);
    const solve = {
      state: 'unfinished',
      submissionId: 42,
      sentAt: '2026-11-15T21:42:00.000Z',
      fits: true,
    };
    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(api.uploadPhoto.mock.calls[0][4]).toMatchObject({ onlineSolve: solve });
    // No second request: a photo is never stored without its solve.
    expect(api.setPhotoOnlineSolve).not.toHaveBeenCalled();
    expect(photo.onlineSolve).toEqual(solve);
  });

  it('opens a stored photo "À résoudre" under its own id, with its picture and its solve', async () => {
    const photo = stored({
      onlineSolve: { state: 'unfinished', submissionId: 42, sentAt: 's', fits: true },
    });
    const open = await openStoredPhoto(photo);
    expect(open).toMatchObject({
      id: 'stored-1',
      storedId: 'stored-1',
      name: 'NGC7000',
      state: 'unfinished',
      submissionId: 42,
      fits: true,
    });
    expect(await (await pendingPhotoFile('stored-1'))!.text()).toBe('png');
  });

  it('keeps the solve of a stored photo in the store as it goes on', async () => {
    await openStoredPhoto(stored());
    await setPendingState('stored-1', 'solving', { jobId: 'j', sentAt: 's', fits: false });
    await setPendingState('stored-1', 'unfinished', { submissionId: 7 });
    expect(api.setPhotoOnlineSolve).toHaveBeenLastCalledWith('stored-1', {
      state: 'unfinished',
      submissionId: 7,
      sentAt: 's',
    });
  });

  it('saves a stored photo again: its metadata, and its placement once placed', async () => {
    await openStoredPhoto(stored());
    await holdPendingPlacement('stored-1', {
      correspondences: CORR,
      dsoIds: ['NGC 7000'],
      by: 'hand',
    });
    const photo = await storePendingPhoto('stored-1');
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(api.updatePhotoMetadata).toHaveBeenCalledWith(
      'stored-1',
      expect.objectContaining({ labels: ['été'], dsoIds: ['NGC 7000'] }),
    );
    expect(api.setPhotoPlacement).toHaveBeenCalledWith('stored-1', {
      correspondences: CORR,
      manualPlacement: null,
    });
    expect(photo.correspondences).toEqual(CORR);
  });
});
