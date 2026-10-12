import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { writeObserverLocation } from '@myastrosky/core/observer-location';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { ionicStubs } from './helpers';

vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));

import SkyLayerButtons from '../src/pages/sky/SkyLayerButtons.vue';
import SkyDisplaySheet from '../src/pages/sky/SkyDisplaySheet.vue';
import PhoneToggleRow from '../src/components/PhoneToggleRow.vue';
import PhoneSliderRow from '../src/components/PhoneSliderRow.vue';
import SkyCheckSheet from '../src/pages/sky/SkyCheckSheet.vue';
import SkyRadioSheet from '../src/pages/sky/SkyRadioSheet.vue';
import { useFisheyeStore } from '@myastrosky/app-state/stores/fisheye';

/** The map's layer buttons and display sheet, driving the shared stores. */

const buttonNamed = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the layer buttons ("Ciel, calques de la carte")', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  const mountButtons = () => mount(SkyLayerButtons, { global: { stubs: ionicStubs } });

  it('shows the seven toggles of the map, in the board order', () => {
    const labels = mountButtons()
      .findAll('button')
      .map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Ciel local (vue horizon)',
      'Grille azimutale (alt-az)',
      "Trajectoire de l'objet sélectionné",
      "Afficher/masquer l'horizon du relief",
      'Afficher/masquer la Lune',
      'Afficher/masquer le Soleil',
      'Afficher/masquer les planètes',
    ]);
  });

  it('toggles the moon, the sun, the planets and the azimuth grid in the sky-time store', async () => {
    const w = mountButtons();
    const time = useSkyTimeStore();
    for (const [name, key] of [
      ['Afficher/masquer la Lune', 'showMoon'],
      ['Afficher/masquer le Soleil', 'showSun'],
      ['Afficher/masquer les planètes', 'showPlanets'],
      ['Grille azimutale (alt-az)', 'showAzimuthGrid'],
    ] as const) {
      expect(time[key]).toBe(false);
      await buttonNamed(w, name).trigger('click');
      expect(time[key]).toBe(true);
      expect(buttonNamed(w, name).attributes('aria-pressed')).toBe('true');
    }
  });

  it('draws the local sky unavailable without a location, with its reason, and ignores the tap', async () => {
    const w = mountButtons();
    const button = buttonNamed(w, 'Ciel local (vue horizon)');
    expect(button.attributes('aria-disabled')).toBe('true');
    await button.trigger('click');
    expect(useSkyTimeStore().localSkyMode).toBe(false);
  });

  it('turns the local sky on once there is a location and the map shows a date', async () => {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    const time = useSkyTimeStore();
    time.setMode('date');
    const w = mountButtons();
    const button = buttonNamed(w, 'Ciel local (vue horizon)');
    expect(button.attributes('aria-disabled')).toBeUndefined();
    await button.trigger('click');
    expect(time.localSkyMode).toBe(true);
  });

  it('keeps the trajectory unavailable until the local sky is on', async () => {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    const time = useSkyTimeStore();
    time.setMode('date');
    const w = mountButtons();
    const trajectory = buttonNamed(w, "Trajectoire de l'objet sélectionné");
    expect(trajectory.attributes('aria-disabled')).toBe('true');
    time.setLocalSkyMode(true);
    await w.vm.$nextTick();
    expect(trajectory.attributes('aria-disabled')).toBeUndefined();
  });

  it('keeps the relief horizon unavailable until there is a profile', async () => {
    const w = mountButtons();
    const relief = buttonNamed(w, "Afficher/masquer l'horizon du relief");
    expect(relief.attributes('aria-disabled')).toBe('true');
    useHorizonProfileStore().applyProfile(
      { lat: 48, lon: 7, obsHeightM: null, azStepDeg: 1, alts: [1, 2, 3], summits: [] } as never,
      false,
    );
    await w.vm.$nextTick();
    expect(relief.attributes('aria-disabled')).toBeUndefined();
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
    kind: typeof SkyCheckSheet | typeof SkyRadioSheet,
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
    const hemisphere = sheetTitled(w, SkyRadioSheet, 'Hémisphère');
    expect(hemisphere.props()['open' as never]).toBe(true);
    hemisphere.vm.$emit('update:value', 'south');
    expect(display.hemisphere).toBe('south');
    const fisheye = useFisheyeStore();
    sheetTitled(w, SkyRadioSheet, 'Projection').vm.$emit('update:value', 'fisheye');
    expect(fisheye.active).toBe(true);
    sheetTitled(w, SkyRadioSheet, 'Style de tracé').vm.$emit('update:value', 'rey');
    await Promise.resolve();
    expect(display.constellationStyle).toBe('rey');
  });
});
