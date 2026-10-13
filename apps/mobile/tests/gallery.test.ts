import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const loadServerSettings = vi.fn();
const submitPlateSolve = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => getPhotos(),
  loadServerSettings: () => loadServerSettings(),
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: vi.fn(() => new Promise(() => {})),
  photoFileUrl: (name: string) => `/uploads/${name}`,
  getPlans: vi.fn(),
  convertRawPhoto: vi.fn(),
  uploadPhoto: vi.fn(),
}));

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const pickFiles = vi.fn();
const pickGalleryPhotos = vi.fn();
vi.mock('../src/platform-device', () => ({
  PHOTO_FILE_TYPES: { mimeTypes: [], extensions: [] },
  pickFiles: (...a: unknown[]) => pickFiles(...a),
  pickGalleryPhotos: () => pickGalleryPhotos(),
}));

import GalleryPage from '../src/pages/GalleryPage.vue';
import { clearImport, importItems } from '../src/composables/usePhotoImport';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  setPendingState,
} from '../src/pending-photos';

const mountPage = () => mount(GalleryPage, { global: { stubs: ionicStubs } });
const rowWith = (wrapper: ReturnType<typeof mountPage>, text: string) =>
  wrapper.findAll('.mob-row').find((r) => r.text().includes(text))!;

describe('the gallery page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    getPhotos.mockReset();
    push.mockReset();
    pickFiles.mockReset();
    pickGalleryPhotos.mockReset();
    loadServerSettings.mockReset().mockResolvedValue({ apiKeySet: true });
    submitPlateSolve.mockReset().mockResolvedValue({ jobId: 'job-1' });
    clearImport();
    configurePendingStore(createMemoryPendingStore());
  });

  it('shows the empty state when the backend returns no photo', async () => {
    getPhotos.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('.mob-empty-text').text()).toBe("Aucune photo pour l'instant");
    expect(wrapper.find('.mob-empty button').text()).toBe('Ajouter des photos');
    expect(wrapper.find('input[type=search]').attributes('placeholder')).toBe(
      'Rechercher une photo…',
    );
    expect(wrapper.find('.mob-photo-grid').exists()).toBe(false);
  });

  it('shows no empty state before the answer', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M31.jpg' }]);
    const wrapper = mountPage();
    expect(wrapper.find('.mob-empty').exists()).toBe(false);
    await flushPromises();
    expect(wrapper.find('.mob-empty').exists()).toBe(false);
  });

  it('shows a tile per photo with its thumbnail, its name for a screen reader and its first object', async () => {
    getPhotos.mockResolvedValue([
      {
        id: 'p1',
        originalName: 'M31_stack.jpg',
        filename: 'a.jpg',
        thumbFilename: 'a_thumb.jpg',
        dsoIds: ['M31', 'M32'],
      },
      { id: 'p2', originalName: 'Wide.jpg', filename: 'b.jpg', dsoIds: [] },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    const tiles = wrapper.findAll('.mob-photo');
    expect(tiles.map((tile) => tile.find('img').attributes('src'))).toEqual([
      '/uploads/a_thumb.jpg',
      '/uploads/b.jpg',
    ]);
    expect(tiles.map((tile) => tile.find('button').attributes('aria-label'))).toEqual([
      'M31_stack.jpg',
      'Wide.jpg',
    ]);
    expect(wrapper.find('.mob-photo-name').exists()).toBe(false);
    expect(tiles.map((tile) => tile.find('.mob-photo-id').text())).toEqual(['M31', '']);
    // A tap on a photo opens its own screen.
    await tiles[1].find('button').trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/photo/p2');
    expect(wrapper.find('button[aria-label="Ajouter des photos"]').exists()).toBe(true);
  });

  it('opens the import with the chosen files', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'a.jpg' }]);
    pickFiles.mockResolvedValue([new File(['x'], 'M42.jpg'), new File(['x'], 'notes.txt')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('button[aria-label="Ajouter des photos"]').trigger('click');
    const choose = rowWith(wrapper, 'Choisir des fichiers');
    expect(choose.text()).toContain('JPEG, PNG, TIF, TIFF, FIT, FITS, XISF');
    await choose.trigger('click');
    await flushPromises();
    expect(pickFiles).toHaveBeenCalledWith(expect.anything(), true);
    expect(importItems.value.map((i) => i.name)).toEqual(['M42.jpg']);
    expect(push).toHaveBeenCalledWith('/gallery/import');
  });

  it('does nothing when the picker is closed without a choice', async () => {
    getPhotos.mockResolvedValue([]);
    pickFiles.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('.mob-empty button').trigger('click');
    await rowWith(wrapper, 'Choisir des fichiers').trigger('click');
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the imported photos that are not on the sky yet first, with where they stand', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M42.png', filename: 'a.png' }]);
    const solving = await addPendingPhoto(new Blob(['x']), 'M31_stack.jpg');
    await setPendingState(solving.id, 'solving', { jobId: 'job-7' });
    await addPendingPhoto(new Blob(['y']), 'NGC7000.tif');
    const wrapper = mountPage();
    await flushPromises();
    const tiles = wrapper.findAll('.mob-photo-tile');
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'M31_stack.jpg : Résolution',
      'NGC7000.tif : À placer',
      'M42.png',
    ]);
    expect(tiles[0].classes()).toContain('mob-photo-tile--state');
    expect(tiles[0].find('.mob-photo-state').classes()).toContain('mob-photo-state--busy');
    expect(tiles[0].find('[role=status]').exists()).toBe(true);
    expect(tiles[1].find('.mob-photo-state').text()).toBe('À placer');
    expect(tiles[1].find('.mob-photo-state').classes()).not.toContain('mob-photo-state--busy');
  });

  const openMethods = async (wrapper: ReturnType<typeof mountPage>) => {
    await wrapper.find('.mob-photo-tile--state').trigger('click');
    await flushPromises();
    return rowWith(wrapper, 'Résoudre en ligne');
  };

  it('asks how to place a waiting photo and sends it to the online solver', async () => {
    getPhotos.mockResolvedValue([]);
    const photo = await addPendingPhoto(new Blob(['y']), 'NGC7000.tif');
    const wrapper = mountPage();
    await flushPromises();
    const online = await openMethods(wrapper);
    expect(wrapper.text()).toContain('Comment placer cette photo ?');
    expect(online.text()).toContain('astrometry.net, nécessite une connexion');
    expect(rowWith(wrapper, "Résoudre sur l'ordinateur").classes()).toContain('mob-row--disabled');
    expect(rowWith(wrapper, 'Identifier 2–3 étoiles').text()).toContain('Touchez 2 ou 3 étoiles');
    expect(rowWith(wrapper, 'Placer à la main').text()).toContain('Déplacer, agrandir et tourner');
    await online.trigger('click');
    await flushPromises();
    expect(submitPlateSolve.mock.calls[0][0].name).toBe('NGC7000.tif');
    expect(wrapper.find('.mob-photo-tile--state').attributes('aria-label')).toBe(
      'NGC7000.tif : Résolution',
    );
    // A photo being solved does not ask again.
    await wrapper.find('.mob-photo-tile--state').trigger('click');
    await setPendingState(photo.id, 'failed', { error: 'no stars' });
    await flushPromises();
    expect(wrapper.find('.mob-photo-tile--state').attributes('aria-label')).toBe(
      'NGC7000.tif : Échec de la résolution',
    );
  });

  it('greys out the online solve without a connection, and without the astrometry.net key', async () => {
    getPhotos.mockResolvedValue([]);
    await addPendingPhoto(new Blob(['y']), 'NGC7000.tif');
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const wrapper = mountPage();
    await flushPromises();
    let online = await openMethods(wrapper);
    expect(online.classes()).toContain('mob-row--disabled');
    expect(online.text()).toContain('Aucune connexion internet');
    await online.trigger('click');
    await flushPromises();
    expect(submitPlateSolve).not.toHaveBeenCalled();
    onLine.mockRestore();

    loadServerSettings.mockResolvedValue({ apiKeySet: false });
    const second = mountPage();
    await flushPromises();
    online = await openMethods(second);
    expect(online.classes()).toContain('mob-row--disabled');
    expect(online.text()).toContain('Clé API non configurée');
  });

  it('shows the grid, not the empty state, when the only photos are waiting ones', async () => {
    getPhotos.mockResolvedValue([]);
    await addPendingPhoto(new Blob(['y']), 'NGC7000.tif');
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('.mob-empty').exists()).toBe(false);
    expect(wrapper.findAll('.mob-photo')).toHaveLength(1);
    expect(wrapper.find('button[aria-label="Ajouter des photos"]').exists()).toBe(true);
  });

  it('shows the name of a photo whose picture cannot be read', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M31.jpg', filename: 'a.jpg' }]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('.mob-photo img').trigger('error');
    expect(wrapper.find('.mob-photo img').exists()).toBe(false);
    expect(wrapper.find('.mob-photo-name').text()).toBe('M31.jpg');
  });

  it("opens the import with the pictures chosen in the phone's gallery", async () => {
    getPhotos.mockResolvedValue([]);
    pickGalleryPhotos.mockResolvedValue([new File(['x'], 'IMG_0001.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('.mob-empty button').trigger('click');
    await rowWith(wrapper, 'Depuis la galerie du téléphone').trigger('click');
    await flushPromises();
    expect(importItems.value.map((i) => i.name)).toEqual(['IMG_0001.jpg']);
    expect(push).toHaveBeenCalledWith('/gallery/import');
  });
});
