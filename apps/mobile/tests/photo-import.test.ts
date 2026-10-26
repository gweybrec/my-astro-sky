import { beforeEach, describe, expect, it, vi } from 'vitest';

const convertRawPhoto = vi.fn();
const uploadPhoto = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  convertRawPhoto: (...a: unknown[]) => convertRawPhoto(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
}));
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: () => ['M1'],
}));

import {
  addImportFiles,
  clearImport,
  importAll,
  importBusy,
  importItems,
  importableCount,
  solvedCount,
} from '../src/composables/usePhotoImport';
import {
  configurePendingStore,
  createMemoryPendingStore,
  pendingPhotoFile,
  pendingPhotos,
} from '../src/pending-photos';

const corr = [
  { pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '' },
  { pointIndex: 1, photoX: 3, photoY: 4, starHip: 0, starName: '' },
  { pointIndex: 2, photoX: 5, photoY: 6, starHip: 0, starName: '' },
];
const png = new File(['png'], 'M1-CCD.png', { type: 'image/png' });
const solvedMeta = {
  success: true,
  correspondences: corr,
  width: 100,
  height: 80,
  dateObs: '2025-01-01T00:00:00',
  expTime: 10,
  stackCnt: 30,
  filter: 'L',
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the photo import', () => {
  beforeEach(() => {
    clearImport();
    configurePendingStore(createMemoryPendingStore());
    convertRawPhoto.mockReset();
    uploadPhoto.mockReset();
  });

  it('leaves out files that are not photos, and counts the added ones', () => {
    const added = addImportFiles([new File(['x'], 'notes.txt'), new File(['x'], 'M42.jpg')]);
    expect(added).toBe(1);
    expect(importItems.value.map((i) => [i.name, i.status])).toEqual([['M42.jpg', 'toPlace']]);
  });

  it('reads a solved FITS: its picture is stored and the photo is placed by its WCS', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    expect(importItems.value[0].status).toBe('converting');
    expect(importBusy.value).toBe(true);
    await settle();
    const [item] = importItems.value;
    expect(item.status).toBe('solved');
    expect(item.file).toBe(png);
    expect(item.correspondences).toEqual(corr);
    expect(item.metadata).toMatchObject({
      dsoIds: ['M1'],
      observationDate: '2025-01-01T00:00:00',
      integrations: [{ frames: 30, seconds: 10, filter: 'L' }],
    });
    expect(solvedCount.value).toBe(1);
    expect(importBusy.value).toBe(false);
  });

  it('a raw file without WCS still has to be placed', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: { success: false, width: 10, height: 10 } });
    addImportFiles([new File(['raw'], 'M1.tif')]);
    await settle();
    expect(importItems.value[0].status).toBe('toPlace');
    expect(solvedCount.value).toBe(0);
  });

  it('a file that cannot be read fails with the reason', async () => {
    convertRawPhoto.mockRejectedValue(new Error('unreadable'));
    addImportFiles([new File(['raw'], 'bad.fits')]);
    await settle();
    expect(importItems.value[0]).toMatchObject({ status: 'failed', error: 'unreadable' });
  });

  it('reads the raw files one after the other', async () => {
    let release!: () => void;
    convertRawPhoto.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ png, meta: solvedMeta }))),
    );
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    addImportFiles([new File(['a'], 'a.fit'), new File(['b'], 'b.fit')]);
    await settle();
    expect(convertRawPhoto).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(convertRawPhoto).toHaveBeenCalledTimes(2);
  });

  it('imports everything: the solved photo with its placement and metadata, the other one as a waiting photo', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    const jpg = new File(['x'], 'M42.jpg', { type: 'image/jpeg' });
    addImportFiles([new File(['raw'], 'M1-CCD.fit'), jpg]);
    await settle();
    expect(importableCount.value).toBe(2);
    const stored = await importAll();
    expect(stored).toEqual([{ id: 'p1' }]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    const [file, correspondences, manual, , metadata] = uploadPhoto.mock.calls[0];
    expect(file).toBe(png);
    expect(correspondences).toEqual(corr);
    expect(manual).toBeUndefined();
    expect(metadata).toMatchObject({
      dsoIds: ['M1'],
      displayName: 'M1-CCD',
      observationDate: '2025-01-01T00:00:00',
    });
    // Both leave the list; the one without a placement is kept, with its picture, to be placed later.
    expect(importItems.value).toEqual([]);
    expect(pendingPhotos.value.map((p) => [p.name, p.state])).toEqual([['M42.jpg', 'toPlace']]);
    const kept = await pendingPhotoFile(pendingPhotos.value[0].id);
    expect([kept!.name, kept!.type, await kept!.text()]).toEqual(['M42.jpg', 'image/jpeg', 'x']);
  });

  it('a photo that cannot be stored stays as failed', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    await settle();
    expect(await importAll()).toEqual([]);
    expect(importItems.value[0]).toMatchObject({ status: 'failed', error: 'disk full' });
  });
});
