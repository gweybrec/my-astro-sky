import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { setBackend } from '@myastrosky/app-state/backend';
import type { Component } from 'vue';
import type { DSO } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const showError = vi.fn();
const confirm = vi.fn();
const showInfo = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: (...a: unknown[]) => showInfo(...a),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));

const search = vi.fn();
vi.mock('@myastrosky/core/targets/recommend', () => ({
  runTargetRecommendationSliced: (...a: unknown[]) => search(...a),
}));

import TargetsPage from '../src/pages/TargetsPage.vue';
import TypesSheet from '../src/pages/targets/TypesSheet.vue';
import FiltersSheet from '../src/pages/targets/FiltersSheet.vue';
import SearchSettingsSheet from '../src/pages/targets/SearchSettingsSheet.vue';
import RegionsPage from '../src/pages/RegionsPage.vue';
import { skyRegionDraw, skyRegionView } from '../src/sky-modes';
import { writeObserverLocation } from '@myastrosky/core/observer-location';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import { reloadTargetsPrefs, updateTargetsPrefs } from '../src/composables/useTargets';

const GEAR = {
  telescope: [
    {
      id: 't1',
      brand: 'Askar',
      model: 'FRA400',
      aperture_mm: 72,
      focal_length_mm: 400,
      f_ratio: 5.6,
      is_smart_telescope: false,
      integrated_camera_id: null,
    },
  ],
  camera: [
    {
      id: 'c1',
      brand: 'ZWO',
      model: 'ASI533MC',
      sensor_width_mm: 11.3,
      sensor_height_mm: 11.3,
      pixel_size_um: 3.76,
      resolution_x: 3008,
      resolution_y: 3008,
      color_type: 'OSC',
    },
  ],
  accessory: [],
  filter: [],
} as const;

const setups = [
  {
    id: 's1',
    name: 'Équipement 1',
    telescopeId: 't1',
    cameraId: 'c1',
    accessoryId: null,
    enabled: true,
  },
];
const regions = [
  { id: 'r1', name: 'Vue depuis le jardin', color: '#4a9eff', points: [] },
  { id: 'r2', name: 'Ciel du nord', color: '#5ec27a', points: [] },
];

const backend = {
  gear: { listSetups: vi.fn(), listCatalog: vi.fn() },
  photos: { listWithSizes: vi.fn() },
  skyRegions: { list: vi.fn(), remove: vi.fn() },
  horizon: { getProfile: vi.fn() },
};

const dso = (over: Partial<DSO>): DSO =>
  ({
    id: 'NGC7000',
    ra: 314,
    dec: 44,
    type: 'EN',
    majAxis: 120,
    minAxis: 100,
    pa: 0,
    mag: 4,
    displayName: "Nébuleuse de l'Amérique du Nord",
    catalogs: ['NGC7000'],
    emissionLines: null,
    constellation: 'CYG',
    rating: 5,
    difficulty: 1,
    containerId: null,
    priority: 0,
    ...over,
  }) as DSO;

const suggestion = (d: DSO, maxAltDeg: number, hour: number) => ({
  dso: d,
  maxAltDeg,
  bestTimeUtc: new Date(2026, 5, 12, hour, 38),
  score: 1,
  fovFitScore: 1,
  altScore: 1,
  brightnessScore: 1,
});

function ok(suggestions: ReturnType<typeof suggestion>[]) {
  return { kind: 'ok', suggestions, preset: {}, location: {}, dateNight: new Date(), dateStr: '' };
}

function app() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  return { router, global: { stubs: ionicStubs, plugins: [router, createPinia()] } };
}

/** Lets the page's own paint-yielding timer run after the promises. */
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 10));
  await flushPromises();
};

const mounted: { unmount: () => void }[] = [];
const show = (...a: Parameters<typeof mount>) => {
  const w = mount(...a);
  mounted.push(w);
  return w;
};

const prefsOf = () => JSON.parse(storage().get('targets-prefs-v3')!);

beforeEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  storage().set(
    'targets-prefs-v3',
    JSON.stringify({
      setupId: 's1',
      lat: 48.58,
      lon: 7.75,
      lastDateISO: null,
      enabledTypes: ['EN'],
    }),
  );
  reloadTargetsPrefs();
  setActivePinia(createPinia());
  configureGearCatalogLoader(async (type) => [...GEAR[type]] as object[]);
  vi.clearAllMocks();
  backend.gear.listSetups.mockResolvedValue(setups);
  backend.photos.listWithSizes.mockResolvedValue([]);
  backend.skyRegions.list.mockResolvedValue(regions);
  backend.skyRegions.remove.mockResolvedValue(undefined);
  backend.horizon.getProfile.mockResolvedValue(null);
  search.mockResolvedValue(
    ok([
      suggestion(dso({}), 86, 21),
      suggestion(
        dso({
          id: 'M27',
          displayName: "Nébuleuse de l'Haltère",
          catalogs: ['M27'],
          type: 'PN',
          constellation: 'VUL',
          mag: 7.4,
          rating: 4,
        }),
        64,
        20,
      ),
    ]),
  );
  setBackend(backend as never);
});

describe('the Cibles page', () => {
  it('shows the board row for each target and the context fields', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    const rows = w.findAll('.mob-row--roomy');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Nébuleuse de l'Amérique du Nord");
    expect(rows[0].text()).toContain('NGC7000');
    expect(rows[0].text()).toContain('Nébuleuse en émission');
    expect(rows[0].text()).toContain('CYG');
    expect(rows[0].text()).toContain('Magnitude 4.0');
    expect(rows[0].text()).toContain('★★★★★');
    expect(rows[0].text()).toContain('86°');
    expect(rows[0].text()).toContain('21:38');
    expect(rows[1].text()).toContain('★★★★☆');
    // One row under the search field: the setup, and the number of types alone.
    const fields = w.findAll('.mob-context > button');
    expect(fields.map((b) => b.text())).toEqual(['Équipement 1', '1 types']);
    expect(fields[1].attributes('aria-label')).toBe("Types d'objets : 1 types");
    // Beside the search field: the search settings, then the filters.
    expect(w.findAll('.mob-topbar button').map((b) => b.attributes('aria-label'))).toEqual([
      'Paramètres de recherche',
      'Filtres',
    ]);
  });

  it('opens the search settings and the filters from their buttons, and searches again when one closes', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    const settings = w.findComponent(SearchSettingsSheet);
    const filters = w.findComponent(FiltersSheet);
    expect([settings.props('open'), filters.props('open')]).toEqual([false, false]);
    await w.find('button[aria-label="Paramètres de recherche"]').trigger('click');
    expect(settings.props('open')).toBe(true);
    await w.find('button[aria-label="Filtres"]').trigger('click');
    expect(filters.props('open')).toBe(true);
    updateTargetsPrefs({ minAltDeg: 40 });
    settings.vm.$emit('update:open', false);
    await settle();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('searches with the stored preferences, the setups and the gear', async () => {
    show(TargetsPage, { global: app().global });
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    const input = search.mock.calls[0][0];
    expect(input.prefs).toMatchObject({ setupId: 's1', lat: 48.58, enabledTypes: ['EN'] });
    expect(input.gear.setups).toEqual(setups);
    expect(input.gear.telescopes).toHaveLength(1);
    expect(input.photographedIds).toBeNull();
  });

  it('reads the photos only when the filter that excludes photographed objects is on', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({
        setupId: 's1',
        lat: 1,
        lon: 1,
        lastDateISO: null,
        excludePhotographed: true,
      }),
    );
    backend.photos.listWithSizes.mockResolvedValue([{ id: 'p', dsoIds: ['M31'] }]);
    show(TargetsPage, { global: app().global });
    await settle();
    expect(backend.photos.listWithSizes).toHaveBeenCalled();
    expect(search.mock.calls[0][0].photographedIds).toEqual(new Set(['M31']));
  });

  it('picks the first setup when none is chosen', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({ setupId: null, lat: 48.58, lon: 7.75, lastDateISO: null }),
    );
    show(TargetsPage, { global: app().global });
    await settle();
    expect(prefsOf().setupId).toBe('s1');
  });

  it('lists the setups from the first field and searches again with the chosen one', async () => {
    backend.gear.listSetups.mockResolvedValue([
      ...setups,
      { id: 's2', name: 'Lunette 72', telescopeId: 't1', cameraId: 'c1', accessoryId: null },
    ]);
    const w = show(TargetsPage, { global: app().global });
    await settle();
    await w.find('button[aria-label^="Équipement"]').trigger('click');
    const sheet = w
      .findAllComponents(PhoneRadioSheet as Component)
      .find((c) => (c.props() as { title: string }).title === 'Setup')!;
    const props = sheet.props() as { open: boolean; options: { label: string }[] };
    expect(props.open).toBe(true);
    expect(props.options.map((o) => o.label)).toEqual(['Équipement 1', 'Lunette 72']);
    sheet.vm.$emit('update:value', 's2');
    sheet.vm.$emit('update:open', false);
    await settle();
    expect(prefsOf().setupId).toBe('s2');
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0].prefs.setupId).toBe('s2');
    expect(w.find('button[aria-label^="Équipement"]').text()).toContain('Lunette 72');
  });

  it('searches for the night stored by the search settings, and for today when none is', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    const today = search.mock.calls[0][0].dateStr;
    expect(today).toMatch(/^\d{4}-\d\d-\d\d$/);
    updateTargetsPrefs({ lastDateISO: '2031-03-09' });
    w.findComponent(SearchSettingsSheet).vm.$emit('update:open', false);
    await settle();
    expect(search.mock.calls[1][0].dateStr).toBe('2031-03-09');
  });

  it('sorts again from what the search found, so a sort chosen twice gives the same order', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    const names = () => w.findAll('.mob-row--roomy .mob-row-title').map((r) => r.text());
    const filters = w.findComponent(FiltersSheet);
    // The two test targets have the ratings 5 and 4: by interest the first one leads, by name the second (M27).
    const byRating = names();
    updateTargetsPrefs({ sortBy: 'name' });
    filters.vm.$emit('update:open', false);
    await settle();
    expect(names()).toEqual([...byRating].reverse());
    updateTargetsPrefs({ sortBy: 'rating' });
    filters.vm.$emit('update:open', false);
    await settle();
    expect(names()).toEqual(byRating);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('filters the rows by the typed text', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    await w.find('input[type="search"]').setValue('m27');
    expect(w.findAll('.mob-row--roomy')).toHaveLength(1);
    expect(w.findAll('.mob-row--roomy')[0].text()).toContain('M27');
  });

  it("opens a target's page on a tap", async () => {
    const { global, router } = app();
    const w = show(TargetsPage, { global });
    await settle();
    await w.find('input[type="search"]').setValue('m27');
    await w.find('.mob-row--roomy').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/targets/M27');
  });

  it('shows the no-setup board with its button leading to the setups', async () => {
    backend.gear.listSetups.mockResolvedValue([]);
    search.mockResolvedValue({ kind: 'empty', reason: 'no-setup' });
    const { global, router } = app();
    const w = show(TargetsPage, { global });
    await settle();
    expect(w.text()).toContain('Aucun setup configuré.');
    await w.find('.mob-empty button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/settings/setups');
  });

  it('shows the no-result board when nothing matches', async () => {
    search.mockResolvedValue(ok([]));
    const w = show(TargetsPage, { global: app().global });
    await settle();
    expect(w.text()).toContain('Aucune cible trouvée pour ces paramètres.');
    expect(w.findAll('.mob-row--roomy')).toHaveLength(0);
  });

  it('shows the error toast when the search fails', async () => {
    search.mockRejectedValue(new Error('boom'));
    const w = show(TargetsPage, { global: app().global });
    await settle();
    expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(w.findAll('.mob-row--roomy')).toHaveLength(0);
  });

  it('keeps the rows built in chunks as the list is scrolled', async () => {
    search.mockResolvedValue(
      ok(
        Array.from({ length: 40 }, (_, i) =>
          suggestion(dso({ id: `M${i}`, catalogs: [`M${i}`] }), 50, 22),
        ),
      ),
    );
    const w = show(TargetsPage, { global: app().global });
    await settle();
    expect(w.findAll('.mob-row--roomy')).toHaveLength(15);
  });
});

describe('the types sheet', () => {
  it('ticks the stored types and stores a change at once', async () => {
    const w = show(TypesSheet, { props: { open: true }, global: app().global });
    await settle();
    const boxes = w.findAll('[role="checkbox"]');
    expect(boxes).toHaveLength(14);
    expect(boxes[0].text()).toContain('Tous');
    expect(boxes[0].attributes('aria-checked')).toBe('false');
    const en = boxes.find((b) => b.text().includes('Nébuleuses en émission'))!;
    expect(en.attributes('aria-checked')).toBe('true');
    const pn = boxes.find((b) => b.text().includes('Nébuleuses planétaires'))!;
    await pn.trigger('click');
    expect(prefsOf().enabledTypes).toEqual(['EN', 'PN']);
    await en.trigger('click');
    expect(prefsOf().enabledTypes).toEqual(['PN']);
  });

  it('"Tous" ticks every type and "Réinitialiser" ticks them again', async () => {
    const w = show(TypesSheet, { props: { open: true }, global: app().global });
    await settle();
    await w.findAll('[role="checkbox"]')[0].trigger('click');
    expect(prefsOf().enabledTypes).toHaveLength(13);
    await w.findAll('[role="checkbox"]')[0].trigger('click');
    expect(prefsOf().enabledTypes).toEqual([]);
    const reset = w.findAll('button').find((b) => b.text() === 'Réinitialiser')!;
    await reset.trigger('click');
    expect(prefsOf().enabledTypes).toHaveLength(13);
  });

  it('closes on "Appliquer"', async () => {
    const w = show(TypesSheet, { props: { open: true }, global: app().global });
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Appliquer')!
      .trigger('click');
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });
});

describe('the search settings sheet', () => {
  const mountSheet = () => {
    const made = app();
    const w = show(SearchSettingsSheet, { props: { open: true }, global: made.global });
    return { w, router: made.router };
  };

  it('shows every control of the board, in its order, without the "Options" title', async () => {
    const { w } = mountSheet();
    await settle();
    const text = w.text();
    const labels = [
      'Paramètres de recherche',
      'Nuit',
      'Ce soir',
      'Lieu',
      '48.58, 7.75',
      'Ciel observable',
      'Nord',
      'Ouest',
      'Région du ciel',
      'Tout le ciel',
      'Altitude',
      'Min',
      'Max',
      "Fenêtre d'observation",
      'Inclure les objets trop grands pour le champ',
      'Exclure les objets déjà photographiés',
      "Respecter l'horizon",
      'Réinitialiser',
      'Appliquer',
    ];
    const places = labels.map((label) => text.indexOf(label));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
    expect(text).toContain('20°');
    expect(text).toContain('80°');
    expect(w.findAll('.mob-section-header').map((h) => h.text())).toEqual([
      'Ciel',
      "Fenêtre d'observation",
    ]);
    for (const absent of ['Intérêt DSO', 'Difficulté', 'Catalogues', 'Trier par']) {
      expect(text).not.toContain(absent);
    }
  });

  it('has an "i" for the three switches and none for the sky directions', async () => {
    const { w } = mountSheet();
    await settle();
    const infos = w
      .findAll('button')
      .map((b) => b.attributes('aria-label') ?? '')
      .filter((label) => label.startsWith('Informations'));
    expect(infos).toEqual([
      'Informations : Inclure les objets trop grands pour le champ',
      'Informations : Exclure les objets déjà photographiés',
      "Informations : Respecter l'horizon",
    ]);
    await w
      .findAll('button')
      .find((b) => b.attributes('aria-label') === "Informations : Respecter l'horizon")!
      .trigger('click');
    expect(showInfo).toHaveBeenCalledWith(
      "Respecter l'horizon",
      'Exclure les cibles cachées par le relief à leur culmination',
    );
  });

  it("stores the night chosen in the phone's date picker and shows it", async () => {
    const { w } = mountSheet();
    await settle();
    const night = w.findAllComponents(PhoneNativePicker)[0];
    expect(night.props('type')).toBe('date');
    night.vm.$emit('pick', '2031-03-09');
    await settle();
    expect(prefsOf().lastDateISO).toBe('2031-03-09');
    const field = w.find('button[aria-label^="Nuit"]');
    expect(field.text()).not.toContain('Ce soir');
    expect(field.text()).toContain('2031');
  });

  it('opens the observing location from the "Lieu" field and closes the sheet', async () => {
    const { w, router } = mountSheet();
    await settle();
    await w.find('button[aria-label^="Lieu"]').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/settings/location');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('stores a direction at once', async () => {
    const { w } = mountSheet();
    await settle();
    await w.find('button[aria-label="Ouest"]').trigger('click');
    expect(prefsOf().horizonDirs).toEqual(['N', 'S', 'E']);
  });

  it("stores the two times of the observation window chosen in the phone's time picker", async () => {
    const { w } = mountSheet();
    await settle();
    const [, from, to] = w.findAllComponents(PhoneNativePicker);
    expect([from.props('type'), to.props('type')]).toEqual(['time', 'time']);
    from.vm.$emit('pick', '22:00');
    to.vm.$emit('pick', '02:00');
    await settle();
    expect(prefsOf()).toMatchObject({ obsStartTime: '22:00', obsEndTime: '02:00' });
    // The picker's own "Effacer" empties a time, as the empty choice of the desktop's list does.
    from.vm.$emit('clear');
    await settle();
    expect(prefsOf().obsStartTime).toBeUndefined();
    expect(prefsOf().obsEndTime).toBe('02:00');
  });

  it('"Réinitialiser" puts the sky, the window and the switches back, and keeps the night, the place and the filters', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({
        setupId: 's1',
        lat: 48.58,
        lon: 7.75,
        lastDateISO: '2031-03-09',
        enabledTypes: ['EN'],
        horizonDirs: ['N'],
        minAltDeg: 30,
        obsStartTime: '22:00',
        respectHorizon: true,
        skyRegionId: 'r1',
        enabledRatings: [5],
        sortBy: 'name',
      }),
    );
    reloadTargetsPrefs();
    const { w } = mountSheet();
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Réinitialiser')!
      .trigger('click');
    const stored = prefsOf();
    expect(stored).toMatchObject({
      setupId: 's1',
      lat: 48.58,
      lastDateISO: '2031-03-09',
      enabledTypes: ['EN'],
      enabledRatings: [5],
      sortBy: 'name',
    });
    for (const key of [
      'horizonDirs',
      'minAltDeg',
      'obsStartTime',
      'respectHorizon',
      'skyRegionId',
    ]) {
      expect(stored).not.toHaveProperty(key);
    }
  });
});

describe('the filters sheet', () => {
  it('shows the sort, then the four filters of the board, and nothing of the search settings', async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    const text = w.text();
    const labels = [
      'Filtres',
      'Trier par',
      'Intérêt DSO',
      'Difficulté',
      'Catalogues',
      'Constellations',
    ];
    const places = labels.map((label) => text.indexOf(label));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
    expect(text).toContain('Réinitialiser');
    expect(text).toContain('Appliquer');
    for (const absent of ['Ciel observable', 'Région du ciel', "Respecter l'horizon", 'Nuit']) {
      expect(text).not.toContain(absent);
    }
  });

  it("offers the desktop's nine sorts and stores the chosen one", async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    const sortRow = () => w.findAll('.mob-row').find((r) => r.text().includes('Trier par'))!;
    expect(sortRow().text()).toContain('Intérêt photo');
    await sortRow().trigger('click');
    const list = w.findAllComponents(PhoneRadioSheet as Component)[0];
    const props = list.props() as { open: boolean; title: string; options: { label: string }[] };
    expect([props.open, props.title]).toEqual([true, 'Trier par']);
    expect(props.options.map((o) => o.label)).toEqual([
      'Intérêt photo',
      'Score global',
      'Altitude max.',
      'Heure de transit',
      'Luminosité',
      'Taille',
      'Remplissage du champ',
      'Nom',
      'Difficulté',
    ]);
    list.vm.$emit('update:value', 'fov-fit');
    await settle();
    expect(prefsOf().sortBy).toBe('fov-fit');
    expect(sortRow().text()).toContain('Remplissage du champ');
  });

  it('stores a rating and a difficulty at once', async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    await w.find('button[aria-label="Intérêt 1 sur 5"]').trigger('click');
    expect(prefsOf().enabledRatings).toEqual([2, 3, 4, 5]);
    await w.find('button[aria-label="Difficulté 5 sur 5"]').trigger('click');
    expect(prefsOf().enabledDifficulties).toEqual([1, 2, 3, 4]);
  });

  it('"Réinitialiser" removes the four filters and keeps the sort and the search settings', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({
        setupId: 's1',
        lat: 48.58,
        lon: 7.75,
        lastDateISO: null,
        horizonDirs: ['N'],
        enabledRatings: [5],
        enabledDifficulties: [1],
        enabledCatalogs: ['M'],
        enabledConstellations: ['CYG'],
        sortBy: 'name',
      }),
    );
    reloadTargetsPrefs();
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Réinitialiser')!
      .trigger('click');
    const stored = prefsOf();
    expect(stored).toMatchObject({ setupId: 's1', horizonDirs: ['N'], sortBy: 'name' });
    for (const key of [
      'enabledRatings',
      'enabledDifficulties',
      'enabledCatalogs',
      'enabledConstellations',
    ]) {
      expect(stored).not.toHaveProperty(key);
    }
  });
});

describe('the regions page', () => {
  it('lists "Tout le ciel" and the saved regions, with the chosen one marked', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({ setupId: 's1', lat: 1, lon: 1, lastDateISO: null, skyRegionId: 'r1' }),
    );
    reloadTargetsPrefs();
    const w = show(RegionsPage, { global: app().global });
    await settle();
    const radios = w.findAll('[role="radio"]');
    expect(radios.map((r) => r.text())).toEqual([
      'Tout le ciel',
      'Vue depuis le jardin',
      'Ciel du nord',
    ]);
    expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('chooses a region at once, and "Tout le ciel" clears it', async () => {
    const w = show(RegionsPage, { global: app().global });
    await settle();
    await w.findAll('[role="radio"]')[2].trigger('click');
    expect(prefsOf().skyRegionId).toBe('r2');
    await w.findAll('[role="radio"]')[0].trigger('click');
    expect(prefsOf()).not.toHaveProperty('skyRegionId');
  });

  it('opens the map to draw a region, or to show one, and comes back here when it ends', async () => {
    writeObserverLocation(48.58, 7.75);
    const { router, global } = app();
    const replace = vi.spyOn(router, 'replace');
    const w = show(RegionsPage, { global });
    await settle();
    await w.find('button[aria-label="Dessiner une nouvelle région"]').trigger('click');
    expect(skyRegionDraw.value).toEqual({ returnTo: '/targets/regions' });
    expect(replace).toHaveBeenCalledWith('/tabs/sky');
    skyRegionDraw.value = null;
    await w.find('button[aria-label="Voir la région « Vue depuis le jardin »"]').trigger('click');
    expect(skyRegionView.value).toEqual({ region: regions[0], returnTo: '/targets/regions' });
    skyRegionView.value = null;
  });

  it('says the location is missing instead of opening the map without one', async () => {
    writeObserverLocation(null, null);
    const { router, global } = app();
    const replace = vi.spyOn(router, 'replace');
    const w = show(RegionsPage, { global });
    await settle();
    await w.find('button[aria-label="Dessiner une nouvelle région"]').trigger('click');
    await w.find('button[aria-label="Voir la région « Vue depuis le jardin »"]').trigger('click');
    expect(skyRegionDraw.value).toBeNull();
    expect(skyRegionView.value).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Définissez d'abord une position d'observation" }),
    );
  });

  it('asks before deleting, deletes after the yes, and keeps the region after the no', async () => {
    const w = show(RegionsPage, { global: app().global });
    await settle();
    confirm.mockResolvedValueOnce(false);
    await w.find('button[aria-label="Supprimer la région « Ciel du nord »"]').trigger('click');
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Supprimer la région', destructive: true }),
    );
    expect(backend.skyRegions.remove).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await w.find('button[aria-label="Supprimer la région « Ciel du nord »"]').trigger('click');
    await settle();
    expect(backend.skyRegions.remove).toHaveBeenCalledWith('r2');
  });

  it('clears the filter when the chosen region is deleted, and shows the toast on a failure', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({ setupId: 's1', lat: 1, lon: 1, lastDateISO: null, skyRegionId: 'r2' }),
    );
    reloadTargetsPrefs();
    const w = show(RegionsPage, { global: app().global });
    await settle();
    confirm.mockResolvedValue(true);
    await w.find('button[aria-label="Supprimer la région « Ciel du nord »"]').trigger('click');
    await settle();
    expect(prefsOf()).not.toHaveProperty('skyRegionId');
    backend.skyRegions.remove.mockRejectedValue(new Error('nope'));
    await w
      .find('button[aria-label="Supprimer la région « Vue depuis le jardin »"]')
      .trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
  });
});
