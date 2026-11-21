/**
 * Tests for StatisticsCatalog.vue: one catalogue of the statistics page — which objects are shown (all by
 * default, missing, photographed), the constellations, the search, the constellation folds with their counts,
 * the "Photographié" chip, the sort, and "Voir sur la carte".
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import StatisticsCatalog from '../../src/components/modals/StatisticsCatalog.vue';
import { setDsoCatalog } from '@myastrosky/core/catalog/dso-registry';
import { setConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import { t } from '@myastrosky/core/i18n/index';

const FIELDS = ['id', 'ra', 'dec', 'type', 'mag', 'nameEn', 'catalogs', 'constellation', 'rating'];
// [id, ra, dec, type, mag, name, catalogs, constellation, rating]
const DATA = [
  ['NGC7000', 314.7, 44.3, 'EN', 4.0, 'North America Nebula', ['NGC7000'], 'Cyg', 5],
  ['NGC6960', 311.4, 30.7, 'SNR', 7.0, 'Western Veil', ['NGC6960'], 'Cyg', 5],
  ['NGC6914', 307.8, 42.5, 'RN', 11.0, null, ['NGC6914'], 'Cyg', 4],
  ['M42', 83.8, -5.4, 'EN', 4.0, 'Orion Nebula', ['M42', 'NGC1976'], 'Ori', 5],
  ['IC434', 85.2, -2.5, 'EN', null, 'Horsehead Nebula', ['IC434'], 'Ori', 5],
];

beforeAll(() => {
  setDsoCatalog({ fields: FIELDS, data: DATA } as never, {}, 'en');
  setConstellationInfos([
    { id: 'Cyg', name: 'Cygnus', displayName: 'Cygnus', ra: 0, dec: 0 },
    { id: 'Ori', name: 'Orion', displayName: 'Orion', ra: 0, dec: 0 },
  ]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

function mountNgc(
  photographed: string[] = ['NGC7000', 'M42'],
  constellations: string[] | null = null,
) {
  return mount(StatisticsCatalog, {
    props: {
      catalog: 'NGC',
      photographedIds: new Set(photographed),
      constellations,
      'onUpdate:constellations': () => {},
    },
    attachTo: document.body,
  });
}

const groupButtons = (w: ReturnType<typeof mountNgc>) => w.findAll('button[aria-expanded]');
const designations = (w: ReturnType<typeof mountNgc>) =>
  w.findAll('tbody tr td:first-child .text-bright').map((e) => e.text());

describe('StatisticsCatalog', () => {
  it('starts on all the objects, grouped by constellation with photographed / total', () => {
    const w = mountNgc();
    const groups = groupButtons(w);
    expect(groups.map((g) => g.text().replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('Cygnus'),
      expect.stringContaining('Orion'),
    ]);
    expect(groups[0].text()).toContain('1 / 3');
    expect(w.find('[role="radio"][aria-checked="true"]').text()).toContain(
      t('stats.catalog.showAll'),
    );
    // the filters carry their counts
    const filters = w.findAll('[role="radio"]').map((b) => b.text().replace(/\s+/g, ' '));
    expect(filters).toEqual([
      `${t('stats.catalog.showMissing')} 2`,
      `${t('stats.catalog.showPhotographed')} 2`,
      `${t('stats.catalog.showAll')} 4`,
    ]);
    w.unmount();
  });

  it('opens a fold, sorted by photographic interest then brightness', async () => {
    const w = mountNgc();
    await groupButtons(w)[0].trigger('click');
    expect(designations(w)).toEqual(['NGC 7000', 'NGC 6960', 'NGC 6914']);
    w.unmount();
  });

  it('shows the photographed ones with their chip, under their designation here', async () => {
    const w = mountNgc();
    for (const g of groupButtons(w)) await g.trigger('click');
    expect(designations(w)).toEqual(['NGC 7000', 'NGC 6960', 'NGC 6914', 'NGC 1976']);
    const chips = w.findAll('.bw-chip--ok').map((c) => c.text());
    expect(chips).toEqual([t('stats.catalog.photographed'), t('stats.catalog.photographed')]);
    w.unmount();
  });

  it('shows only the missing objects', async () => {
    const w = mountNgc();
    await w.findAll('[role="radio"]')[0].trigger('click');
    expect(groupButtons(w)).toHaveLength(1);
    await groupButtons(w)[0].trigger('click');
    expect(designations(w)).toEqual(['NGC 6960', 'NGC 6914']);
    w.unmount();
  });

  it('sorts by number in the catalogue, from a native dropdown', async () => {
    const w = mountNgc([]);
    await w.find('select#stats-catalog-sort').setValue('number');
    await groupButtons(w)[0].trigger('click');
    expect(designations(w)).toEqual(['NGC 6914', 'NGC 6960', 'NGC 7000']);
    w.unmount();
  });

  it('lists only the chosen constellations, which can be changed here', async () => {
    const w = mountNgc(undefined, ['Ori']);
    expect(groupButtons(w).map((g) => g.text())).toEqual([expect.stringContaining('Orion')]);
    expect(w.findComponent({ name: 'ConstellationSelector' }).exists()).toBe(true);
    await w.setProps({ constellations: ['Cyg'] });
    expect(groupButtons(w).map((g) => g.text())).toEqual([expect.stringContaining('Cygnus')]);
    w.unmount();
  });

  it('opens every fold while searching, and says when nothing matches', async () => {
    const w = mountNgc();
    await w.find('input[type="search"]').setValue('ngc 1976');
    expect(designations(w)).toEqual(['NGC 1976']);
    await w.findAll('[role="radio"]')[0].trigger('click');
    expect(designations(w)).toEqual([]);
    await w.find('input[type="search"]').setValue('nothing like this');
    expect(w.text()).toContain(t('stats.catalog.empty'));
    w.unmount();
  });

  it('asks for the map on the object', async () => {
    const w = mountNgc();
    await groupButtons(w)[0].trigger('click');
    await w.find('tbody .btn-icon').trigger('click');
    expect(w.emitted('showOnMap')?.[0]?.[0]).toMatchObject({ id: 'NGC7000' });
    w.unmount();
  });
});
