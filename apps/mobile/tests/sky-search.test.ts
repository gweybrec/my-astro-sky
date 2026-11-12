import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { UnifiedSearchResult } from '@myastrosky/core/search';
import type { DSO } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
const getPhotos = vi.fn();
vi.mock('@myastrosky/app-state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/app-state/api')>()),
  getPhotos: (...a: unknown[]) => getPhotos(...a),
  getPoiCategories: () => Promise.resolve([]),
  getGearSetups: () => Promise.resolve([]),
}));
vi.mock('@myastrosky/core/gear-catalog', () => ({
  getTelescopes: () => Promise.resolve([]),
  getCameras: () => Promise.resolve([]),
  getAccessories: () => Promise.resolve([]),
}));
// The setup chosen in Cibles: a refractor of 400 mm on an APS-C sensor, or none.
const preset = vi.fn();
vi.mock('@myastrosky/core/targets/plan-setup', () => ({
  presetForSetupId: () => preset(),
}));
const searchUnified = vi.fn();
vi.mock('@myastrosky/core/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/search')>()),
  searchUnified: (...a: unknown[]) => searchUnified(...a),
}));

import SkySearchPage from '../src/pages/SkySearchPage.vue';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import type { GearPreset } from '@myastrosky/core/gear-presets';
import {
  clearSkySelection,
  skyFocus,
  skyPhotoFocus,
  skySelection,
} from '../src/composables/useSkySelection';
import type { Photo } from '@myastrosky/core/types';

/** "Ciel, recherche": the search page and the selection it hands to the map. */

const M31 = {
  id: 'M31',
  catalogs: ['M31', 'NGC224'],
  displayName: "Galaxie d'Andromède",
  type: 'GxS',
  constellation: 'And',
  mag: 3.4,
  majAxis: 190,
  rating: 5,
  ra: 10.68,
  dec: 41.27,
} as unknown as DSO;
const REFRACTOR: GearPreset = {
  apertureMm: 80,
  focalLengthMm: 400,
  sensorWidthMm: 23.5,
  sensorHeightMm: 15.6,
  pixelSizeUm: 3.76,
  mono: false,
  builtIn: false,
} as GearPreset;
const M32 = {
  id: 'M32',
  catalogs: ['M32', 'NGC221', 'Arp 168'],
  displayName: "Galaxie satellite d'Andromède",
  type: 'GxE',
  constellation: 'And',
  mag: 8.1,
  ra: 10.67,
  dec: 40.87,
} as unknown as DSO;
const VEGA = {
  hip: 91262,
  name: 'Vega',
  bayer: 'α',
  constellation: 'Lyr',
  ra: 279.23,
  dec: 38.78,
  mag: 0.03,
  bv: 0,
  label: 'Vega (α Lyr)',
  score: 100,
};

const results: UnifiedSearchResult[] = [
  { type: 'dso', label: 'M31', score: 90, mag: 3.4, ra: M31.ra, dec: M31.dec, dso: M31 },
  { type: 'dso', label: 'M32', score: 80, mag: 8.1, ra: M32.ra, dec: M32.dec, dso: M32 },
  { type: 'star', label: VEGA.label, score: 70, mag: 0.03, ra: VEGA.ra, dec: VEGA.dec, star: VEGA },
];

function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  const back = vi.spyOn(router, 'back');
  const pinia = createPinia();
  const wrapper = mount(SkySearchPage, {
    global: { stubs: ionicStubs, plugins: [router, pinia] },
  });
  return { wrapper, back, time: useSkyTimeStore(pinia) };
}

const type = async (wrapper: ReturnType<typeof mount>, text: string) => {
  await wrapper.find('input[type=search]').setValue(text);
  await vi.advanceTimersByTimeAsync(300);
  await flushPromises();
};

describe('the search page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('lang', 'fr');
    vi.useFakeTimers();
    searchUnified.mockReset().mockResolvedValue(results);
    preset.mockReset().mockReturnValue(REFRACTOR);
    getPhotos.mockReset().mockResolvedValue(photos);
    clearSkySelection();
    skyFocus.value = null;
    skyPhotoFocus.value = null;
  });
  afterEach(() => vi.useRealTimers());

  it('lists nothing before something is typed, and searches once typing pauses', async () => {
    const { wrapper } = mountPage();
    expect(wrapper.findAll('.mob-row--roomy')).toHaveLength(0);
    await wrapper.find('input[type=search]').setValue('andro');
    expect(searchUnified).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(searchUnified).toHaveBeenCalledWith('andro');
    expect(wrapper.findAll('.mob-row--roomy')).toHaveLength(3);
  });

  it('writes a deep-sky result as the board does: name and rating, designation, type, constellation, figures', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'andro');
    const [m31, m32] = wrapper.findAll('.mob-row--roomy');
    expect(m31.find('.mob-row-title').text()).toBe("Galaxie d'Andromède");
    expect(m31.find('.mob-target-head .mob-rating').text()).toBe('★★★★★');
    expect(m31.find('.mob-meta').text()).toContain('M31');
    expect(m31.find('.mob-meta').text()).not.toContain('NGC224');
    expect(m31.find('.mob-badge--type').text()).toBe('Galaxie spirale');
    expect(m31.find('.mob-badge--const').text()).toBe('AND');
    const labels = m31.findAll('.mob-fact-label').map((l) => l.text());
    const values = m31.findAll('.mob-fact-value').map((v) => v.text());
    expect(labels).toEqual(['Mag', 'Taille', 'Champ']);
    expect(values.slice(0, 2)).toEqual(['3.4', '3.2°']);
    expect(values[2]).toMatch(/^\d+ %$/);
    expect(m32.find('.mob-meta').text()).toContain('M32');
    expect(m32.find('.mob-target-head .mob-rating').exists()).toBe(false);
  });

  it('follows the main designation with the one searched when it is another', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'NGC22');
    const [m31, m32] = wrapper.findAll('.mob-row--roomy');
    expect(m31.find('.mob-meta > span').text()).toBe('M31 · NGC224');
    expect(m32.find('.mob-meta > span').text()).toBe('M32 · NGC221');
  });

  it('adds the highest point and the score with the sky of the day on and a location', async () => {
    const { wrapper, time } = mountPage();
    time.lat = 48.85;
    time.lon = 2.35;
    time.simDate = new Date('2026-10-15T20:00:00Z');
    time.mode = 'date';
    await type(wrapper, 'andro');
    const m31 = wrapper.findAll('.mob-row--roomy')[0];
    expect(m31.findAll('.mob-fact-label').map((l) => l.text())).toEqual([
      'Au plus haut',
      'Mag',
      'Taille',
      'Score',
      'Champ',
    ]);
    expect(m31.findAll('.mob-fact-value')[0].text()).toMatch(/^\d\d:\d\d \(\d+°\)$/);
  });

  it('leaves the score and the field out without a setup', async () => {
    preset.mockReturnValue(null);
    const { wrapper } = mountPage();
    await type(wrapper, 'andro');
    const m31 = wrapper.findAll('.mob-row--roomy')[0];
    expect(m31.findAll('.mob-fact-label').map((l) => l.text())).toEqual(['Mag', 'Taille']);
  });

  it('writes a star result with its name, designation and constellation, without a type badge', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'vega');
    const vega = wrapper.findAll('.mob-row--roomy')[2];
    expect(vega.find('.mob-row-title').text()).toBe('Vega');
    expect(vega.find('.mob-meta').text()).toContain('α Lyr');
    expect(vega.find('.mob-badge--type').exists()).toBe(false);
    expect(vega.find('.mob-badge--const').text()).toBe('LYR');
    expect(vega.text()).toContain('Magnitude 0.0');
    expect(vega.find('.mob-facts').exists()).toBe(false);
  });

  it('selects the tapped result, asks the map to go to it and goes back', async () => {
    const { wrapper, back } = mountPage();
    await type(wrapper, 'andro');
    await wrapper.findAll('.mob-row--roomy')[0].trigger('click');
    expect(skySelection.value).toEqual({ kind: 'dso', dso: M31 });
    expect(skyFocus.value).toEqual({ ra: M31.ra, dec: M31.dec, scale: 1200 });
    expect(back).toHaveBeenCalled();
  });

  it('selects a star and goes back when Annuler is not used', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'vega');
    await wrapper.findAll('.mob-row--roomy')[2].trigger('click');
    expect(skySelection.value).toEqual({ kind: 'star', star: VEGA });
    expect(skyFocus.value?.scale).toBe(800);
  });

  it('Annuler goes back without selecting anything', async () => {
    const { wrapper, back } = mountPage();
    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Annuler')!;
    await cancel.trigger('click');
    expect(back).toHaveBeenCalled();
    expect(skySelection.value).toBeNull();
  });

  it('clears the list when the field is emptied', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'andro');
    await wrapper.find('input[type=search]').setValue('');
    await flushPromises();
    expect(wrapper.findAll('.mob-row--roomy')).toHaveLength(0);
  });

  it('opens on the Ciel tab, with the Photos tab beside it', async () => {
    const { wrapper } = mountPage();
    await type(wrapper, 'andro');
    const tabs = wrapper.findAll('.mob-seg-btn');
    expect(tabs.map((b) => b.text())).toEqual(['Ciel', 'Photos']);
    expect(tabs[0].attributes('aria-checked')).toBe('true');
    expect(wrapper.findAll('.mob-row--roomy')).toHaveLength(3);
  });
});

/** Placed photos (two star correspondences or a manual placement) and one waiting to be placed. */
const placedAt = { correspondences: [{}, {}] as Photo['correspondences'] };
const photo = (id: string, over: Partial<Photo>): Photo =>
  ({
    id,
    originalName: `${id}.jpg`,
    notes: '',
    labels: [],
    dsoIds: [],
    pointsOfInterest: [],
    correspondences: [],
    ...over,
  }) as Photo;
const photos: Photo[] = [
  photo('Orion_wide', { ...placedAt, dsoIds: ['NGC1977', 'M42', 'M43'] }),
  photo('M42_stack', { ...placedAt, dsoIds: ['M42'], labels: ['M42 HaRGB'] }),
  photo('M31_mosaic', { ...placedAt, dsoIds: ['M31'] }),
  photo('M42_waiting', { dsoIds: ['M42'] }),
];

describe('the search page, Photos tab', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('lang', 'fr');
    vi.useFakeTimers();
    searchUnified.mockReset().mockResolvedValue(results);
    preset.mockReset().mockReturnValue(REFRACTOR);
    getPhotos.mockReset().mockResolvedValue(photos);
    clearSkySelection();
    skyPhotoFocus.value = null;
  });
  afterEach(() => vi.useRealTimers());

  const photosTab = async (wrapper: ReturnType<typeof mount>, text: string) => {
    await flushPromises();
    await wrapper.findAll('.mob-seg-btn')[1].trigger('click');
    await type(wrapper, text);
  };
  const names = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.mob-row-title').map((t) => t.text());

  it('lists the placed photos that match, in the desktop order, without the waiting ones', async () => {
    const { wrapper } = mountPage();
    await photosTab(wrapper, 'm42');
    expect(names(wrapper)).toEqual(['M42_stack.jpg', 'Orion_wide.jpg']);
  });

  it('shows the chips of what matched only', async () => {
    const { wrapper } = mountPage();
    await photosTab(wrapper, 'm42');
    const chips = (n: number) =>
      wrapper
        .findAll('.mob-row--roomy')
        [n].findAll('.mob-tag-text')
        .map((c) => c.text());
    expect(chips(0)).toEqual(['M42 HaRGB', 'M42']);
    expect(chips(1)).toEqual(['M42']);
  });

  it('says so when no photo matches', async () => {
    const { wrapper } = mountPage();
    await photosTab(wrapper, 'xyz');
    expect(wrapper.find('.mob-empty-text').text()).toBe('Aucune photo correspondante');
  });

  it('keeps the Photos tab while the query changes', async () => {
    const { wrapper } = mountPage();
    await photosTab(wrapper, 'm42');
    await type(wrapper, 'm31');
    expect(names(wrapper)).toEqual(['M31_mosaic.jpg']);
    expect(wrapper.findAll('.mob-seg-btn')[1].attributes('aria-checked')).toBe('true');
  });

  it('selects the tapped photo, asks the map to frame it and goes back', async () => {
    const { wrapper, back } = mountPage();
    await photosTab(wrapper, 'm31');
    await wrapper.findAll('.mob-row--roomy')[0].trigger('click');
    expect(skySelection.value).toEqual({ kind: 'photo', photo: photos[2] });
    expect(skyPhotoFocus.value).toBe('M31_mosaic');
    expect(back).toHaveBeenCalled();
  });
});
