import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const loadServerSettings = vi.fn();
const submitPlateSolve = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  loadServerSettings: () => loadServerSettings(),
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: vi.fn(() => new Promise(() => {})),
  photoFileUrl: (name: string) => `/uploads/${name}`,
  getPlans: vi.fn(),
  convertRawPhoto: vi.fn(),
  uploadPhoto: vi.fn(),
}));

vi.mock('@myastrosky/app-state/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({
    categories: [
      { id: 'cat-comet', name: 'Comète', color: '#5fd0c0' },
      { id: 'cat-mine', name: 'Perso', color: '#ff8800' },
    ],
    ensureLoaded: () => Promise.resolve(),
  }),
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

import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import GalleryPage from '../src/pages/GalleryPage.vue';
import { loadGalleryDisplay } from '../src/gallery-display';
import { skyPlacement } from '../src/sky-modes';
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
    getGearSetups.mockReset().mockResolvedValue([{ id: 's1', name: 'Newton 200 + ASI 183' }]);
    configureStorage(createMemoryStore());
    loadGalleryDisplay();
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

  it('shows a card per photo with its thumbnail and its file name', async () => {
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
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'M31_stack.jpg',
      'Wide.jpg',
    ]);
    expect(tiles.map((tile) => tile.find('.mob-photo-card-name').text())).toEqual([
      'M31_stack.jpg',
      'Wide.jpg',
    ]);
    // A tap on a photo opens its own screen.
    await tiles[1].trigger('click');
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
    const tiles = wrapper.findAll('.mob-photo-card');
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'M31_stack.jpg : Résolution',
      'NGC7000.tif : À placer',
      'M42.png',
    ]);
    // A waiting photo has its name in the caption, and no chips.
    expect(tiles[0].find('.mob-photo-card-name').text()).toBe('M31_stack.jpg');
    expect(tiles[0].find('.mob-tags').exists()).toBe(false);
    expect(tiles[0].find('.mob-photo-state').classes()).toContain('mob-photo-state--busy');
    expect(tiles[0].find('[role=status]').exists()).toBe(true);
    expect(tiles[1].find('.mob-photo-state').text()).toBe('À placer');
    expect(tiles[1].find('.mob-photo-state').classes()).not.toContain('mob-photo-state--busy');
  });

  const openMethods = async (wrapper: ReturnType<typeof mountPage>) => {
    await wrapper.find('.mob-photo-card:has(.mob-photo-state)').trigger('click');
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
    expect(wrapper.find('.mob-photo-card').attributes('aria-label')).toBe(
      'NGC7000.tif : Résolution',
    );
    // A photo being solved does not ask again.
    await wrapper.find('.mob-photo-card').trigger('click');
    await setPendingState(photo.id, 'failed', { error: 'no stars' });
    await flushPromises();
    expect(wrapper.find('.mob-photo-card').attributes('aria-label')).toBe(
      'NGC7000.tif : Échec de la résolution',
    );
  });

  it('places a waiting photo by hand on the sky map', async () => {
    getPhotos.mockResolvedValue([]);
    const photo = await addPendingPhoto(new Blob(['y']), 'M101.jpg');
    const wrapper = mountPage();
    await flushPromises();
    await openMethods(wrapper);
    await rowWith(wrapper, 'Placer à la main').trigger('click');
    expect(skyPlacement.value).toEqual({ pendingId: photo.id });
    expect(push).toHaveBeenCalledWith('/tabs/sky');
    skyPlacement.value = null;
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

  it('keeps the card of a photo whose picture cannot be read, with a placeholder and its name', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M31.jpg', filename: 'a.jpg' }]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('.mob-photo img').trigger('error');
    expect(wrapper.find('.mob-photo img').exists()).toBe(false);
    expect(wrapper.find('.mob-photo-card-picture svg').exists()).toBe(true);
    expect(wrapper.find('.mob-photo-card-name').text()).toBe('M31.jpg');
  });

  it("lists a photo's chips in the desktop's order: equipment, points of interest, labels, objects", async () => {
    getPhotos.mockResolvedValue([
      {
        id: 'p1',
        originalName: 'M31_stack.jpg',
        filename: 'a.jpg',
        gearSetupId: 's1',
        pointsOfInterest: [
          { name: 'C/2023 A3', categoryId: 'cat-comet' },
          { name: 'Repère', categoryId: 'cat-mine' },
        ],
        labels: ['LRGB'],
        dsoIds: ['M31', 'M32'],
      },
      { id: 'p2', originalName: 'Wide.jpg', filename: 'b.jpg', gearSetupId: 'gone', dsoIds: [] },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    const [first, second] = wrapper.findAll('.mob-photo-card');
    const tags = first.findAll('.mob-tag');
    expect(tags.map((tag) => tag.text())).toEqual([
      'Newton 200 + ASI 183',
      'C/2023 A3',
      'Repère',
      'LRGB',
      'M31',
      'M32',
    ]);
    expect(tags.map((tag) => tag.classes().find((c) => c.startsWith('mob-tag--')))).toEqual([
      'mob-tag--setup',
      'mob-tag--poi',
      'mob-tag--poi',
      'mob-tag--label',
      'mob-tag--dso',
      'mob-tag--dso',
    ]);
    // A default kind has its icon in its colour; a kind of the user's has a dot of its colour.
    expect(tags[1].find('svg').exists()).toBe(true);
    expect(tags[1].attributes('style')).toContain('--poi-color: #5fd0c0');
    expect(tags[2].find('svg').exists()).toBe(false);
    expect(tags[2].classes()).toContain('mob-tag--dot');
    expect(tags[2].attributes('style')).toContain('--poi-color: #ff8800');
    // Nothing to show: no chips block, as on the desktop (an equipment that no longer exists is not named).
    expect(second.find('.mob-tags').exists()).toBe(false);
  });

  /** Holds the phone one way, as the stylesheet's orientation query would see it. */
  const held = (way: 'portrait' | 'landscape') =>
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: way === 'landscape',
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);

  it('offers other numbers of photos per line when the phone is held in landscape', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M31.jpg', filename: 'a.jpg' }]);
    held('landscape');
    const wrapper = mountPage();
    await flushPromises();
    const group = wrapper.findComponent({ name: 'PhoneSegmented' });
    expect(group.props('options').map((o: { label: string }) => o.label)).toEqual([
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(group.props('modelValue')).toBe('6');
    group.vm.$emit('update:modelValue', '4');
    await flushPromises();
    const style = wrapper.find('.mob-photo-grid').attributes('style');
    expect(style).toContain('--photos-per-line: 2');
    expect(style).toContain('--photos-per-line-landscape: 4');
  });

  it('sets the photos per line from "Affichage", for the way the phone is held, and keeps the choice', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1', originalName: 'M31.jpg', filename: 'a.jpg' }]);
    held('portrait');
    const wrapper = mountPage();
    await flushPromises();
    const grid = () => wrapper.find('.mob-photo-grid').attributes('style');
    expect(grid()).toContain('--photos-per-line: 2');
    expect(grid()).toContain('--photos-per-line-landscape: 6');
    expect(wrapper.findAll('header button').map((b) => b.attributes('aria-label'))).toEqual([
      'Affichage',
      'Plus de filtres',
    ]);
    await wrapper.find('button[aria-label="Affichage"]').trigger('click');
    const group = wrapper.findComponent({ name: 'PhoneSegmented' });
    expect(group.props('options').map((o: { label: string }) => o.label)).toEqual(['1', '2', '3']);
    expect(group.props('modelValue')).toBe('2');
    expect(wrapper.text()).toContain('Photos par ligne');
    group.vm.$emit('update:modelValue', '3');
    await flushPromises();
    expect(grid()).toContain('--photos-per-line: 3');
    expect(grid()).toContain('--photos-per-line-landscape: 6');
    // Read again as at the next start.
    loadGalleryDisplay();
    const again = mountPage();
    await flushPromises();
    expect(again.find('.mob-photo-grid').attributes('style')).toContain('--photos-per-line: 3');
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
