import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { writeObserverLocation } from '@myastrosky/core/observer-location';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { ionicStubs, mapSheetHost } from './helpers';

vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));

import SkyLayersSheet from '../src/pages/sky/SkyLayersSheet.vue';
import { showInfo } from '../src/composables/useConfirm';
import SkyDisplaySheet from '../src/pages/sky/SkyDisplaySheet.vue';
import PhoneToggleRow from '../src/components/PhoneToggleRow.vue';
import PhoneSliderRow from '../src/components/PhoneSliderRow.vue';
import SkyCheckSheet from '../src/pages/sky/SkyCheckSheet.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import { useFisheyeStore } from '@myastrosky/app-state/stores/fisheye';

/** The map's layers sheet and display sheet, driving the shared stores. */

const buttonNamed = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the layers sheet ("Ciel, calques de la carte")', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
    vi.mocked(showInfo).mockClear();
  });
  const mountSheet = () =>
    mount(SkyLayersSheet, { global: { stubs: ionicStubs, provide: mapSheetHost } });
  const row = (w: ReturnType<typeof mount>, title: string) =>
    w.findAllComponents(PhoneToggleRow).find((r) => r.props('title') === title)!;
  const LAYERS = [
    'Projection locale',
    'Grille azimutale',
    'Points cardinaux',
    "Trajectoire de l'objet sélectionné",
    'Horizon du relief',
    'Lune',
    'Soleil',
    'Planètes',
  ];
  // A location and the sky at a date: what most layers need.
  function located() {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    useSkyTimeStore().setMode('date');
  }

  it('shows the date switch, then the layers, each with its icon and its explanation', () => {
    const rows = mountSheet().findAllComponents(PhoneToggleRow);
    expect(rows.map((r) => r.props('title'))).toEqual(['Ciel du jour', ...LAYERS]);
    for (const r of rows) {
      expect(r.props('icon')).toContain('<svg');
      expect(r.props('info')).toBeTruthy();
    }
  });

  it('puts the map on the sky at a date with its first switch, and back on the live sky', () => {
    const w = mountSheet();
    const time = useSkyTimeStore();
    row(w, 'Ciel du jour').vm.$emit('update:modelValue', true);
    expect(time.mode).toBe('date');
    row(w, 'Ciel du jour').vm.$emit('update:modelValue', false);
    expect(time.mode).toBe('live');
  });

  it('greys out every layer while the map shows the live sky', () => {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    const w = mountSheet();
    expect(row(w, 'Ciel du jour').props('disabled')).toBeFalsy();
    for (const title of LAYERS) expect(row(w, title).props('disabled')).toBe(true);
  });

  it('turns the moon, the sun, the planets, the azimuth grid and the cardinal points on in the sky-time store', () => {
    located();
    const w = mountSheet();
    const time = useSkyTimeStore();
    for (const [title, key] of [
      ['Lune', 'showMoon'],
      ['Soleil', 'showSun'],
      ['Planètes', 'showPlanets'],
      ['Grille azimutale', 'showAzimuthGrid'],
      ['Points cardinaux', 'showCardinalPoints'],
    ] as const) {
      expect(row(w, title).props('disabled')).toBe(false);
      row(w, title).vm.$emit('update:modelValue', true);
      expect(time[key]).toBe(true);
    }
  });

  it('greys out the local projection without a location', () => {
    useSkyTimeStore().setMode('date');
    expect(row(mountSheet(), 'Projection locale').props('disabled')).toBe(true);
  });

  it('turns the local projection on once there is a location and the map shows a date', () => {
    located();
    const w = mountSheet();
    expect(row(w, 'Projection locale').props('disabled')).toBe(false);
    row(w, 'Projection locale').vm.$emit('update:modelValue', true);
    expect(useSkyTimeStore().localSkyMode).toBe(true);
  });

  it('offers the trajectory with a location and the sky at a date, local projection or not', () => {
    useSkyTimeStore().setMode('date');
    const trajectory = (w: ReturnType<typeof mount>) =>
      row(w, "Trajectoire de l'objet sélectionné");
    expect(trajectory(mountSheet()).props('disabled')).toBe(true);
    located();
    expect(useSkyTimeStore().localSkyMode).toBe(false);
    expect(trajectory(mountSheet()).props('disabled')).toBe(false);
  });

  it('keeps the local projection switch where it was while the live sky greys it out', async () => {
    located();
    const w = mountSheet();
    const time = useSkyTimeStore();
    time.setLocalSkyMode(true);
    row(w, 'Ciel du jour').vm.$emit('update:modelValue', false);
    await w.vm.$nextTick();
    expect(row(w, 'Projection locale').props('disabled')).toBe(true);
    expect(row(w, 'Projection locale').props('modelValue')).toBe(true);
    row(w, 'Ciel du jour').vm.$emit('update:modelValue', true);
    expect(time.localSkyMode).toBe(true);
  });

  it('keeps the terrain horizon greyed out until there is a profile', async () => {
    located();
    const w = mountSheet();
    expect(row(w, 'Horizon du relief').props('disabled')).toBe(true);
    useHorizonProfileStore().applyProfile(
      { lat: 48, lon: 7, obsHeightM: null, azStepDeg: 1, alts: [1, 2, 3], summits: [] } as never,
      false,
    );
    await w.vm.$nextTick();
    expect(row(w, 'Horizon du relief').props('disabled')).toBe(false);
  });

  it('opens the explanation of a greyed-out layer from its "i"', async () => {
    const w = mountSheet();
    const trajectory = row(w, "Trajectoire de l'objet sélectionné");
    expect(trajectory.props('disabled')).toBe(true);
    await trajectory.find('.mob-toggle-info button').trigger('click');
    expect(showInfo).toHaveBeenCalledWith(
      "Trajectoire de l'objet sélectionné",
      expect.stringContaining("lieu d'observation"),
    );
  });

  it('asks to be closed by its handle', async () => {
    const w = mountSheet();
    await w.find('.mob-sheet-grab').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
  });
});

describe('the display sheet ("Ciel, affichage")', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  const mountSheet = () =>
    mount(SkyDisplaySheet, { props: { open: true }, global: { stubs: ionicStubs } });
  const toggle = (w: ReturnType<typeof mount>, title: string) =>
    w.findAllComponents(PhoneToggleRow).find((r) => r.props('title') === title)!;
  const slider = (w: ReturnType<typeof mount>, label: string) =>
    w.findAllComponents(PhoneSliderRow).find((r) => r.props('label') === label)!;

  it('counts the points of interest and labels of the photos placed on the map', () => {
    const photo = (labels: string[], pois: { categoryId: string; name: string }[]) => ({
      photo: { labels, pointsOfInterest: pois },
    });
    const layer = {
      getPlacedPhotos: () => [
        photo(['Seestar'], [{ categoryId: 'cat-comet', name: 'C/2023 A3' }]),
        photo([], [{ categoryId: 'cat-asteroid', name: 'Vesta' }]),
      ],
    };
    useDisplayStore().setVisibleLabel('Seestar', false);
    const w = mount(SkyDisplaySheet, {
      props: { open: true, layer: layer as never },
      global: { stubs: ionicStubs },
    });
    expect(buttonNamed(w, "Points d'intérêt : 2 sur 2").exists()).toBe(true);
    expect(buttonNamed(w, 'Étiquettes : 1 sur 2').exists()).toBe(true);
  });

  it('opens the points of interest and labels sheets with their photos, and applies each tick at once', async () => {
    const photo = (labels: string[], pois: { categoryId: string; name: string }[]) => ({
      photo: { labels, pointsOfInterest: pois },
    });
    const layer = {
      getPlacedPhotos: () => [
        photo(['Seestar'], [{ categoryId: 'cat-comet', name: 'C/2023 A3' }]),
        photo(['Seestar'], [{ categoryId: 'cat-comet', name: 'C/2023 A3' }]),
        photo([], [{ categoryId: 'cat-comet', name: '12P' }]),
      ],
    };
    const display = useDisplayStore();
    const w = mount(SkyDisplaySheet, {
      props: { open: true, layer: layer as never },
      global: { stubs: ionicStubs },
    });
    const sheet = (title: string) =>
      w.findAllComponents(SkyCheckSheet).find((c) => c.props('title') === title)!;

    await buttonNamed(w, "Points d'intérêt : 2 sur 2").trigger('click');
    const pois = sheet("Points d'intérêt");
    expect(pois.props('open')).toBe(true);
    const group = pois.props('groups')![0];
    expect(group.options.map((o) => [o.label, o.sub])).toEqual([
      ['12P', '1 photo'],
      ['C/2023 A3', '2 photos'],
    ]);
    pois.vm.$emit('update:selected', [group.options[1].value]);
    expect(display.visiblePois[group.options[0].value]).toBe(false);
    expect(display.visiblePois[group.options[1].value]).toBe(true);

    await buttonNamed(w, 'Étiquettes : 2 sur 2').trigger('click');
    const labels = sheet('Étiquettes');
    expect(labels.props('open')).toBe(true);
    expect(labels.props('options').map((o) => [o.label, o.sub])).toEqual([
      ['(sans étiquette)', '1 photo'],
      ['Seestar', '2 photos'],
    ]);
    labels.vm.$emit('update:selected', ['Seestar']);
    expect(display.visibleLabels['(no label)']).toBe(false);
    expect(display.visibleLabels['Seestar']).not.toBe(false);
  });

  it('lists the sections of the board in order', () => {
    const headers = mountSheet()
      .findAll('.mob-section-header')
      .map((h) => h.text());
    expect(headers).toEqual([
      'Photos',
      'Étoiles et constellations',
      'Objets du ciel profond',
      'Carte',
      'Performances',
    ]);
  });

  it('applies a switch at once through the display store', () => {
    const w = mountSheet();
    const display = useDisplayStore();
    const before = display.showStars;
    toggle(w, 'Afficher les étoiles').vm.$emit('update:modelValue', !before);
    expect(display.showStars).toBe(!before);
    toggle(w, 'Grille RA/Déc').vm.$emit('update:modelValue', true);
    expect(display.showGrid).toBe(true);
  });

  it('applies the sliders at once: latitude, opacities and the density curve', () => {
    const w = mountSheet();
    const display = useDisplayStore();
    slider(w, 'Latitude (°)').vm.$emit('update:modelValue', 60);
    expect(display.borderLatDeg).toBe(60);
    slider(w, 'Opacité ciel').vm.$emit('update:modelValue', 0.4);
    expect(display.skyOpacity).toBe(0.4);
    display.setAutoDSODensity(false);
    slider(w, 'Densité de DSO').vm.$emit('update:modelValue', 500);
    expect(display.maxDSOCount).toBeGreaterThan(0);
  });

  it('shows the counts of types and catalogues, and the current choices', () => {
    const w = mountSheet();
    const text = w.text();
    expect(text).toContain('Types');
    expect(text).toContain('13 / 13');
    expect(text).toContain('Occidental classique');
    expect(text).toContain('Nord');
    expect(text).toContain('Stéréo');
  });

  it('turns the automatic density on and off, and disables its slider while on', () => {
    const w = mountSheet();
    const display = useDisplayStore();
    display.setAutoStarDensity(true);
    expect(slider(w, "Densité d'étoiles").props('disabled')).toBe(true);
    toggle(w, 'Auto').vm.$emit('update:modelValue', false);
  });

  const sheetTitled = (
    w: ReturnType<typeof mount>,
    kind: typeof SkyCheckSheet | typeof PhoneRadioSheet,
    title: string,
  ) => w.findAllComponents(kind).find((c) => c.props()['title' as never] === title)!;
  const field = (w: ReturnType<typeof mount>, label: string) =>
    w.findAll('button').find((b) => b.attributes('aria-label')?.startsWith(label))!;

  it('opens a tick-box sheet from the types and catalogues fields, and keeps each change at once', async () => {
    const w = mountSheet();
    const display = useDisplayStore();
    const types = sheetTitled(w, SkyCheckSheet, 'Types');
    expect(types.props()['open' as never]).toBe(false);
    await field(w, 'Types').trigger('click');
    expect(types.props()['open' as never]).toBe(true);
    types.vm.$emit('update:selected', ['Gx', 'OC']);
    expect(display.dsoTypes).toEqual(['Gx', 'OC']);
    await field(w, 'Catalogues').trigger('click');
    expect(sheetTitled(w, SkyCheckSheet, 'Catalogues').props()['open' as never]).toBe(true);
    expect(types.props()['open' as never]).toBe(false);
    sheetTitled(w, SkyCheckSheet, 'Catalogues').vm.$emit('update:selected', ['M']);
    expect(display.dsoCatalogs).toEqual(['M']);
  });

  it('opens a radio sheet from the style, hemisphere and projection fields', async () => {
    const w = mountSheet();
    const display = useDisplayStore();
    await field(w, 'Hémisphère').trigger('click');
    const hemisphere = sheetTitled(w, PhoneRadioSheet, 'Hémisphère');
    expect(hemisphere.props()['open' as never]).toBe(true);
    hemisphere.vm.$emit('update:value', 'south');
    expect(display.hemisphere).toBe('south');
    const fisheye = useFisheyeStore();
    sheetTitled(w, PhoneRadioSheet, 'Projection').vm.$emit('update:value', 'fisheye');
    expect(fisheye.active).toBe(true);
    sheetTitled(w, PhoneRadioSheet, 'Style de tracé').vm.$emit('update:value', 'rey');
    await Promise.resolve();
    expect(display.constellationStyle).toBe('rey');
  });
});
