import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';

// Files another app hands to MyAstroSky open "Importer des photos"; one file named like a photo asks first.

const getPhotos = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({ getPhotos: () => getPhotos() }));
const addImportFiles = vi.fn();
vi.mock('../src/composables/usePhotoImport', () => ({
  addImportFiles: (files: File[]) => addImportFiles(files),
}));
const chooseExistingOrNew = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  chooseExistingOrNew: (...a: unknown[]) => chooseExistingOrNew(...a),
}));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

import { handleOpenedFiles, startOpenWith } from '../src/open-with';
import { skyPhotoFocus } from '../src/composables/useSkySelection';

const placed = {
  id: 'p1',
  originalName: 'M45',
  correspondences: [],
  manualPlacement: { ra: 1, dec: 2, scaleX: 1, scaleY: 1, rotation: 0 },
};
const unplaced = { id: 'p2', originalName: 'M31', correspondences: [], manualPlacement: null };
const file = (name: string) => new File(['x'], name);

function fakeRouter(path = '/tabs/sky') {
  return {
    currentRoute: { value: { path } },
    push: vi.fn(async () => undefined),
    replace: vi.fn(async () => undefined),
  };
}
const asRouter = (r: ReturnType<typeof fakeRouter>) => r as unknown as Router;

describe('files opened from another app', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.clearAllMocks();
    getPhotos.mockResolvedValue([placed, unplaced]);
    skyPhotoFocus.value = null;
  });

  it('open "Importer des photos" with a file no photo is named like', async () => {
    const router = fakeRouter();
    const f = file('NGC7000.fit');
    await handleOpenedFiles([f], asRouter(router));
    expect(chooseExistingOrNew).not.toHaveBeenCalled();
    expect(addImportFiles).toHaveBeenCalledWith([f]);
    expect(router.push).toHaveBeenCalledWith('/gallery/import');
  });

  it('join the list already open, without opening it again', async () => {
    const router = fakeRouter('/gallery/import');
    await handleOpenedFiles([file('NGC7000.fit')], asRouter(router));
    expect(addImportFiles).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('show the placed photo in the sky on "Voir dans le ciel"', async () => {
    chooseExistingOrNew.mockResolvedValue('show');
    const router = fakeRouter('/tabs/gallery');
    await handleOpenedFiles([file('M45.jpg')], asRouter(router));
    expect(chooseExistingOrNew).toHaveBeenCalledWith('M45', true);
    expect(skyPhotoFocus.value).toBe('p1');
    expect(router.replace).toHaveBeenCalledWith('/tabs/sky');
    expect(addImportFiles).not.toHaveBeenCalled();
  });

  it('open the page of a photo not placed on "Voir dans la galerie"', async () => {
    chooseExistingOrNew.mockResolvedValue('show');
    const router = fakeRouter();
    await handleOpenedFiles([file('M31.fits')], asRouter(router));
    expect(chooseExistingOrNew).toHaveBeenCalledWith('M31', false);
    expect(router.push).toHaveBeenCalledWith('/gallery/photo/p2');
  });

  it('add the file on "Ajouter comme nouvelle photo", and do nothing on Annuler', async () => {
    chooseExistingOrNew.mockResolvedValue('add');
    const router = fakeRouter();
    await handleOpenedFiles([file('M45.jpg')], asRouter(router));
    expect(addImportFiles).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/gallery/import');

    vi.clearAllMocks();
    getPhotos.mockResolvedValue([placed]);
    chooseExistingOrNew.mockResolvedValue('cancel');
    await handleOpenedFiles([file('M45.jpg')], asRouter(router));
    expect(addImportFiles).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('never ask when several files are opened', async () => {
    const router = fakeRouter();
    const files = [file('M45.jpg'), file('M31.fits')];
    await handleOpenedFiles(files, asRouter(router));
    expect(getPhotos).not.toHaveBeenCalled();
    expect(addImportFiles).toHaveBeenCalledWith(files);
  });

  it('skip files of other formats, with the photo picker messages', async () => {
    const router = fakeRouter();
    await handleOpenedFiles([file('notes.txt')], asRouter(router));
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('Format photo invalide'));
    expect(addImportFiles).not.toHaveBeenCalled();

    const keep = file('NGC7000.fit');
    await handleOpenedFiles([keep, file('notes.txt')], asRouter(router));
    expect(showError).toHaveBeenCalledTimes(2);
    expect(addImportFiles).toHaveBeenCalledWith([keep]);
  });
});

describe('taking the files from Android', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPhotos.mockResolvedValue([]);
  });

  it('listens first, takes the files opened at launch, then those of each later event', async () => {
    let fire: (() => void) | null = null;
    const take = vi
      .fn()
      .mockResolvedValueOnce({ files: [{ path: '/c/a.fit', name: 'a.fit', mimeType: '' }] })
      .mockResolvedValueOnce({
        files: [{ path: '/c/b.jpg', name: 'b.jpg', mimeType: 'image/jpeg' }],
      });
    const plugin = {
      take,
      addListener: vi.fn(async (_event: 'openedFiles', listener: () => void) => {
        fire = listener;
        return { remove: async () => undefined };
      }),
    };
    const read = vi.fn(
      async (f: { name: string; mimeType: string }) =>
        new File(['x'], f.name, { type: f.mimeType }),
    );
    const router = fakeRouter();
    await startOpenWith(asRouter(router), plugin, read);
    expect(plugin.addListener).toHaveBeenCalledBefore(take);
    expect(addImportFiles.mock.calls[0][0][0].name).toBe('a.fit');

    fire!();
    await vi.waitFor(() => expect(addImportFiles).toHaveBeenCalledTimes(2));
    expect(addImportFiles.mock.calls[1][0][0].name).toBe('b.jpg');
  });

  it('does nothing when nothing was opened', async () => {
    const plugin = {
      take: vi.fn().mockResolvedValue({ files: [] }),
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
    };
    await startOpenWith(asRouter(fakeRouter()), plugin, vi.fn());
    expect(addImportFiles).not.toHaveBeenCalled();
  });
});
