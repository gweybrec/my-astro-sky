import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Component } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { setDsoCatalog } from '@myastrosky/core/catalog/dso-registry';
import { ionicStubs } from './helpers';

// The board "Réglages, statistiques, un catalogue": all / the missing / the photographed objects of one catalogue, by
// constellation in folds, the "Photographié" badge, the constellations and sort sheets, the search, and the map button.
const { catalogsReady, getPhotos, showTarget } = vi.hoisted(() => ({
  catalogsReady: vi.fn(() => Promise.resolve()),
  getPhotos: vi.fn(),
  showTarget: vi.fn(async () => {}),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady }));
vi.mock('@myastrosky/app-state/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPhotos,
}));
const back = vi.fn();
vi.mock('../src/composables/useShowTargetOnMap', () => ({
  useShowTargetOnMap: (pages: unknown) => {
    back(pages);
    return showTarget;
  },
}));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));
vi.mock('@myastrosky/core/catalog/star-registry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConstellationInfos: () =>
    [
      ['Cyg', 'Cygne'],
      ['Ori', 'Orion'],
    ].map(([id, displayName]) => ({ id, name: id, displayName, ra: 0, dec: 0 })),
}));

import StatisticsCatalogPage from '../src/pages/StatisticsCatalogPage.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import PhoneObjectRow from '../src/components/PhoneObjectRow.vue';
import PhoneSearch from '../src/components/PhoneSearch.vue';
import SkyCheckSheet from '../src/pages/sky/SkyCheckSheet.vue';
import { statisticsConstellations } from '../src/composables/useStatisticsFilter';

const FIELDS = ['id', 'ra', 'dec', 'type', 'mag', 'nameFr', 'catalogs', 'constellation', 'rating'];
const DATA = [
  ['NGC7000', 314.7, 44.3, 'EN', 4.0, "Nébuleuse de l'Amérique du Nord", ['NGC7000'], 'Cyg', 5],
  ['NGC6960', 311.4, 30.7, 'SNR', 7.0, 'Petite Dentelle du Cygne', ['NGC6960'], 'Cyg', 5],
  ['NGC6914', 307.8, 42.5, 'RN', 11.0, null, ['NGC6914'], 'Cyg', 4],
  ['M42', 83.8, -5.4, 'EN', 4.0, "Nébuleuse d'Orion", ['M42', 'NGC1976'], 'Ori', 5],
];

beforeAll(() => {
  setDsoCatalog({ fields: FIELDS, data: DATA } as never, {}, 'fr');
});

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  vi.clearAllMocks();
  statisticsConstellations.value = null;
  getPhotos.mockResolvedValue([
    { id: 'p1', dsoIds: ['NGC7000'] },
    { id: 'p2', dsoIds: ['M42'] },
  ]);
});

async function open(catalog = 'NGC') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/statistics/:catalog', component: StatisticsCatalogPage },
      { path: '/:p(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push(`/settings/statistics/${catalog}`);
  await router.isReady();
  const w = mount(StatisticsCatalogPage, {
    global: { stubs: ionicStubs, plugins: [router, createPinia()] },
  });
  await flushPromises();
  return w;
}

const folds = (w: Awaited<ReturnType<typeof open>>) => w.findAll('.mob-row[aria-expanded]');
const designations = (w: Awaited<ReturnType<typeof open>>) =>
  w.findAllComponents(PhoneObjectRow).map((r) => r.props('designation'));

describe('the page of a catalogue', () => {
  it('names the catalogue with its photographed / total count, on all the objects by constellation', async () => {
    const w = await open();
    expect(w.find('h1').text()).toBe('NGC');
    expect(w.find('.stats-catalog-count').text()).toBe('2 / 4');
    expect(folds(w).map((f) => f.text().replace(/\s+/g, ' '))).toEqual([
      'Cygne1 / 3',
      'Orion1 / 1',
    ]);
    expect(folds(w)[0].attributes('aria-expanded')).toBe('false');
    expect(designations(w)).toEqual([]);
  });

  it('opens a fold of the missing objects, sorted by photographic interest then brightness', async () => {
    const w = await open();
    await w.findAll('.mob-seg-btn')[0].trigger('click');
    await folds(w)[0].trigger('click');
    expect(folds(w)[0].attributes('aria-expanded')).toBe('true');
    expect(designations(w)).toEqual(['NGC 6960', 'NGC 6914']);
    const first = w.findAllComponents(PhoneObjectRow)[0];
    expect(first.props()).toMatchObject({
      name: 'Petite Dentelle du Cygne',
      photographed: false,
      magnitude: 'Mag 7.0',
      rating: '★★★★★',
    });
  });

  it('shows all objects, the photographed ones with the badge, an alias under its designation here', async () => {
    const w = await open();
    for (const f of folds(w)) await f.trigger('click');
    expect(designations(w)).toEqual(['NGC 7000', 'NGC 6960', 'NGC 6914', 'NGC 1976']);
    expect(w.findAll('.mob-badge--success').map((b) => b.text())).toEqual([
      'Photographié',
      'Photographié',
    ]);
  });

  it('sorts by number in the catalogue from the sort sheet', async () => {
    const w = await open();
    await w.findAll('.mob-seg-btn')[0].trigger('click');
    w.getComponent(PhoneRadioSheet as Component).vm.$emit('update:value', 'number');
    await flushPromises();
    await folds(w)[0].trigger('click');
    expect(designations(w)).toEqual(['NGC 6914', 'NGC 6960']);
  });

  it('opens every fold while searching, and says when nothing matches', async () => {
    const w = await open();
    w.findComponent(PhoneSearch).vm.$emit('update:modelValue', 'ngc 1976');
    await flushPromises();
    expect(designations(w)).toEqual(['NGC 1976']);
    w.findComponent(PhoneSearch).vm.$emit('update:modelValue', 'rien de tel');
    await flushPromises();
    expect(w.text()).toContain('Aucun objet à afficher.');
  });

  it('keeps the constellations chosen on the statistics page', async () => {
    statisticsConstellations.value = ['Ori'];
    const w = await open();
    expect(w.find('.stats-catalog-count').text()).toBe('1 / 1');
    expect(folds(w).map((f) => f.text().replace(/\s+/g, ' '))).toEqual(['Orion1 / 1']);
  });

  it('changes the constellations here, for the statistics page too', async () => {
    const w = await open();
    const button = () => w.findAll('.stats-catalog-filters > *')[0];
    expect(button().text()).toBe('2 constellations');
    await button().trigger('click');
    const sheet = w.getComponent(SkyCheckSheet);
    expect(sheet.props('open')).toBe(true);
    expect(sheet.props('options').map((o: { label: string }) => o.label)).toEqual([
      'Cygne',
      'Orion',
    ]);
    sheet.vm.$emit('update:selected', ['Ori']);
    await flushPromises();
    expect(statisticsConstellations.value).toEqual(['Ori']);
    expect(button().text()).toBe('1 constellation');
    expect(w.find('.stats-catalog-count').text()).toBe('1 / 1');
    expect(folds(w).map((f) => f.text().replace(/\s+/g, ' '))).toEqual(['Orion1 / 1']);
    sheet.vm.$emit('update:selected', ['Cyg', 'Ori']);
    await flushPromises();
    expect(statisticsConstellations.value).toBeNull();
  });

  it('shows the order on its button in its short name, after the sort icon, and no information button', async () => {
    const w = await open();
    const sortButton = () => w.findAll('.stats-catalog-filters > *')[1];
    expect(sortButton().text()).toBe('Intérêt photo');
    expect(sortButton().attributes('aria-label')).toContain('Intérêt photo');
    await sortButton().trigger('click');
    expect((w.getComponent(PhoneRadioSheet as Component).props() as { open: boolean }).open).toBe(
      true,
    );
    w.getComponent(PhoneRadioSheet as Component).vm.$emit('update:value', 'number');
    await flushPromises();
    expect(sortButton().text()).toBe('Numéro');
    expect(w.findComponent({ name: 'PhoneInfoButton' }).exists()).toBe(false);
  });

  it("shows an object on the map, coming back to the catalogue's page", async () => {
    const w = await open();
    await w.findAll('.mob-seg-btn')[0].trigger('click');
    await folds(w)[0].trigger('click');
    w.findAllComponents(PhoneObjectRow)[0].vm.$emit('map');
    await flushPromises();
    expect(showTarget).toHaveBeenCalledWith(expect.objectContaining({ id: 'NGC6960' }), null);
    expect(back).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'settings',
        pages: ['/settings/statistics'],
        page: '/settings/statistics/NGC',
      }),
    );
  });
});
