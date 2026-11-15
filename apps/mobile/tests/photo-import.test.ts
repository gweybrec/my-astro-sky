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
  discardImport,
  importAll,
  importBusy,
  importRows,
  importableCount,
  resetImport,
} from '../src/composables/usePhotoImport';
import {
  configurePendingStore,
  createMemoryPendingStore,
  holdPendingPlacement,
  loadPendingPhotos,
  pendingDraft,
  pendingPhotoFile,
  pendingPhotoSolveFile,
  pendingPhotos,
  resetPendingLoad,
  setPendingDraft,
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
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
/** The rows as their names and where they stand. */
const rows = () =>
  importRows.value.map((r) =>
    r.kind === 'pending' ? [r.photo.name, r.photo.state] : [r.file.name, r.file.status],
  );

describe('the photo import', () => {
  beforeEach(() => {
    resetImport();
    configurePendingStore(createMemoryPendingStore());
    convertRawPhoto.mockReset();
    uploadPhoto.mockReset();
    setPhotoFitsHeaders.mockReset().mockResolvedValue(undefined);
    getGearSetups.mockReset().mockResolvedValue([{ id: 's30', name: 'Seestar' }]);
  });

  it('leaves out files that are not photos, and keeps the others for the import, not in the gallery', async () => {
    const added = addImportFiles([new File(['x'], 'notes.txt'), new File(['x'], 'M42.jpg')]);
    expect(added).toBe(1);
    await settle();
    expect(rows()).toEqual([['M42.jpg', 'toPlace']]);
    expect(pendingPhotos.value[0].inImport).toBe(true);
    expect(await pendingDraft(pendingPhotos.value[0].id)).toMatchObject({ displayName: 'M42' });
  });

  it('reads a solved FITS: its picture is kept, placed by its WCS, with what its header says', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    expect(rows()).toEqual([['M1-CCD.fit', 'converting']]);
    expect(importBusy.value).toBe(true);
    await settle();
    expect(rows()).toEqual([['M1-CCD.fit', 'placed']]);
    const [photo] = pendingPhotos.value;
    expect(photo.placedBy).toBe('file');
    const picture = await pendingPhotoFile(photo.id);
    expect([picture!.name, await picture!.text()]).toEqual(['M1-CCD.png', 'png']);
    expect(await pendingDraft(photo.id)).toMatchObject({
      dsoIds: ['M1'],
      observationDate: '2025-01-01T00:00:00',
      integrations: [{ frames: 30, seconds: 10, filter: 'L' }],
    });
    expect(importBusy.value).toBe(false);
  });

  it('a raw file without WCS still has to be placed, and says its capture data was loaded', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: { success: false, width: 10, height: 10 } });
    addImportFiles([new File(['raw'], 'M1.tif')]);
    await settle();
    expect(rows()).toEqual([['M1.tif', 'toPlace']]);
    expect(pendingPhotos.value[0].noSolution).toBe(true);
  });

  it('keeps the original FITS file for online solving while keeping its PNG as the picture', async () => {
    const raw = new File(['fits-bytes'], 'M1-CCD.fit', { type: 'application/fits' });
    convertRawPhoto.mockResolvedValue({ png, meta: { success: false, width: 10, height: 10 } });
    addImportFiles([raw]);
    await settle();
    const id = pendingPhotos.value[0].id;
    const picture = await pendingPhotoFile(id);
    const solveFile = await pendingPhotoSolveFile(id);
    expect([picture!.type, await picture!.text()]).toEqual(['image/png', 'png']);
    expect([solveFile!.name, solveFile!.type, await solveFile!.text()]).toEqual([
      'M1-CCD.fit',
      'application/fits',
      'fits-bytes',
    ]);
  });

  it('solves a TIFF from its PNG: astrometry.net does not read TIFF', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: { success: false, width: 10, height: 10 } });
    addImportFiles([new File(['tiff-bytes'], 'M1-CCD.tiff', { type: 'image/tiff' })]);
    await settle();
    const solveFile = await pendingPhotoSolveFile(pendingPhotos.value[0].id);
    expect([solveFile!.type, await solveFile!.text()]).toEqual(['image/png', 'png']);
  });

  it('keeps a file and the metadata typed for it without Vue proxies, which the phone database cannot store', async () => {
    // The phone's IndexedDB clones what it stores, and refuses a Vue proxy ("… could not be cloned").
    const memory = createMemoryPendingStore();
    configurePendingStore({ ...memory, put: (record) => memory.put(structuredClone(record)) });
    convertRawPhoto.mockResolvedValue({
      png,
      meta: {
        success: false,
        width: 10,
        height: 10,
        expTime: 30,
        stackCnt: 44,
        fitsHeaders: [{ key: 'A', value: '1' }],
      },
    });
    addImportFiles([new File(['raw'], 'M2.fit')]);
    await settle();
    const { reactive } = await import('vue');
    const id = pendingPhotos.value[0].id;
    const draft = reactive((await pendingDraft(id))!);
    draft.labels.push('Galaxies');
    await setPendingDraft(id, draft);
    expect((await pendingDraft(id))!.labels).toEqual(['Galaxies']);
  });

  it('a raw file without a plate solution keeps its capture data, setup and headers until it is stored', async () => {
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
    const [waiting] = pendingPhotos.value;
    expect(await pendingDraft(waiting.id)).toMatchObject({
      integrations: [{ frames: 44, seconds: 30, filter: '' }],
      observationDate: '2025-02-02T21:00:00',
      captureDetails: { ccdTemp: 9.9 },
      gearSetupId: 's30',
    });
    // Placed by hand, the metadata typed for it, then Importer: it is stored with all of it, and its headers.
    const placement = {
      centerRa: 10,
      centerDec: 41,
      rotationDeg: 0,
      projPerPx: 1e-5,
      mirrorX: false,
      mirrorY: false,
    };
    await holdPendingPlacement(waiting.id, {
      correspondences: [],
      manualPlacement: placement,
      dsoIds: ['M2'],
      by: 'hand',
    });
    const draft = (await pendingDraft(waiting.id))!;
    await setPendingDraft(waiting.id, { ...draft, labels: ['Amas'], notes: 'Balcon' });
    uploadPhoto.mockResolvedValue({ id: 'p9' });
    const { stored } = await importAll();
    const [file, , manual, , metadata] = uploadPhoto.mock.calls[0];
    expect(file.name).toBe('M2.png');
    expect(manual).toEqual(placement);
    expect(metadata).toEqual({
      dsoIds: ['M2'],
      labels: ['Amas'],
      pointsOfInterest: [],
      notes: 'Balcon',
      displayName: 'M2',
      integrations: [{ frames: 44, seconds: 30, filter: '' }],
      observationDate: '2025-02-02T21:00:00',
      captureDetails: { ccdTemp: 9.9 },
      gearSetupId: 's30',
    });
    expect(setPhotoFitsHeaders).toHaveBeenCalledWith('p9', cards);
    expect(stored).toEqual([{ id: 'p9', hasFitsHeaders: true }]);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('a stored photo stays stored when its headers cannot be saved', async () => {
    convertRawPhoto.mockResolvedValue({
      png,
      meta: { ...solvedMeta, fitsHeaders: [{ key: 'A', value: '1' }] },
    });
    addImportFiles([new File(['raw'], 'M2.fit')]);
    await settle();
    uploadPhoto.mockResolvedValue({ id: 'p9' });
    setPhotoFitsHeaders.mockRejectedValue(new Error('offline'));
    expect((await importAll()).stored).toEqual([{ id: 'p9' }]);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('a file that cannot be read fails with the reason, and leaves the list on Importer', async () => {
    convertRawPhoto.mockRejectedValue(new Error('unreadable'));
    addImportFiles([new File(['raw'], 'bad.fits')]);
    await settle();
    expect(importRows.value[0]).toMatchObject({
      kind: 'reading',
      file: { status: 'failed', error: 'unreadable' },
    });
    await importAll();
    expect(importRows.value).toEqual([]);
  });

  it('reads the raw files one after the other, and lists them in the order they were picked', async () => {
    let release!: () => void;
    convertRawPhoto.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ png, meta: solvedMeta }))),
    );
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    addImportFiles([
      new File(['a'], 'a.fit'),
      new File(['b'], 'b.fit'),
      new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
    ]);
    await settle();
    expect(convertRawPhoto).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(convertRawPhoto).toHaveBeenCalledTimes(2);
    expect(rows().map(([name]) => name)).toEqual(['a.fit', 'b.fit', 'c.jpg']);
  });

  it('imports everything: the placed photo is stored, the other one goes to the gallery with its metadata', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    const jpg = new File(['x'], 'M42.jpg', { type: 'image/jpeg' });
    addImportFiles([new File(['raw'], 'M1-CCD.fit'), jpg]);
    await settle();
    expect(importableCount.value).toBe(2);
    const waiting = pendingPhotos.value.find((p) => p.name === 'M42.jpg')!;
    const draft = (await pendingDraft(waiting.id))!;
    await setPendingDraft(waiting.id, { ...draft, labels: ['Orion'] });
    const { stored, errors } = await importAll();
    expect([stored, errors]).toEqual([[{ id: 'p1' }], []]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    const [file, correspondences, manual, , metadata] = uploadPhoto.mock.calls[0];
    expect(await file.text()).toBe('png');
    expect(correspondences).toEqual(corr);
    expect(manual).toBeUndefined();
    expect(metadata).toMatchObject({
      dsoIds: ['M1'],
      displayName: 'M1-CCD',
      observationDate: '2025-01-01T00:00:00',
    });
    // No header cards in this file: nothing to save beside the photo.
    expect(setPhotoFitsHeaders).not.toHaveBeenCalled();
    // The list is empty; the one without a placement waits in the gallery, with its picture and metadata.
    expect(importRows.value).toEqual([]);
    expect(pendingPhotos.value.map((p) => [p.name, p.state, p.inImport])).toEqual([
      ['M42.jpg', 'toPlace', false],
    ]);
    const kept = await pendingPhotoFile(pendingPhotos.value[0].id);
    expect([kept!.name, kept!.type, await kept!.text()]).toEqual(['M42.jpg', 'image/jpeg', 'x']);
    expect((await pendingDraft(pendingPhotos.value[0].id))!.labels).toEqual(['Orion']);
  });

  it("saves a solved file's headers with its photo", async () => {
    const cards = [{ key: 'OBJECT', value: 'M1' }];
    convertRawPhoto.mockResolvedValue({ png, meta: { ...solvedMeta, fitsHeaders: cards } });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    await settle();
    expect((await importAll()).stored).toEqual([{ id: 'p1', hasFitsHeaders: true }]);
    expect(setPhotoFitsHeaders).toHaveBeenCalledWith('p1', cards);
  });

  it('a photo that cannot be stored stays in the list, placed, and its reason is given', async () => {
    convertRawPhoto.mockResolvedValue({ png, meta: solvedMeta });
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    addImportFiles([new File(['raw'], 'M1-CCD.fit')]);
    await settle();
    expect(await importAll()).toEqual({
      stored: [],
      errors: [{ name: 'M1-CCD.fit', message: 'disk full' }],
    });
    expect(rows()).toEqual([['M1-CCD.fit', 'placed']]);
  });

  it('gives the import up: its photos are forgotten, the waiting photos of the gallery stay', async () => {
    addImportFiles([new File(['x'], 'M42.jpg')]);
    await settle();
    await importAll();
    addImportFiles([new File(['y'], 'M45.jpg')]);
    await settle();
    await discardImport();
    expect(importRows.value).toEqual([]);
    expect(pendingPhotos.value.map((p) => p.name)).toEqual(['M42.jpg']);
  });

  it('after a restart, the photos left in an import wait in the gallery, with their metadata', async () => {
    addImportFiles([new File(['x'], 'M42.jpg')]);
    await settle();
    const id = pendingPhotos.value[0].id;
    await setPendingDraft(id, { ...(await pendingDraft(id))!, notes: 'Belle nuit' });
    resetPendingLoad();
    await loadPendingPhotos();
    expect(importRows.value).toEqual([]);
    expect(pendingPhotos.value.map((p) => [p.name, p.inImport])).toEqual([['M42.jpg', false]]);
    expect((await pendingDraft(id))!.notes).toBe('Belle nuit');
  });
});
