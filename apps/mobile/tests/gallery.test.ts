import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const PLACED = vi.hoisted(() => [
  { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' },
  { pointIndex: 1, photoX: 9, photoY: 9, starHip: 2, starName: '' },
]);
const getGearSetups = vi.fn();
const loadServerSettings = vi.fn();
const submitPlateSolve = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  // A stored photo is placed unless a test says otherwise (one without a placement waits "À résoudre").
  getPhotos: () =>
    Promise.resolve(getPhotos()).then((list?: Record<string, unknown>[]) =>
      list?.map((p) => ({ correspondences: PLACED, ...p })),
    ),
  getGearSetups: () => getGearSetups(),
  loadServerSettings: () => loadServerSettings(),
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: vi.fn(() => new Promise(() => {})),
  photoFileUrl: (name: string) => `/uploads/${name}`,
  getPlans: vi.fn(),
  convertRawPhoto: vi.fn(),
  uploadPhoto: vi.fn(),
  storedPhotoFile: vi.fn(async () => new File(['x'], 'w.png', { type: 'image/png' })),
  setPhotoOnlineSolve: vi.fn(async () => undefined),
}));
// The solves of the photos stored "À résoudre" are followed again by the shared module: astrometry.net is never reached.
const stored = vi.hoisted(() => ({
  following: new Set<string>(),
  followStoredSolves: vi.fn(async () => undefined),
}));
vi.mock('@myastrosky/app-state/stored-solve', () => ({
  followStoredSolves: (...a: unknown[]) => stored.followStoredSolves(...(a as [])),
  isFollowingStoredSolve: (id: string) => stored.following.has(id),
}));

// The visited sky shown: none unless a test shows one.
const sharedSkies = vi.hoisted(() => ({
  loaded: true,
  skies: [] as unknown[],
  shown: ['mine'] as string[],
  ownShown: true,
  visitPhotos: [] as unknown[],
  visitPoiCategories: [] as unknown[],
  load: () => Promise.resolve(),
}));
vi.mock('@myastrosky/app-state/stores/shared-skies', async () => {
  const { reactive } = await import('vue');
  const store = reactive(sharedSkies);
  return { useSharedSkiesStore: () => store };
});

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

const confirm = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import GalleryPage from '../src/pages/GalleryPage.vue';
import { clearGalleryFilters, galleryFilters, loadGalleryDisplay } from '../src/gallery-display';
import { importRows, resetImport } from '../src/composables/usePhotoImport';
import { openStoredPhoto, resetPendingPhotos, setPendingState } from '../src/pending-photos';

/** A photo stored without a placement ("À résoudre"), its astrometry.net solve if it has one. */
const waitingPhoto = (id: string, name: string, onlineSolve?: Record<string, unknown>) => ({
  id,
  originalName: name,
  filename: `${id}.png`,
  createdAt: '2026-11-15T00:00:00.000Z',
  correspondences: [],
  dsoIds: [],
  labels: [],
  pointsOfInterest: [],
  notes: '',
  ...(onlineSolve ? { onlineSolve } : {}),
});

// Each page is unmounted after its test: a page left mounted would keep reacting to the shared search and filters.
enableAutoUnmount(afterEach);
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
    clearGalleryFilters();
    galleryFilters.query = '';
    push.mockReset();
    pickFiles.mockReset();
    pickGalleryPhotos.mockReset();
    loadServerSettings.mockReset().mockResolvedValue({ apiKeySet: true });
    submitPlateSolve.mockReset().mockResolvedValue({ jobId: 'job-1' });
    resetImport();
    resetPendingPhotos();
    stored.following.clear();
    stored.followStoredSolves.mockClear();
  });

  it('draws the cards a part at a time, the next part as the grid is scrolled', async () => {
    getPhotos.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, originalName: `${i}.jpg` })),
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.mob-photo-card')).toHaveLength(24);
    const grid = wrapper.find('.mob-scroll').element as HTMLElement;
    Object.defineProperty(grid, 'scrollHeight', { value: 1000 });
    Object.defineProperty(grid, 'clientHeight', { value: 800 });
    await wrapper.find('.mob-scroll').trigger('scroll');
    expect(wrapper.findAll('.mob-photo-card')).toHaveLength(30);
  });

  it('marks each card with its photo, so the grid is put back where it was after a photo or another tab', async () => {
    getPhotos.mockResolvedValue([
      { id: 'a', originalName: 'a.jpg' },
      { id: 'b', originalName: 'b.jpg' },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    expect(
      wrapper.findAll('.mob-photo-card').map((card) => card.attributes('data-keep-id')),
    ).toEqual(['a', 'b']);
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

  it("adds the visited sky shown after the user's own photos, or shows it alone", async () => {
    getPhotos.mockResolvedValue([
      { id: 'p1', originalName: 'Mine.jpg', filename: 'a.jpg', dsoIds: [] },
    ]);
    sharedSkies.visitPhotos = [
      {
        id: 'v1',
        originalName: 'Theirs.jpg',
        filename: 'v.jpg',
        dsoIds: [],
        sharedSkyId: 's1',
        sharedGear: { setup: 'Lunette 80' },
      },
    ];
    try {
      const wrapper = mountPage();
      await flushPromises();
      const names = () => wrapper.findAll('.mob-photo-card-name').map((n) => n.text());
      expect(names().sort()).toEqual(['Mine.jpg', 'Theirs.jpg']);
      const theirs = wrapper.findAll('.mob-photo').find((t) => t.text().includes('Theirs.jpg'))!;
      expect(theirs.text()).toContain('Lunette 80');
      sharedSkies.ownShown = false;
      const alone = mountPage();
      await flushPromises();
      expect(alone.findAll('.mob-photo-card-name').map((n) => n.text())).toEqual(['Theirs.jpg']);
    } finally {
      sharedSkies.visitPhotos = [];
      sharedSkies.ownShown = true;
    }
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
    await flushPromises();
    expect(
      importRows.value.map((r) => (r.kind === 'pending' ? r.photo.name : r.file.name)),
    ).toEqual(['M42.jpg']);
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

  it('shows the photos stored "À résoudre" first, with where their astrometry.net solve stands', async () => {
    stored.following.add('w1');
    getPhotos.mockResolvedValue([
      waitingPhoto('w1', 'M31_stack', { state: 'solving', submissionId: 7, sentAt: 's' }),
      waitingPhoto('w2', 'NGC7000'),
      { id: 'p1', originalName: 'M42.png', filename: 'a.png' },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    const tiles = wrapper.findAll('.mob-photo-card');
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'M31_stack : Résolution',
      'NGC7000 : À résoudre',
      'M42.png',
    ]);
    // A waiting photo has its name in the caption, and no chips.
    expect(tiles[0].find('.mob-tags').exists()).toBe(false);
    expect(tiles[0].find('.mob-photo-state').classes()).toContain('mob-photo-state--busy');
    expect(tiles[1].find('.mob-photo-state').classes()).not.toContain('mob-photo-state--busy');
  });

  it('shows a solve astrometry.net goes on with as "En cours", and opens its page on a tap', async () => {
    getPhotos.mockResolvedValue([
      waitingPhoto('w1', 'NGC7000', { state: 'unfinished', submissionId: 42, sentAt: 's' }),
    ]);
    const wrapper = mountPage();
    await flushPromises();
    const tile = wrapper.find('.mob-photo-card');
    expect(tile.attributes('aria-label')).toBe('NGC7000 : En cours');
    await tile.trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/pending/w1');
  });

  it('follows the solves of the photos stored "À résoudre" again, and again once the phone is back online', async () => {
    const waiting = waitingPhoto('w1', 'NGC7000', {
      state: 'offline',
      submissionId: 42,
      sentAt: 's',
    });
    getPhotos.mockResolvedValue([
      waiting,
      { id: 'p1', originalName: 'M42.png', filename: 'a.png' },
    ]);
    mountPage();
    await flushPromises();
    expect(stored.followStoredSolves).toHaveBeenCalledTimes(1);
    expect((stored.followStoredSolves.mock.calls[0] as unknown[])[0]).toEqual([
      expect.objectContaining({ id: 'w1' }),
    ]);
    window.dispatchEvent(new Event('online'));
    await flushPromises();
    expect(stored.followStoredSolves).toHaveBeenCalledTimes(2);
  });

  it('a photo whose page is open says where it stands there, and is not followed twice', async () => {
    const waiting = waitingPhoto('w1', 'NGC7000');
    getPhotos.mockResolvedValue([waiting]);
    await openStoredPhoto(waiting as never);
    await setPendingState('w1', 'solving', { jobId: 'job-1' });
    const wrapper = mountPage();
    await flushPromises();
    const tile = wrapper.find('.mob-photo-card');
    expect(tile.attributes('aria-label')).toBe('NGC7000 : Résolution');
    expect(tile.find('.mob-photo-state').classes()).toContain('mob-photo-state--busy');
    expect((stored.followStoredSolves.mock.calls[0] as unknown[])[0]).toEqual([]);
  });

  it('hides the waiting photos with the user own ones when "Mon ciel" is not ticked', async () => {
    getPhotos.mockResolvedValue([
      { id: 'p1', originalName: 'Mine.jpg', filename: 'a.jpg' },
      waitingPhoto('w1', 'NGC7000'),
    ]);
    sharedSkies.visitPhotos = [
      { id: 'v1', originalName: 'Theirs.jpg', filename: 'v.jpg', dsoIds: [], sharedSkyId: 's1' },
    ];
    sharedSkies.ownShown = false;
    try {
      const wrapper = mountPage();
      await flushPromises();
      expect(wrapper.findAll('.mob-photo-card').map((t) => t.attributes('aria-label'))).toEqual([
        'Theirs.jpg',
      ]);
    } finally {
      sharedSkies.visitPhotos = [];
      sharedSkies.ownShown = true;
    }
  });

  it('shows the grid, not the empty state, when the only photos wait "À résoudre"', async () => {
    getPhotos.mockResolvedValue([waitingPhoto('w1', 'NGC7000')]);
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
    const dense = () => wrapper.find('.mob-photo-grid').classes('mob-photo-grid--dense');
    expect(dense()).toBe(false);
    expect(wrapper.findAll('header button').map((b) => b.attributes('aria-label'))).toEqual([
      'Affichage',
      'Trier par',
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
    // Three to a line: tighter spacing, so a four-digit NGC chip keeps its place beside "+N".
    expect(dense()).toBe(true);
    // Read again as at the next start.
    loadGalleryDisplay();
    const again = mountPage();
    await flushPromises();
    expect(again.find('.mob-photo-grid').attributes('style')).toContain('--photos-per-line: 3');
  });

  describe('sorting, search and filters', () => {
    const PHOTOS = [
      {
        id: 'a',
        originalName: 'M100',
        filename: 'a.jpg',
        observationDate: '2024-03-14T21:05:00.000Z',
        dsoIds: [],
        labels: ['nebula'],
        notes: '',
      },
      {
        id: 'b',
        originalName: 'M2',
        filename: 'b.jpg',
        observationDate: '2025-01-02T03:30:00.000Z',
        dsoIds: [],
        labels: [],
        notes: '',
      },
      {
        id: 'c',
        originalName: 'Andromeda',
        filename: 'c.jpg',
        observationDate: null,
        dsoIds: ['M31'],
        labels: ['galaxy'],
        notes: '',
      },
    ];
    const names = (wrapper: ReturnType<typeof mountPage>) =>
      wrapper.findAll('.mob-photo-card').map((c) => c.attributes('aria-label'));
    const checkSheet = (wrapper: ReturnType<typeof mountPage>, title: string) =>
      wrapper.findAllComponents({ name: 'SkyCheckSheet' }).find((c) => c.props('title') === title)!;

    it('shows the photos in natural name order, a photo named after no catalogue by its object', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      expect(names(wrapper)).toEqual(['M2', 'Andromeda', 'M100']);
    });

    it('reorders the photos from "Trier par" and keeps the choice', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.find('button[aria-label="Trier par"]').trigger('click');
      const sheet = wrapper.findComponent({ name: 'PhoneRadioSheet' });
      expect(sheet.props('open')).toBe(true);
      expect(sheet.props('options').map((o: { label: string }) => o.label)).toEqual([
        'Nom (A–Z)',
        'Nom (Z–A)',
        "Date d'observation (récentes d'abord)",
        "Date d'observation (anciennes d'abord)",
      ]);
      // a tap on "Date d'observation (récentes d'abord)"
      await sheet.findAll('[role="radio"]')[2].trigger('click');
      await flushPromises();
      expect(names(wrapper)).toEqual(['M2', 'M100', 'Andromeda']);
      expect(sheet.props('open')).toBe(false);
      loadGalleryDisplay();
      const again = mountPage();
      await flushPromises();
      expect(names(again)).toEqual(['M2', 'M100', 'Andromeda']);
    });

    it('keeps the photos the search finds', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'PhoneSearch' }).vm.$emit('update:modelValue', 'm31');
      await flushPromises();
      expect(names(wrapper)).toEqual(['Andromeda']);
    });

    it('hides the photos of an unticked label, and says when no photo is left', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.find('button[aria-label="Affichage"]').trigger('click');
      expect(wrapper.text()).toContain('Filtres');
      expect(wrapper.find('button[aria-label="Étiquettes : 3 sur 3"]').exists()).toBe(true);
      const labels = checkSheet(wrapper, 'Étiquettes');
      expect(labels.props('options').map((o: { label: string }) => o.label)).toEqual([
        '(sans étiquette)',
        'galaxy',
        'nebula',
      ]);
      labels.vm.$emit('update:selected', ['nebula']);
      await flushPromises();
      expect(names(wrapper)).toEqual(['M100']);
      expect(wrapper.find('button[aria-label="Étiquettes : 1 sur 3"]').exists()).toBe(true);

      labels.vm.$emit('update:selected', []);
      await flushPromises();
      expect(wrapper.find('.mob-empty-text').text()).toBe('Aucune photo correspondante');
      await wrapper.find('.mob-empty button').trigger('click');
      await flushPromises();
      expect(names(wrapper)).toEqual(['M2', 'Andromeda', 'M100']);
    });

    it('ticking every value again turns the filter off', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.find('button[aria-label="Affichage"]').trigger('click');
      const types = checkSheet(wrapper, 'Types');
      const all = types.props('options').map((o: { value: string }) => o.value);
      types.vm.$emit('update:selected', all.slice(1));
      await flushPromises();
      expect(galleryFilters.dsoTypes).toHaveLength(all.length - 1);
      types.vm.$emit('update:selected', all);
      await flushPromises();
      expect(galleryFilters.dsoTypes).toBeNull();
    });

    it('keeps the photos of the chosen days, "Au" waiting for "Du"', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.find('button[aria-label="Affichage"]').trigger('click');
      const to = () => wrapper.find('button[aria-label="Au : aucune date"]');
      expect(to().attributes('disabled')).toBeDefined();
      const [fromPicker, toPicker] = wrapper.findAllComponents({ name: 'PhoneNativePicker' });
      fromPicker.vm.$emit('pick', '2024-03-14');
      await flushPromises();
      expect(names(wrapper)).toEqual(['M100']);
      expect(to().attributes('disabled')).toBeUndefined();
      toPicker.vm.$emit('pick', '2025-01-02');
      await flushPromises();
      expect(names(wrapper)).toEqual(['M2', 'M100']);
      // Emptying "Du" empties "Au" too.
      fromPicker.vm.$emit('clear');
      await flushPromises();
      expect(galleryFilters.dateTo).toBeNull();
      expect(names(wrapper)).toEqual(['M2', 'Andromeda', 'M100']);
    });

    it('"Effacer les filtres" shows every photo again and keeps the search', async () => {
      getPhotos.mockResolvedValue(PHOTOS);
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.find('button[aria-label="Affichage"]').trigger('click');
      const clear = () =>
        wrapper.findAll('button').find((b) => b.text() === 'Effacer les filtres')!;
      expect(clear().attributes('disabled')).toBeDefined();
      galleryFilters.query = 'm';
      checkSheet(wrapper, 'Étiquettes').vm.$emit('update:selected', ['nebula']);
      await flushPromises();
      await clear().trigger('click');
      await flushPromises();
      expect(galleryFilters.labels).toBeNull();
      expect(galleryFilters.query).toBe('m');
    });
  });

  it("opens the import with the pictures chosen in the phone's gallery", async () => {
    getPhotos.mockResolvedValue([]);
    pickGalleryPhotos.mockResolvedValue([new File(['x'], 'IMG_0001.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('.mob-empty button').trigger('click');
    await rowWith(wrapper, 'Depuis la galerie du téléphone').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(
      importRows.value.map((r) => (r.kind === 'pending' ? r.photo.name : r.file.name)),
    ).toEqual(['IMG_0001.jpg']);
    expect(push).toHaveBeenCalledWith('/gallery/import');
  });
});
