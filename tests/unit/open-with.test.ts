/**
 * Tests for src/open-with.ts: files opened with "Open with MyAstroSky" open "Ajouter des photos", and one file
 * named like a photo already added asks first whether to show that photo or add the file as a new one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPhotos: vi.fn(),
  triggerBatchModal: vi.fn(),
  chooseExistingOrNew: vi.fn(),
  showToast: vi.fn(),
  switchView: vi.fn(),
  selectPhoto: vi.fn(),
  zoomToPhoto: vi.fn(),
  openPhoto: vi.fn(),
}));

vi.mock('../../src/api', () => ({ getPhotos: mocks.getPhotos }));
vi.mock('../../src/ui', () => ({ triggerBatchModal: mocks.triggerBatchModal }));
vi.mock('../../src/photo-delete-confirm', () => ({
  chooseExistingOrNew: mocks.chooseExistingOrNew,
}));
vi.mock('../../src/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/pinia-instance', () => ({ pinia: {} }));
vi.mock('../../src/stores/ui', () => ({ useUiStore: () => ({ switchView: mocks.switchView }) }));
vi.mock('../../src/stores/photos', () => ({
  usePhotosStore: () => ({ selectPhoto: mocks.selectPhoto, zoomToPhoto: mocks.zoomToPhoto }),
}));
vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({ gallery: { openPhoto: mocks.openPhoto } }),
}));

import { handleOpenedFiles, startOpenWith, toFiles } from '../../src/open-with';

const file = (name: string) => new File(['x'], name);
const placed = {
  id: 'p1',
  originalName: 'M101',
  correspondences: [],
  manualPlacement: { ra: 1, dec: 2, scaleX: 1, scaleY: 1, rotation: 0 },
};
const unplaced = { id: 'p2', originalName: 'M31', correspondences: [], manualPlacement: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPhotos.mockResolvedValue([placed, unplaced]);
});

describe('handleOpenedFiles', () => {
  it('opens "Ajouter des photos" with a file no photo is named like', async () => {
    const f = file('NGC 7000.fit');
    await handleOpenedFiles([f]);
    expect(mocks.chooseExistingOrNew).not.toHaveBeenCalled();
    expect(mocks.triggerBatchModal).toHaveBeenCalledWith([f]);
  });

  it('asks first for one file named like a photo, and adds it on "add"', async () => {
    mocks.chooseExistingOrNew.mockResolvedValue('add');
    const f = file('M101.fit');
    await handleOpenedFiles([f]);
    expect(mocks.chooseExistingOrNew).toHaveBeenCalledWith('M101', true);
    expect(mocks.triggerBatchModal).toHaveBeenCalledWith([f]);
  });

  it('shows the placed photo in the sky on "show"', async () => {
    vi.useFakeTimers();
    mocks.chooseExistingOrNew.mockResolvedValue('show');
    await handleOpenedFiles([file('M101.jpg')]);
    expect(mocks.triggerBatchModal).not.toHaveBeenCalled();
    expect(mocks.switchView).toHaveBeenCalledWith('skymap');
    vi.runAllTimers();
    expect(mocks.zoomToPhoto).toHaveBeenCalledWith('p1');
    expect(mocks.selectPhoto).toHaveBeenCalledWith('p1');
    vi.useRealTimers();
  });

  it('opens a photo not placed in the gallery on "show"', async () => {
    mocks.chooseExistingOrNew.mockResolvedValue('show');
    await handleOpenedFiles([file('M31.png')]);
    expect(mocks.chooseExistingOrNew).toHaveBeenCalledWith('M31', false);
    expect(mocks.switchView).toHaveBeenCalledWith('gallery');
    expect(mocks.openPhoto).toHaveBeenCalledWith('p2');
  });

  it('does nothing on "cancel"', async () => {
    mocks.chooseExistingOrNew.mockResolvedValue('cancel');
    await handleOpenedFiles([file('M101.fit')]);
    expect(mocks.triggerBatchModal).not.toHaveBeenCalled();
    expect(mocks.switchView).not.toHaveBeenCalled();
  });

  it('never asks when several files are opened', async () => {
    const files = [file('M101.fit'), file('M31.fit')];
    await handleOpenedFiles(files);
    expect(mocks.getPhotos).not.toHaveBeenCalled();
    expect(mocks.chooseExistingOrNew).not.toHaveBeenCalled();
    expect(mocks.triggerBatchModal).toHaveBeenCalledWith(files);
  });

  it('skips files of other formats, with the same messages as the photo picker', async () => {
    await handleOpenedFiles([file('notes.txt')]);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'errors.invalidPhotoFormat' }),
    );
    expect(mocks.triggerBatchModal).not.toHaveBeenCalled();

    const keep = file('NGC 7000.fit');
    await handleOpenedFiles([keep, file('notes.txt')]);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'errors.someFilesSkipped' }),
    );
    expect(mocks.triggerBatchModal).toHaveBeenCalledWith([keep]);
  });
});

describe('toFiles', () => {
  it('gives pictures the type a file picker gives, raw astro files none', () => {
    const [jpg, fit] = toFiles([
      { name: 'M101.JPG', data: new Uint8Array([1]) },
      { name: 'M101.fits', data: new Uint8Array([1]) },
    ]);
    expect(jpg.type).toBe('image/jpeg');
    expect(jpg.name).toBe('M101.JPG');
    expect(fit.type).toBe('');
  });
});

describe('startOpenWith', () => {
  it('does nothing outside the desktop app', async () => {
    await startOpenWith(undefined);
    await startOpenWith({});
    expect(mocks.triggerBatchModal).not.toHaveBeenCalled();
  });

  it('listens first, then takes the files opened at launch', async () => {
    const order: string[] = [];
    let push: ((files: { name: string; data: Uint8Array }[]) => void) | null = null;
    await startOpenWith({
      onOpenedFiles: (cb) => {
        order.push('listen');
        push = cb;
      },
      takeOpenedFiles: async () => {
        order.push('take');
        return [{ name: 'NGC 7000.fit', data: new Uint8Array([1]) }];
      },
    });
    expect(order).toEqual(['listen', 'take']);
    expect(mocks.triggerBatchModal).toHaveBeenCalledTimes(1);

    push!([{ name: 'IC 1396.fit', data: new Uint8Array([1]) }]);
    await vi.waitFor(() => expect(mocks.triggerBatchModal).toHaveBeenCalledTimes(2));
  });
});
