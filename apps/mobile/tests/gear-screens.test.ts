import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import {
  getHiddenGearIds,
  invalidateGearCache,
  setHiddenGearIds,
} from '@myastrosky/core/gear-catalog';
import { setBackend } from '@myastrosky/app-state/backend';
import { ionicStubs } from './helpers';

const showError = vi.fn();
const confirm = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
// Ionic calls a page's "will enter" each time it shows; here a test calls the last one again to come back to a page.
const enters: Array<() => unknown> = [];
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  onIonViewWillEnter: (fn: () => unknown) => {
    enters.push(fn);
    void fn();
  },
}));

import GearManagePage from '../src/pages/gear/GearManagePage.vue';
import GearAddPage from '../src/pages/gear/GearAddPage.vue';
import SetupEditPage from '../src/pages/SetupEditPage.vue';

/** "Équipement, gérer les …", "Équipement, ajouter …", and the pens of "Équipement, modifier le setup". */

const tel = (id: string, brand: string, model: string) => ({
  id,
  brand,
  model,
  aperture_mm: 72,
  focal_length_mm: 400,
  f_ratio: 5.6,
  is_smart_telescope: false,
  integrated_camera_id: null,
});
let gear: Record<string, object[]>;

const backend = {
  gear: {
    listSetups: vi.fn(),
    createSetup: vi.fn(),
    replaceSetup: vi.fn(),
    removeSetup: vi.fn(),
    addCustom: vi.fn(),
    removeCustom: vi.fn(),
  },
  plans: { list: vi.fn() },
};

function app(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/gear/:type', component: { template: '<div />' } },
      { path: '/settings/gear/:type/new', component: { template: '<div />' } },
      { path: '/settings/setups/:id', component: { template: '<div />' } },
      { path: '/:p(.*)*', component: { template: '<div />' } },
    ],
  });
  return {
    router,
    ready: router.push('/settings/setups').then(() => router.push(path)),
    global: { stubs: ionicStubs, plugins: [router, createPinia()] },
  };
}

async function open(component: object, path: string) {
  const a = app(path);
  await a.ready;
  const w = mount(component, { global: a.global });
  await flushPromises();
  return { w, router: a.router };
}

const boxes = (w: ReturnType<typeof mount>) => w.findAll('[role="checkbox"]');
const button = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('button').find((b) => b.text() === text || b.attributes('aria-label') === text)!;

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  gear = {
    telescope: [
      tel('custom-1', 'GSO', 'Newton 200/800'),
      tel('t1', 'Askar', 'FRA400'),
      tel('t2', 'Celestron', 'C8'),
    ],
    camera: [
      { id: 'c1', brand: 'ZWO', model: 'ASI533MC', sensor_width_mm: 11.3, sensor_height_mm: 11.3 },
      {
        id: 'c2',
        brand: 'ZWO',
        model: 'ASI2600MC Pro',
        sensor_width_mm: 23.5,
        sensor_height_mm: 15.7,
      },
    ],
    accessory: [],
    filter: [
      {
        id: 'f1',
        brand: 'Antlia',
        model: 'Ha',
        astrobin_name: 'Antlia 3nm H-Alpha Pro',
        subtype: 'Ha',
        center_nm: 656.3,
        fwhm_nm: 3,
        color: '#b42828',
      },
    ],
  };
  for (const k of ['telescope', 'camera', 'accessory', 'filter'] as const) invalidateGearCache(k);
  configureGearCatalogLoader(async (type) => [...gear[type]]);
  vi.clearAllMocks();
  enters.length = 0;
  backend.gear.listSetups.mockResolvedValue([
    {
      id: 's1',
      name: 'Lunette',
      telescopeId: 't1',
      cameraId: 'c1',
      accessoryId: null,
      enabled: true,
    },
  ]);
  backend.plans.list.mockResolvedValue([]);
  backend.gear.addCustom.mockResolvedValue({ id: 'custom-9' });
  backend.gear.removeCustom.mockResolvedValue(undefined);
  setBackend(backend as never);
});

describe('the gear list', () => {
  it('lists every telescope with its line, the count, and the add row', async () => {
    setHiddenGearIds('telescope', new Set(['t2']));
    const { w } = await open(GearManagePage, '/settings/gear/telescope');
    expect(w.find('h1').text()).toBe('Télescopes');
    expect(w.text()).toContain('2/3 télescopes sélectionnés');
    expect(w.text()).toContain('Ajouter un télescope');
    expect(w.text()).toContain('Ouverture 72 mm · Focale 400 mm · f/5.6');
    expect(boxes(w).map((b) => b.attributes('aria-checked'))).toEqual(['true', 'true', 'false']);
  });

  it('stores a tick at once', async () => {
    const { w } = await open(GearManagePage, '/settings/gear/telescope');
    await boxes(w)[1].trigger('click');
    expect([...getHiddenGearIds('telescope')]).toEqual(['t1']);
    expect(w.text()).toContain('2/3 télescopes sélectionnés');
  });

  it('keeps one telescope: with none ticked it says so in red and keeps the last selection', async () => {
    const { w } = await open(GearManagePage, '/settings/gear/telescope');
    for (const i of [0, 1, 2]) await boxes(w)[i].trigger('click');
    expect(w.text()).toContain('0/3 télescopes sélectionnés. Au moins 1 doit être sélectionné');
    expect(w.find('.mob-helper').classes()).toContain('mob-status--danger');
    expect([...getHiddenGearIds('telescope')].sort()).toEqual(['custom-1', 't1']);
  });

  it('lets an accessory list have none ticked', async () => {
    gear.accessory = [{ id: 'a1', brand: 'Celestron', model: 'Reducer' }];
    const { w } = await open(GearManagePage, '/settings/gear/accessory');
    await boxes(w)[0].trigger('click');
    expect([...getHiddenGearIds('accessory')]).toEqual(['a1']);
    expect(w.text()).not.toContain('Au moins 1');
  });

  it('finds by name', async () => {
    const { w } = await open(GearManagePage, '/settings/gear/telescope');
    await w.find('input[type="search"]').setValue('c8');
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].text()).toContain('Celestron C8');
  });

  it('deletes the user’s own item after a yes, without ticking it', async () => {
    const { w } = await open(GearManagePage, '/settings/gear/telescope');
    expect(w.findAll('.mob-icon-btn--danger')).toHaveLength(1);
    confirm.mockResolvedValueOnce(false);
    await button(w, 'Supprimer « GSO Newton 200/800 »').trigger('click');
    await flushPromises();
    expect(backend.gear.removeCustom).not.toHaveBeenCalled();
    expect(getHiddenGearIds('telescope').size).toBe(0);
    confirm.mockResolvedValueOnce(true);
    gear.telescope = gear.telescope.slice(1);
    await button(w, 'Supprimer « GSO Newton 200/800 »').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Supprimer « GSO Newton 200/800 » ?', destructive: true }),
    );
    expect(backend.gear.removeCustom).toHaveBeenCalledWith('custom-1');
    expect(w.text()).not.toContain('GSO');
  });

  it('shows a filter with its colour and band', async () => {
    const { w } = await open(GearManagePage, '/settings/gear/filter');
    expect(w.find('h1').text()).toBe('Filtres');
    expect(w.text()).toContain('Antlia 3nm H-Alpha Pro');
    expect(w.text()).toContain('Ha · 656.3nm / 3nm');
    expect(w.find('.mob-swatch').attributes('style')).toContain('background');
  });

  it('opens the add page', async () => {
    const { w, router } = await open(GearManagePage, '/settings/gear/camera');
    await w
      .findAll('.mob-row')
      .find((r) => r.text() === 'Ajouter une caméra')!
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/gear/camera/new');
  });
});

describe('the add page', () => {
  it('saves a telescope once its required fields are filled', async () => {
    const { w } = await open(GearAddPage, '/settings/gear/telescope/new');
    expect(w.find('h1').text()).toBe('Ajouter un télescope');
    const save = () => button(w, 'Enregistrer');
    expect(save().attributes('disabled')).toBeDefined();
    const inputs = w.findAll('input');
    await inputs[0].setValue('GSO');
    await inputs[1].setValue('Newton 200/800');
    await inputs[2].setValue('200');
    expect(save().attributes('disabled')).toBeDefined();
    await inputs[3].setValue('800');
    expect(save().attributes('disabled')).toBeUndefined();
    await save().trigger('click');
    await flushPromises();
    expect(backend.gear.addCustom).toHaveBeenCalledWith(
      'telescope',
      expect.objectContaining({
        brand: 'GSO',
        aperture_mm: 200,
        focal_length_mm: 800,
        is_smart_telescope: 0,
      }),
    );
  });

  it('shows the help of a field that needs one behind its "i", not of the obvious ones', async () => {
    const { w } = await open(GearAddPage, '/settings/gear/telescope/new');
    const infos = w
      .findAll('button')
      .filter((b) => b.attributes('aria-label')?.startsWith('Informations'));
    expect(infos.map((b) => b.attributes('aria-label'))).toEqual([
      'Informations : Conception optique',
      'Informations : Interface de monture',
    ]);
  });

  it('chooses a camera’s colour type in a sheet', async () => {
    const { w } = await open(GearAddPage, '/settings/gear/camera/new');
    const field = () =>
      w.findAll('button').find((b) => b.attributes('aria-label')?.startsWith('Type de couleur'))!;
    expect(field().attributes('aria-label')).toBe('Type de couleur : OSC (couleur)');
    await field().trigger('click');
    await w
      .findAll('[role="radio"]')
      .find((r) => r.text() === 'Mono')!
      .trigger('click');
    expect(field().attributes('aria-label')).toBe('Type de couleur : Mono');
  });

  it('shows the toast when saving fails', async () => {
    backend.gear.addCustom.mockRejectedValueOnce(new Error('boom'));
    const { w } = await open(GearAddPage, '/settings/gear/accessory/new');
    const inputs = w.findAll('input');
    await inputs[0].setValue('TS');
    await inputs[1].setValue('Reducer');
    await inputs[2].setValue('0.79');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });
});

describe('the setup page’s gear buttons', () => {
  it('opens each gear list from its pen, and the filters from their button', async () => {
    const { w, router } = await open(SetupEditPage, '/settings/setups/s1');
    await button(w, 'Gérer les télescopes').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/gear/telescope');
    await button(w, 'Gérer les filtres').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/gear/filter');
  });

  it('leaves hidden telescopes out of the picker, except the setup’s own', async () => {
    setHiddenGearIds('telescope', new Set(['t1', 't2']));
    const { w } = await open(SetupEditPage, '/settings/setups/s1');
    await w
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Télescope'))!
      .trigger('click');
    const titles = w.findAll('.mob-row-title').map((r) => r.text());
    expect(titles).toContain('Askar FRA400');
    expect(titles).toContain('GSO Newton 200/800');
    expect(titles).not.toContain('Celestron C8');
  });

  it('replaces a telescope unticked in its list when the page shows again', async () => {
    const { w } = await open(SetupEditPage, '/settings/setups/s1');
    await button(w, 'Gérer les télescopes').trigger('click');
    setHiddenGearIds('telescope', new Set(['t1']));
    await enters.at(-1)!();
    await flushPromises();
    expect(
      w
        .findAll('button')
        .find((b) => b.attributes('aria-label')?.startsWith('Télescope'))!
        .attributes('aria-label'),
    ).toBe('Télescope : GSO Newton 200/800');
  });

  it('chooses a telescope added from the picker', async () => {
    const { w, router } = await open(SetupEditPage, '/settings/setups/s1');
    await w
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Télescope'))!
      .trigger('click');
    await w
      .findAll('.mob-row')
      .find((r) => r.text() === 'Ajouter un télescope')!
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/gear/telescope/new');
    const { gearAdded } = await import('../src/pages/gear/gear-added');
    gear.telescope = [...gear.telescope, tel('custom-9', 'Perso', 'Lunette 80')];
    invalidateGearCache('telescope');
    gearAdded('telescope', 'custom-9');
    await enters.at(-1)!();
    await flushPromises();
    expect(w.text()).toContain('Perso Lunette 80');
  });

  it('has no pen for the camera and the accessory of a smart telescope', async () => {
    gear.telescope = [
      { ...tel('t1', 'ZWO', 'Seestar S50'), is_smart_telescope: true, integrated_camera_id: 'c1' },
    ];
    const { w } = await open(SetupEditPage, '/settings/setups/s1');
    expect(button(w, 'Gérer les télescopes')).toBeDefined();
    expect(button(w, 'Gérer les caméras')).toBeUndefined();
    expect(button(w, 'Gérer les accessoires')).toBeUndefined();
  });
});
