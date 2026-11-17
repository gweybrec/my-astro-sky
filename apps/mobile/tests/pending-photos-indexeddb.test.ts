// @vitest-environment node
// happy-dom's Blob does not survive IndexedDB's structured clone; Node's does, as the WebView's does.
import { IDBFactory } from 'fake-indexeddb';
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
  configurePendingStore,
  createIndexedDbPendingStore,
  holdPendingPlacement,
  openStoredPhoto,
  pendingDraft,
  pendingPhotoSolveFile,
  pendingPhotoFile,
  pendingPhotos,
  pendingPlacement,
  removePendingPhoto,
  resetPendingPhotos,
  restorePendingPhotos,
  setPendingDraft,
  setPendingState,
  storePendingPhoto,
} from '../src/pending-photos';
import { restoreImport } from '../src/platform-init';

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
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

/** The app closed and opened again: the list in memory is gone, a new store reads the same database back. */
async function restart(factory: IDBFactory) {
  resetPendingPhotos();
  configurePendingStore(createIndexedDbPendingStore(factory));
  await restorePendingPhotos();
}

describe('the photos of the import, kept on the phone until they are saved', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
    resetPendingPhotos();
    configurePendingStore(createIndexedDbPendingStore(factory));
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it('keeps the photos, their pictures and where they stand across a restart', async () => {
    const older = await addPendingPhoto(
      new Blob(['older'], { type: 'image/png' }),
      'M31.fit',
      { observationDate: '2026-11-10', fitsHeaders: [{ key: 'OBJECT', value: 'M31' }] as never },
      new File(['fits-bytes'], 'M31.fit', { type: 'application/fits' }),
      { inImport: true, addedAt: 1 },
    );
    const newer = await addPendingPhoto(
      new Blob(['newer'], { type: 'image/jpeg' }),
      'M42.jpg',
      undefined,
      undefined,
      {
        inImport: true,
        addedAt: 2,
      },
    );
    await setPendingState(older.id, 'failed', { error: 'no solution' });
    await setPendingDraft(newer.id, { ...(await pendingDraft(newer.id))!, labels: ['hiver'] });

    await restart(factory);
    expect(pendingPhotos.value.map((p) => [p.name, p.state, p.error, p.inImport])).toEqual([
      ['M31.fit', 'failed', 'no solution', true],
      ['M42.jpg', 'toPlace', undefined, true],
    ]);
    const picture = await pendingPhotoFile(newer.id);
    expect([picture!.name, picture!.type, await picture!.text()]).toEqual([
      'M42.jpg',
      'image/jpeg',
      'newer',
    ]);
    const solveFile = await pendingPhotoSolveFile(older.id);
    expect([solveFile!.name, solveFile!.type, await solveFile!.text()]).toEqual([
      'M31.fit',
      'application/fits',
      'fits-bytes',
    ]);
    expect((await pendingDraft(newer.id))!.labels).toEqual(['hiver']);
    expect((await pendingDraft(older.id))!.observationDate).toBe('2026-11-10');
  });

  it('keeps an astrometry.net solve going on and a placement found', async () => {
    const solving = await addPendingPhoto(
      new Blob(['a'], { type: 'image/jpeg' }),
      'M45.jpg',
      undefined,
      undefined,
      {
        inImport: true,
      },
    );
    const placed = await addPendingPhoto(
      new Blob(['b'], { type: 'image/jpeg' }),
      'M33.jpg',
      undefined,
      undefined,
      {
        inImport: true,
      },
    );
    await setPendingState(solving.id, 'solving', { jobId: 'job-1', submissionId: 42, sentAt: 's' });
    await holdPendingPlacement(placed.id, { correspondences: CORR, dsoIds: ['M33'], by: 'hand' });

    await restart(factory);
    expect(pendingPhotos.value.find((p) => p.id === solving.id)).toMatchObject({
      state: 'solving',
      jobId: 'job-1',
      submissionId: 42,
      sentAt: 's',
    });
    expect(pendingPhotos.value.find((p) => p.id === placed.id)).toMatchObject({
      state: 'placed',
      placedBy: 'hand',
    });
    expect((await pendingPlacement(placed.id))!.correspondences).toEqual(CORR);
  });

  it('forgets a photo once it is saved or given up', async () => {
    api.uploadPhoto.mockResolvedValue(stored({ id: 'new-1' }));
    const saved = await addPendingPhoto(
      new Blob(['a'], { type: 'image/jpeg' }),
      'M1.jpg',
      undefined,
      undefined,
      {
        inImport: true,
      },
    );
    const dropped = await addPendingPhoto(
      new Blob(['b'], { type: 'image/jpeg' }),
      'M2.jpg',
      undefined,
      undefined,
      {
        inImport: true,
      },
    );
    const kept = await addPendingPhoto(
      new Blob(['c'], { type: 'image/jpeg' }),
      'M3.jpg',
      undefined,
      undefined,
      {
        inImport: true,
      },
    );
    await storePendingPhoto(saved.id);
    await removePendingPhoto(dropped.id);

    await restart(factory);
    expect(pendingPhotos.value.map((p) => p.id)).toEqual([kept.id]);
  });

  it('does not keep a gallery photo opened on its page: the photo store has it', async () => {
    api.storedPhotoFile.mockResolvedValue(new File(['png'], 'stored-1.png', { type: 'image/png' }));
    await openStoredPhoto(stored());
    await setPendingState('stored-1', 'solving', { jobId: 'job-1', submissionId: 7, sentAt: 's' });

    await restart(factory);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('start-up reads the list back, and a database that cannot be opened leaves it empty without stopping', async () => {
    await addPendingPhoto(new Blob(['a'], { type: 'image/jpeg' }), 'M1.jpg', undefined, undefined, {
      inImport: true,
    });
    resetPendingPhotos();
    await restoreImport(factory);
    expect(pendingPhotos.value.map((p) => p.name)).toEqual(['M1.jpg']);

    resetPendingPhotos();
    const broken = {
      open: () => {
        throw new Error('no database');
      },
    } as unknown as IDBFactory;
    await expect(restoreImport(broken)).resolves.toBeUndefined();
    expect(pendingPhotos.value).toEqual([]);
    await expect(restoreImport(undefined)).resolves.toBeUndefined();
  });
});
