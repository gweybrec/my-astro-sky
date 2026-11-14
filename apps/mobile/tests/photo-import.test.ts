import { beforeEach, describe, expect, it, vi } from 'vitest';

const convertRawPhoto = vi.fn();
const uploadPhoto = vi.fn();
const setPhotoFitsHeaders = vi.fn();
const getGearSetups = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  convertRawPhoto: (...a: unknown[]) => convertRawPhoto(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  setPhotoFitsHeaders: (...a: unknown[]) => setPhotoFitsHeaders(...a),
  getGearSetups: () => getGearSetups(),
}));
// The saved setups' optics: one Seestar S30, which a Seestar header points to.
vi.mock('@myastrosky/core/gear-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/gear-catalog')>()),
  loadSetupOptics: async () => [
    {
      setupId: 's30',
      nativeFocalMm: 150,
      effectiveFocalMm: 150,
      pixelSizeUm: 2.9,
      telescopeName: 'ZWO Seestar S30',
      cameraName: 'ZWO Seestar S30',
      setupName: 'Seestar',
    },
  ],
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
  storePlacedPendingPhoto,
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
    setPhotoFitsHeaders.mockReset().mockResolvedValue(undefined);
    getGearSetups.mockReset().mockResolvedValue([{ id: 's30', name: 'Seestar' }]);
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

  it('a raw file without a plate solution keeps its capture data, setup and headers until it is placed', async () => {
    const cards = [{ key: 'EXPTIME', value: '30.' }];
    convertRawPhoto.mockResolvedValue({
      png,
      meta: {
        success: false,
        width: 10,
        height: 10,
        dateObs: '2025-02-02T21:00:00',
        expTime: 30,
        stackCnt: 44,
        captureDetails: { ccdTemp: 9.9 },
        facts: { telescope: 'S30_0289c34b', instrument: 'Seestar S30', focalLengthMm: 150 },
        fitsHeaders: cards,
      },
    });
    addImportFiles([new File(['raw'], 'M2.fit')]);
    await settle();
    await settle();
    // The row: "À placer", and the line of the board "Importer, fichier non résolu".
    expect(importItems.value[0]).toMatchObject({
      status: 'toPlace',
      noSolution: true,
      gearSetupId: 's30',
      capture: { integrations: [{ frames: 44, seconds: 30, filter: '' }], fitsHeaders: cards },
    });
    await importAll();
    expect(uploadPhoto).not.toHaveBeenCalled();
    const [waiting] = pendingPhotos.value;
    // Placed later (by hand here): the photo is stored with what its file said, and its headers are saved.
    uploadPhoto.mockResolvedValue({ id: 'p9' });
    const placement = {
      centerRa: 10,
      centerDec: 41,
      rotationDeg: 0,
      projPerPx: 1e-5,
      mirrorX: false,
      mirrorY: false,
    };
    const stored = await storePlacedPendingPhoto(waiting.id, png, [], placement, ['M2']);
    const [, , manual, , metadata] = uploadPhoto.mock.calls[0];
    expect(manual).toEqual(placement);
    expect(metadata).toEqual({
      dsoIds: ['M2'],
      displayName: 'M1-CCD',
      integrations: [{ frames: 44, seconds: 30, filter: '' }],
      observationDate: '2025-02-02T21:00:00',
      captureDetails: { ccdTemp: 9.9 },
      gearSetupId: 's30',
    });
    expect(setPhotoFitsHeaders).toHaveBeenCalledWith('p9', cards);
    expect(stored).toEqual({ id: 'p9', hasFitsHeaders: true });
    expect(pendingPhotos.value).toEqual([]);
  });

  it('a placed photo stays stored when its headers cannot be saved', async () => {
    convertRawPhoto.mockResolvedValue({
      png,
      meta: { success: false, width: 10, height: 10, fitsHeaders: [{ key: 'A', value: '1' }] },
    });
    addImportFiles([new File(['raw'], 'M2.fit')]);
    await settle();
    await settle();
    await importAll();
    uploadPhoto.mockResolvedValue({ id: 'p9' });
    setPhotoFitsHeaders.mockRejectedValue(new Error('offline'));
    const stored = await storePlacedPendingPhoto(pendingPhotos.value[0].id, png, [], undefined, []);
    expect(stored).toEqual({ id: 'p9' });
    expect(pendingPhotos.value).toEqual([]);
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
    // No header cards in this file: nothing to save beside the photo.
    expect(setPhotoFitsHeaders).not.toHaveBeenCalled();
    // Both leave the list; the one without a placement is kept, with its picture, to be placed later.
    expect(importItems.value).toEqual([]);
    expect(pendingPhotos.value.map((p) => [p.name, p.state])).toEqual([['M42.jpg', 'toPlace']]);
    const kept = await pendingPhotoFile(pendingPhotos.value[0].id);
    expect([kept!.name, kept!.type, await kept!.text()]).toEqual(['M42.jpg', 'image/jpeg', 'x']);
  });

  it("saves a solved file's headers with its photo", async () => {
    const cards = [{ key: 'OBJECT', value: 'M1' }];
    convertRawPhoto.mockResolvedValue({ png, meta: { ...solvedMeta, fitsHeaders: cards } });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    await settle();
    await settle();
    expect(await importAll()).toEqual([{ id: 'p1', hasFitsHeaders: true }]);
    expect(setPhotoFitsHeaders).toHaveBeenCalledWith('p1', cards);
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
