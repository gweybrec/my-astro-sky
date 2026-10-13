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
import RegionsPage from '../src/pages/RegionsPage.vue';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import { reloadTargetsPrefs } from '../src/composables/useTargets';

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
    const text = w.text();
    expect(text).toContain('Équipement 1');
    expect(text).toContain('Ce soir');
    expect(text).toContain('48.58, 7.75');
    expect(text).toContain("Types d'objets");
    expect(text).toContain('1 types');
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
    const sheet = w.findAllComponents(PhoneRadioSheet as Component)[0];
    const props = sheet.props() as { open: boolean; title: string; options: { label: string }[] };
    expect([props.open, props.title]).toEqual([true, 'Setup']);
    expect(props.options.map((o) => o.label)).toEqual(['Équipement 1', 'Lunette 72']);
    sheet.vm.$emit('update:value', 's2');
    sheet.vm.$emit('update:open', false);
    await settle();
    expect(prefsOf().setupId).toBe('s2');
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0].prefs.setupId).toBe('s2');
    expect(w.find('button[aria-label^="Équipement"]').text()).toContain('Lunette 72');
  });

  it("searches for the night chosen in the phone's date picker, kept for the next time", async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    const today = search.mock.calls[0][0].dateStr;
    const picker = w.findComponent(PhoneNativePicker);
    expect([picker.props('type'), picker.props('value')]).toEqual(['date', today]);
    picker.vm.$emit('pick', '2031-03-09');
    await settle();
    expect(prefsOf().lastDateISO).toBe('2031-03-09');
    expect(search.mock.calls[1][0].dateStr).toBe('2031-03-09');
    const night = w.find('button[aria-label^="Nuit"]');
    expect(night.text()).not.toContain('Ce soir');
    expect(night.text()).toContain('2031');
  });

  it('opens the observing location from the third field', async () => {
    const { router, global } = app();
    const w = show(TargetsPage, { global });
    await settle();
    await w.find('button[aria-label^="Lieu"]').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/settings/location');
  });

  it('filters the rows by the typed text', async () => {
    const w = show(TargetsPage, { global: app().global });
    await settle();
    await w.find('input[type="search"]').setValue('m27');
    expect(w.findAll('.mob-row--roomy')).toHaveLength(1);
    expect(w.findAll('.mob-row--roomy')[0].text()).toContain('M27');
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

describe('the filters sheet', () => {
  it('shows every control of the board', async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    const text = w.text();
    for (const label of [
      'Filtres',
      'Ciel observable',
      'Nord',
      'Ouest',
      'Région du ciel',
      'Tout le ciel',
      'Altitude',
      'Min',
      'Max',
      "Fenêtre d'observation",
      'Intérêt DSO',
      'Difficulté',
      'Catalogues',
      'Constellations',
      'Inclure les objets trop grands pour le champ',
      'Exclure les objets déjà photographiés',
      "Respecter l'horizon",
      'Réinitialiser',
      'Appliquer',
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('20°');
    expect(text).toContain('80°');
  });

  it('stores a direction, a rating and a difficulty at once', async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    await w.find('button[aria-label="Ouest"]').trigger('click');
    expect(prefsOf().horizonDirs).toEqual(['N', 'S', 'E']);
    await w.find('button[aria-label="Intérêt 1 sur 5"]').trigger('click');
    expect(prefsOf().enabledRatings).toEqual([2, 3, 4, 5]);
    await w.find('button[aria-label="Difficulté 5 sur 5"]').trigger('click');
    expect(prefsOf().enabledDifficulties).toEqual([1, 2, 3, 4]);
  });

  it("stores the two times of the observation window chosen in the phone's time picker", async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    const [from, to] = w.findAllComponents(PhoneNativePicker);
    expect([from.props('type'), to.props('type')]).toEqual(['time', 'time']);
    from.vm.$emit('pick', '22:00');
    to.vm.$emit('pick', '02:00');
    await settle();
    expect(prefsOf()).toMatchObject({ obsStartTime: '22:00', obsEndTime: '02:00' });
  });

  it('"Réinitialiser" removes every filter and keeps the rest of the record', async () => {
    storage().set(
      'targets-prefs-v3',
      JSON.stringify({
        setupId: 's1',
        lat: 48.58,
        lon: 7.75,
        lastDateISO: null,
        enabledTypes: ['EN'],
        horizonDirs: ['N'],
        minAltDeg: 30,
        respectHorizon: true,
        skyRegionId: 'r1',
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
    expect(stored).toMatchObject({ setupId: 's1', lat: 48.58, enabledTypes: ['EN'] });
    for (const key of ['horizonDirs', 'minAltDeg', 'respectHorizon', 'skyRegionId']) {
      expect(stored).not.toHaveProperty(key);
    }
  });

  it('opens the explanation behind the "i" of the sky directions', async () => {
    const w = show(FiltersSheet, { props: { open: true }, global: app().global });
    await settle();
    await w.find('button[aria-label="Informations : Ciel observable"]').trigger('click');
    expect(showInfo).toHaveBeenCalledWith('Ciel observable', expect.stringContaining('Décochez'));
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

  it('shows the pin and the plus waiting, as the board draws them: they need the sky map', async () => {
    const w = show(RegionsPage, { global: app().global });
    await settle();
    const pin = w.find('button[aria-label="Voir la région « Vue depuis le jardin »"]');
    expect(pin.attributes('aria-disabled')).toBeDefined();
    expect(
      w.find('button[aria-label="Dessiner une nouvelle région"]').attributes('aria-disabled'),
    ).toBeDefined();
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
