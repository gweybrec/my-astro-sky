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
const showNotice = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice }),
}));
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: (...a: unknown[]) => showInfo(...a),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
// Ionic calls a page's "will enter" each time it shows again; here a test calls the last one to come back to a page.
const enters: Array<() => unknown> = [];
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  onIonViewWillEnter: (fn: () => unknown) => {
    enters.push(fn);
  },
}));
const renderPlanPdf = vi.hoisted(() => vi.fn());
vi.mock('@myastrosky/render/plan-pdf', () => ({ renderPlanPdf }));
const saveFile = vi.hoisted(() => vi.fn());
vi.mock('../src/platform-device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/platform-device')>()),
  saveFile,
}));

const DSOS: Record<string, DSO> = {};
// The search's multiple stars, made for the setup (the star catalogue is not loaded here).
const STARS: DSO[] = [];
vi.mock('@myastrosky/core/targets/multiple-stars', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/targets/multiple-stars')>()),
  buildMultipleStarTargets: () => STARS,
}));
vi.mock('@myastrosky/core/catalog/dso-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/catalog/dso-registry')>()),
  getDSOById: (id: string) => DSOS[id],
}));

import PlansPage from '../src/pages/PlansPage.vue';
import PlanDetailPage from '../src/pages/PlanDetailPage.vue';
import PlanEntryPage from '../src/pages/PlanEntryPage.vue';
import TargetDetailPage from '../src/pages/TargetDetailPage.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import ObsWindowSheet from '../src/pages/plans/ObsWindowSheet.vue';
import { reloadTargetsPrefs } from '../src/composables/useTargets';
import { skyFocus } from '../src/composables/useSkySelection';
import { skyPlanView, skyTargetView } from '../src/sky-modes';
import { framesSheetOpen } from '../src/sky-frames';
import { currentSkyMap } from '../src/sky-map-setup';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { invalidateGearCache } from '@myastrosky/core/gear-catalog';
import { gearAdded } from '../src/pages/gear/gear-added';

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

/** Filters the user saved during a test (the catalogue's are not loaded here). */
let customFilters: object[] = [];

const setups = [
  { id: 's1', name: 'Équipement 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null },
];

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

const entry = (id: string, dsoId: string, over: Record<string, unknown> = {}) => ({
  id,
  dsoId,
  position: 0,
  paDeg: null,
  ra: null,
  dec: null,
  notes: null,
  mosaicId: null,
  mosaicWDeg: null,
  mosaicHDeg: null,
  observationWindows: [],
  ...over,
});

const window1 = {
  id: 'w1',
  startFrac: 0.1,
  endFrac: 0.2,
  filter: 'Ha',
  color: null,
  frameSeconds: 180,
  snap: true,
};

const plan = (id: string, name: string, entries: ReturnType<typeof entry>[], over = {}) => ({
  id,
  name,
  position: 0,
  nightOf: '2026-10-03',
  setupId: 's1',
  lat: 48.58,
  lon: 7.75,
  sortBy: 'transit',
  entries,
  mosaics: [],
  ...over,
});

const backend = {
  gear: { listSetups: vi.fn(), listCatalog: vi.fn() },
  plans: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    removeEntry: vi.fn(),
    updateEntry: vi.fn(),
    addEntry: vi.fn(),
  },
};

function app(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/plans/:id/targets/:dsoId', component: { template: '<div />' } },
      { path: '/plans/:id/:entryId', component: { template: '<div />' } },
      { path: '/plans/:id', component: { template: '<div />' } },
      { path: '/targets/:dsoId', component: { template: '<div />' } },
      { path: '/:p(.*)*', component: { template: '<div />' } },
    ],
  });
  void router.push(path);
  return { router, global: { stubs: ionicStubs, plugins: [router, createPinia()] } };
}

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 10));
  await flushPromises();
};

const mounted: { unmount: () => void }[] = [];
async function show(component: unknown, path: string) {
  const { router, global } = app(path);
  await router.isReady();
  const w = mount(component as never, { global });
  mounted.push(w);
  await settle();
  return { w, router };
}

const bandsOrNone = ['Aucun filtre', 'L', 'R', 'G', 'B', 'RGB', 'Ha', 'OIII', 'SII', 'Dual-Band'];

const PLANS = [
  plan('p1', 'Nuit du 2026-10-03', [
    entry('e1', 'NGC7000', { observationWindows: [window1], paDeg: 24 }),
    entry('e2', 'M31'),
  ]),
  plan('p2', 'Cygne et Céphée', [entry('e3', 'NGC7000')], { nightOf: '2026-10-10' }),
];

beforeEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  storage().set(
    'targets-prefs-v3',
    JSON.stringify({ setupId: 's1', lat: 48.58, lon: 7.75, lastDateISO: null }),
  );
  reloadTargetsPrefs();
  setActivePinia(createPinia());
  customFilters = [];
  invalidateGearCache('filter');
  configureGearCatalogLoader(async (type) =>
    type === 'filter' ? customFilters : ([...GEAR[type]] as object[]),
  );
  vi.clearAllMocks();
  DSOS.NGC7000 = dso({});
  DSOS.M31 = dso({
    id: 'M31',
    ra: 10.7,
    dec: 41.3,
    displayName: "Galaxie d'Andromède",
    catalogs: ['M31'],
    type: 'GxS',
    constellation: 'AND',
    mag: 3.4,
    rating: 4,
    difficulty: 2,
  });
  backend.gear.listSetups.mockResolvedValue(setups);
  backend.plans.list.mockResolvedValue(PLANS);
  backend.plans.create.mockResolvedValue({ id: 'p3' });
  backend.plans.remove.mockResolvedValue(undefined);
  backend.plans.update.mockResolvedValue(undefined);
  backend.plans.removeEntry.mockResolvedValue(undefined);
  backend.plans.updateEntry.mockResolvedValue(undefined);
  backend.plans.addEntry.mockResolvedValue({ id: 'e9' });
  confirm.mockResolvedValue(true);
  setBackend(backend as never);
});

describe('the Plans page', () => {
  it('lists the plans with their night and number of objects', async () => {
    const { w } = await show(PlansPage, '/tabs/plans');
    const rows = w.findAll('.mob-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Nuit du 2026-10-03');
    expect(rows[0].text()).toContain('3 oct. 2026 · 2 objets');
    expect(rows[1].text()).toContain('10 oct. 2026 · 1 objets');
  });

  it('opens a plan on a tap', async () => {
    const { w, router } = await show(PlansPage, '/tabs/plans');
    await w.findAll('.mob-row')[1].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/plans/p2');
  });

  it('filters the plans by the typed text, without accents or case', async () => {
    const { w } = await show(PlansPage, '/tabs/plans');
    await w.find('input[type="search"]').setValue('cephee');
    expect(w.findAll('.mob-row')).toHaveLength(1);
    expect(w.text()).toContain('Cygne et Céphée');
  });

  it('shows the empty board with the button that creates a plan', async () => {
    backend.plans.list.mockResolvedValue([]);
    const { w } = await show(PlansPage, '/tabs/plans');
    expect(w.text()).toContain("Aucun plan pour l'instant");
    await w.find('.mob-empty button').trigger('click');
    await settle();
    expect(backend.plans.create).toHaveBeenCalledTimes(1);
    expect(backend.plans.create.mock.calls[0][0].name).toMatch(/^Nuit du /);
  });

  it('creates a plan from the plus and reads the list again', async () => {
    const { w } = await show(PlansPage, '/tabs/plans');
    const before = backend.plans.list.mock.calls.length;
    await w.find('button[aria-label="Nouveau plan"]').trigger('click');
    await settle();
    expect(backend.plans.create).toHaveBeenCalledTimes(1);
    expect(backend.plans.list.mock.calls.length).toBe(before + 1);
  });

  it('shows the error toast when creating fails', async () => {
    backend.plans.create.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlansPage, '/tabs/plans');
    await w.find('button[aria-label="Nouveau plan"]').trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
  });
});

describe('the plan detail page', () => {
  it("shows the night, the Moon, the plan's equipment and the targets with their window", async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const text = w.text();
    expect(text).toContain('Nuit du 2026-10-03');
    expect(text).toContain('Début de nuit');
    expect(text).toContain('Fin de nuit');
    expect(text).toContain('Lune');
    expect(text).toMatch(/\d+ %/);
    expect(text).toContain('2 objets');
    const rows = w.findAll('.mob-list .mob-row');
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.text());
    expect(names.some((n) => n.includes("Nébuleuse de l'Amérique du Nord"))).toBe(true);
    expect(names.some((n) => n.includes("Galaxie d'Andromède"))).toBe(true);
    const withWindow = rows.find((r) => r.text().includes("Nébuleuse de l'Amérique"))!;
    expect(withWindow.text()).toMatch(/\d\d:\d\d – \d\d:\d\d/);
    // the equipment is the plan's: a field, no longer repeated on each target
    expect(withWindow.text()).not.toContain('Équipement 1');
    const field = w.find('button[aria-label^="Équipement : "]');
    expect(field.attributes('aria-label')).toContain('Équipement 1');
    expect(field.find('.mob-btn-label').text()).toContain('Équipement 1');
    await field.trigger('click');
    await settle();
    const pick = w
      .findAllComponents({ name: 'PhoneSheet' })
      .find((c) => c.props('title') === 'Équipement')!;
    expect(pick.props('open')).toBe(true);
    expect(pick.text()).toContain('Nouveau setup');
  });

  it('opens a target on a tap', async () => {
    const { w, router } = await show(PlanDetailPage, '/plans/p1');
    await w.find('.mob-list .mob-row').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toMatch(/^\/plans\/p1\/e[12]$/);
  });

  const withMosaic = () => {
    const mosaic = {
      id: 'm1',
      dsoId: 'NGC7000',
      name: null,
      centerRa: 314,
      centerDec: 44,
      paDeg: 0,
      overlapPct: 10,
      cols: 2,
      rows: 1,
      position: 0,
    };
    backend.plans.list.mockResolvedValue([
      plan(
        'p1',
        'Nuit du 2026-10-03',
        [
          entry('e1', 'M31'),
          entry('t1', 'NGC7000', { mosaicId: 'm1', ra: 313, dec: 44 }),
          entry('t2', 'NGC7000', { mosaicId: 'm1', ra: 315, dec: 44 }),
        ],
        { mosaics: [mosaic] },
      ),
    ]);
  };
  const mosaicRow = (w: ReturnType<typeof mount>) =>
    w
      .findAll('.mob-list .mob-row')
      .find((r) => r.text().includes("Nébuleuse de l'Amérique du Nord · Mosaïque"))!;

  it('lists a mosaic as an item like the targets, and shows a tapped one on the map zoomed to fit it', async () => {
    withMosaic();
    const { w, router } = await show(PlanDetailPage, '/plans/p1');
    vi.spyOn(router, 'replace').mockResolvedValue(undefined);
    expect(w.text()).toContain('2 objets');
    expect(mosaicRow(w).text()).toContain('2 tuiles');
    // one item for the mosaic, none for its tiles
    expect(w.findAll('.mob-list .mob-row')).toHaveLength(2);
    await mosaicRow(w).trigger('click');
    await settle();
    expect(skyPlanView.value?.planId).toBe('p1');
    expect(skyFocus.value).toMatchObject({ ra: 314, dec: 44, scale: 0 });
    const field = skyFocus.value!.fov!;
    expect(field.wDeg).toBeGreaterThan(field.hDeg);
    skyPlanView.value = null;
    skyFocus.value = null;
    framesSheetOpen.value = false;
  });

  it('opens the Cibles list for the plan from its plus', async () => {
    const { w, router } = await show(PlanDetailPage, '/plans/p1');
    const plus = w.find('button[aria-label="Ajouter une cible"]');
    expect(plus.classes()).not.toContain('mob-waiting');
    await plus.trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/plans/p1/targets');
  });

  it('renames the plan from its actions, and saves neither an empty nor an unchanged name', async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const validate = () => w.findAll('button').find((b) => b.text() === 'Valider')!;
    const openRename = async () => {
      await w
        .findAll('.mob-row')
        .find((r) => r.text().includes('Renommer le plan'))!
        .trigger('click');
      await settle();
      return w.find('input[aria-label="Renommer le plan"]');
    };

    let field = await openRename();
    expect((field.element as HTMLInputElement).value).toBe('Nuit du 2026-10-03');
    await validate().trigger('click');
    await settle();
    field = await openRename();
    await field.setValue('   ');
    await validate().trigger('click');
    await settle();
    expect(backend.plans.update).not.toHaveBeenCalled();

    field = await openRename();
    await field.setValue('  Cygne  ');
    await validate().trigger('click');
    await settle();
    expect(backend.plans.update).toHaveBeenCalledWith('p1', { name: 'Cygne' });
  });

  it('shows the error toast when the rename fails', async () => {
    backend.plans.update.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlanDetailPage, '/plans/p1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Renommer le plan'))!
      .trigger('click');
    await settle();
    await w.find('input[aria-label="Renommer le plan"]').setValue('Autre');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Valider')!
      .trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
  });

  it("offers the desktop's eight sorts of a plan from the top bar, the most used first, and stores the chosen one", async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    // the sort is a button of its own, no longer a row of the actions
    expect(w.findAll('.mob-row').some((r) => r.text().includes('Trier par'))).toBe(false);
    await w.find('button[aria-label="Trier par"]').trigger('click');
    await settle();
    const sheet = w.findAllComponents(PhoneRadioSheet as Component)[0];
    const sheetProps = sheet.props() as { open: boolean; options: { label: string }[] };
    expect(sheetProps.open).toBe(true);
    // the most used first, the observation window at the top and the difficulty last
    expect(sheetProps.options.map((o) => o.label)).toEqual([
      "Fenêtre d'observation",
      'Heure au plus haut',
      'Altitude max.',
      'Intérêt photo',
      'Taille',
      'Nom',
      'Luminosité',
      'Difficulté',
    ]);
    sheet.vm.$emit('update:value', 'name');
    await settle();
    expect(backend.plans.update).toHaveBeenCalledWith('p1', { sortBy: 'name' });
  });

  it('sorts the targets again by their window when the page is entered after a window changed', async () => {
    const byWindow = (e2Start: number) => [
      plan(
        'p1',
        'Nuit du 2026-10-03',
        [
          entry('e1', 'NGC7000', { observationWindows: [window1] }),
          entry('e2', 'M31', {
            observationWindows: [{ ...window1, id: 'w2', startFrac: e2Start, endFrac: 0.9 }],
          }),
        ],
        { sortBy: 'window' },
      ),
    ];
    backend.plans.list.mockResolvedValue(byWindow(0.5));
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const first = () => w.findAll('.mob-list .mob-row')[0].text();
    expect(first()).toContain("Nébuleuse de l'Amérique du Nord");
    // the window of M31 moved before NGC 7000's on its own page, then back here
    backend.plans.list.mockResolvedValue(byWindow(0.05));
    await enters.at(-1)!();
    await settle();
    expect(first()).toContain("Galaxie d'Andromède");
  });

  it("shows the plan's frames on the map in its own mode, with the frames' sheet, and comes back here", async () => {
    const { w, router } = await show(PlanDetailPage, '/plans/p1');
    const replace = vi.spyOn(router, 'replace').mockResolvedValue(undefined);
    const frames = useFovFramesStore();
    frames.setSelection({ kind: 'free' });
    frames.setFramesVisible(false);
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Afficher sur la carte'))!
      .trigger('click');
    await settle();
    expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/plans', '/tabs/sky']);
    expect(frames.selection).toEqual({ kind: 'plan', planId: 'p1' });
    expect(frames.framesVisible).toBe(true);
    expect(framesSheetOpen.value).toBe(true);
    // the frames go back to what they were when the mode ends
    expect(skyPlanView.value).toEqual({
      planId: 'p1',
      name: 'Nuit du 2026-10-03',
      frames: { visible: false, selection: { kind: 'free' } },
      returnTo: '/plans/p1',
    });
    skyPlanView.value = null;
    framesSheetOpen.value = false;
  });

  it("exports the plan as the desktop's PDF, with its observation windows, through the share sheet", async () => {
    currentSkyMap.value = {} as never;
    const blob = new Blob(['%PDF']);
    renderPlanPdf.mockResolvedValue(blob);
    saveFile.mockResolvedValue(undefined);
    const { w } = await show(PlanDetailPage, '/plans/p1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Exporter en PDF'))!
      .trigger('click');
    await settle();
    expect(renderPlanPdf).toHaveBeenCalledTimes(1);
    const [map, opts] = renderPlanPdf.mock.calls[0];
    expect(map).toBe(currentSkyMap.value);
    expect(opts.planName).toBe('Nuit du 2026-10-03');
    expect(opts.targets.map((t: { dso: DSO }) => t.dso.id).sort()).toEqual(['M31', 'NGC7000']);
    const withWindow = opts.targets.find((t: { dso: DSO }) => t.dso.id === 'NGC7000');
    expect(withWindow.observationWindows).toEqual([window1]);
    expect(opts.fovSpecs).toHaveLength(1);
    expect(opts.fovSpecs[0].wDeg).toBeGreaterThan(0);
    expect(opts.setup?.name).toBe('Équipement 1');
    expect(opts.header).toEqual({ nightOf: '2026-10-03', latDeg: 48.58, lonDeg: 7.75 });
    expect(saveFile).toHaveBeenCalledWith(expect.stringMatching(/^myastrosky-plan-.*\.pdf$/), blob);
    expect(showError).not.toHaveBeenCalled();
    currentSkyMap.value = null;
  });

  it('says the plan is empty instead of exporting a PDF of nothing', async () => {
    currentSkyMap.value = {} as never;
    backend.plans.list.mockResolvedValue([plan('p1', 'Vide', [])]);
    const { w } = await show(PlanDetailPage, '/plans/p1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Exporter en PDF'))!
      .trigger('click');
    await settle();
    expect(renderPlanPdf).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledWith(
      'Aucune cible dans ce plan. Ajoutez-en depuis les suggestions ou la recherche.',
    );
    currentSkyMap.value = null;
  });

  it('shows the error toast when the PDF cannot be made', async () => {
    currentSkyMap.value = {} as never;
    renderPlanPdf.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlanDetailPage, '/plans/p1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Exporter en PDF'))!
      .trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    currentSkyMap.value = null;
  });

  it('asks before deleting the plan and does nothing when cancelled', async () => {
    confirm.mockResolvedValue(false);
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const del = w.findAll('.mob-row').find((r) => r.text().includes('Supprimer le plan'))!;
    await del.trigger('click');
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: 'Supprimer le plan',
      message: 'Supprimer le plan « Nuit du 2026-10-03 » ?',
      confirmLabel: 'Supprimer le plan',
      destructive: true,
    });
    expect(backend.plans.remove).not.toHaveBeenCalled();
  });

  it('deletes the plan once confirmed and leaves the page', async () => {
    const { w, router } = await show(PlanDetailPage, '/plans/p1');
    const del = w.findAll('.mob-row').find((r) => r.text().includes('Supprimer le plan'))!;
    await del.trigger('click');
    await settle();
    expect(backend.plans.remove).toHaveBeenCalledWith('p1');
    expect(router.currentRoute.value.path).toBe('/tabs/plans');
  });

  it('shows the error toast when the delete fails', async () => {
    backend.plans.remove.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const del = w.findAll('.mob-row').find((r) => r.text().includes('Supprimer le plan'))!;
    await del.trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
  });

  it('shows the targets without the night when no location is known', async () => {
    storage().set('targets-prefs-v3', JSON.stringify({ setupId: 's1', lat: null, lon: null }));
    reloadTargetsPrefs();
    backend.plans.list.mockResolvedValue([{ ...PLANS[0], lat: null, lon: null }]);
    const { w } = await show(PlanDetailPage, '/plans/p1');
    expect(w.text()).not.toContain('Début de nuit');
    expect(w.findAll('.mob-list .mob-row')).toHaveLength(2);
  });
});

describe('the plan entry page', () => {
  it('shows the figures of the target for the night and the setup, compact, without the equipment', async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const text = w.text();
    expect(text).toContain("Nébuleuse de l'Amérique du Nord");
    expect(text).toContain('NGC7000');
    expect(text).toContain('Nébuleuse en émission');
    expect(text).toContain('CYG');
    for (const label of [
      'Alt. max',
      'Au plus haut',
      'Magnitude',
      'Taille',
      'Distance Lune',
      'Intérêt DSO',
      'Difficulté',
      'Angle',
      'Score',
      'Champ',
      'Temps total indicatif',
    ]) {
      expect(text).toContain(label);
    }
    // the equipment is the plan's, chosen on the plan's page
    expect(w.findAll('.mob-fact-label').map((l) => l.text())).not.toContain('Équipement');
    expect(w.find('.mob-facts').classes()).toEqual(['mob-facts']);
    expect(text).toContain('4.0');
    expect(text).toContain('2.0°');
    expect(text).toContain('★★★★★');
    expect(text).toContain('24°');
    expect(text).not.toContain('Askar FRA400');
    expect(text).toContain('Filtres suggérés');
  });

  it("draws the target's altitude over the night with its observation windows as bands", async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const chart = w.find('.mob-alt-chart svg');
    expect(chart.attributes('aria-label')).toMatch(/^Trajectoire de la nuit : \d+° à \d\d:\d\d$/);
    expect(
      chart.find('.mob-alt-chart-curve').attributes('points')!.split(' ').length,
    ).toBeGreaterThan(10);
    expect(chart.findAll('.mob-alt-chart-grid')).toHaveLength(5);
    expect(chart.findAll('.mob-alt-chart-tick').map((t) => t.text())).toEqual(
      expect.arrayContaining(['20°', '40°', '60°', '80°']),
    );
    // the seed's one window, Ha, as a band inside the plot
    const bands = chart.findAll('.mob-alt-chart-window');
    expect(bands).toHaveLength(1);
    expect(Number(bands[0].attributes('x'))).toBeGreaterThanOrEqual(36);
    expect(
      Number(bands[0].attributes('x')) + Number(bands[0].attributes('width')),
    ).toBeLessThanOrEqual(372);
    // the chart's facts come first, the suggested filters after it
    const order = [...w.find('.mob-scroll').element.children].map((e) => e.className);
    expect(order.findIndex((c) => c.includes('mob-alt-chart'))).toBeGreaterThan(
      order.findIndex((c) => c.includes('mob-facts')),
    );
  });

  it('shows the target on the map as the desktop does: a free frame of the setup, the map zoomed on it', async () => {
    const { w, router } = await show(PlanEntryPage, '/plans/p1/e1');
    const replace = vi.spyOn(router, 'replace').mockResolvedValue(undefined);
    await w
      .findAll('.mob-row')
      .find((r) => r.text().trim() === 'Afficher sur la carte')!
      .trigger('click');
    await settle();
    expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/plans', '/tabs/sky']);
    const frames = useFovFramesStore();
    expect(frames.selection).toEqual({ kind: 'free' });
    expect(frames.framesVisible).toBe(true);
    expect(skyFocus.value).toMatchObject({ ra: DSOS.NGC7000.ra, dec: DSOS.NGC7000.dec });
    expect(skyFocus.value?.fov?.wDeg).toBeGreaterThan(0);
    // the map shows the target in its own mode, the frame anchored to it, and comes back here, or once the frame is
    // moved onto another object, to that object's page for this plan
    const shown = skyTargetView.value!;
    expect(shown).toMatchObject({
      dsoId: 'NGC7000',
      name: "Nébuleuse de l'Amérique du Nord",
      tab: 'plans',
      pages: ['/plans/p1'],
      page: '/plans/p1/e1',
    });
    expect(shown.pageOf('M31')).toBe('/plans/p1/targets/M31');
    const made = frames.adhoc.find((f) => f.id === shown.frameId)!;
    expect(made.anchor).toMatchObject({ kind: 'sky', dsoId: 'NGC7000' });
  });

  it("opens the suggested filters, the desktop's recipe, in a sheet", async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().trim() === 'Filtres suggérés')!
      .trigger('click');
    await settle();
    const rows = w.findAll('.mob-row').filter((r) => /\d+ × \d+ s = /.test(r.text()));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('lists the observation windows with their filter, times and exposures', async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    expect(w.text()).toContain("Fenêtres d'observation");
    const rows = w.findAll('.mob-row').filter((r) => r.text().includes('Ha'));
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toMatch(/\d\d:\d\d – \d\d:\d\d/);
    expect(rows[0].text()).toMatch(/\d+ × 180 s/);
  });

  it('adds a window only on Enregistrer, with one request that keeps the others', async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const add = w.findAll('.mob-row').find((r) => r.text().trim() === "Fenêtre d'observation")!;
    await add.trigger('click');
    await settle();
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
    expect(w.findAll('button').some((b) => b.text() === 'Supprimer')).toBe(false);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Enregistrer')!
      .trigger('click');
    await settle();
    expect(backend.plans.updateEntry).toHaveBeenCalledTimes(1);
    const [entryId, changes] = backend.plans.updateEntry.mock.calls[0];
    expect(entryId).toBe('e1');
    expect(changes.observationWindows).toHaveLength(2);
    expect(changes.observationWindows[0].id).toBe('w1');
  });

  it('leaves a new window unsaved with Annuler', async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const add = w.findAll('.mob-row').find((r) => r.text().trim() === "Fenêtre d'observation")!;
    await add.trigger('click');
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Annuler')!
      .trigger('click');
    await settle();
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
  });

  it('opens the window sheet with the stored values and saves the exposure and the switch', async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const row = w.findAll('.mob-row').find((r) => r.text().includes('Ha'))!;
    await row.trigger('click');
    await settle();
    expect(w.text()).toContain('Durée de la fenêtre');
    expect(w.text()).toContain('Pose unitaire');
    const input = w.find('#obs-frame');
    expect((input.element as HTMLInputElement).value).toBe('180');
    await input.setValue('300');
    const save = w.findAll('button').find((b) => b.text() === 'Enregistrer')!;
    await save.trigger('click');
    await settle();
    const changes = backend.plans.updateEntry.mock.calls[0][1];
    expect(changes.observationWindows[0]).toMatchObject({
      id: 'w1',
      startFrac: 0.1,
      endFrac: 0.2,
      frameSeconds: 300,
      snap: true,
    });
  });

  const openWindow1 = async () => {
    const shown = await show(PlanEntryPage, '/plans/p1/e1');
    await shown.w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Ha'))!
      .trigger('click');
    await settle();
    return shown;
  };
  type Page = Awaited<ReturnType<typeof show>>['w'];
  const tapRow = async (w: Page, title: string) => {
    await w
      .findAll('.mob-row')
      .find((r) => r.text().trim() === title)!
      .trigger('click');
    await settle();
  };
  const tapButton = async (w: Page, start: string) => {
    await w
      .findAll('button')
      .find((b) => b.text().startsWith(start))!
      .trigger('click');
    await settle();
  };
  const fieldLabel = (w: Page, start: string) =>
    w
      .findAll('button')
      .find((b) => b.text().startsWith(start))!
      .attributes('aria-label');
  const savedWindow = () => backend.plans.updateEntry.mock.calls[0][1].observationWindows[0];

  it("chooses the window's filter in its list, ticked, and stores it only with Enregistrer", async () => {
    const { w } = await openWindow1();
    expect(fieldLabel(w, 'Filtre')).toBe('Filtre : Ha');
    await tapButton(w, 'Filtre');
    // the add row, "Aucun filtre", then the desktop's generic bands; the window's filter is ticked
    // the filter list's rows: those after its add row
    const listed = () => {
      const titles = w.findAll('.mob-row .mob-row-title').map((r) => r.text());
      return titles.slice(titles.indexOf('Ajouter un filtre'));
    };
    expect(listed()).toEqual(['Ajouter un filtre', ...bandsOrNone]);
    // the last row named Ha: the page's own window row comes first
    const ha = w
      .findAll('.mob-row')
      .filter((r) => r.find('.mob-row-title').text() === 'Ha')
      .at(-1)!;
    expect(ha.find('.mob-status--success').exists()).toBe(true);
    await w.find('input[type="search"]').setValue('ii');
    await settle();
    expect(listed()).toEqual(['Ajouter un filtre', 'Aucun filtre', 'OIII', 'SII']);
    await tapRow(w, 'OIII');
    expect(fieldLabel(w, 'Filtre')).toBe('Filtre : OIII');
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
    await tapButton(w, 'Enregistrer');
    // no colour of its own: the window keeps following its filter
    expect(savedWindow()).toMatchObject({ id: 'w1', filter: 'OIII', color: null });
  });

  it('takes the filter off with "Aucun filtre"', async () => {
    const { w } = await openWindow1();
    await tapButton(w, 'Filtre');
    await tapRow(w, 'Aucun filtre');
    await tapButton(w, 'Enregistrer');
    expect(savedWindow().filter).toBeNull();
  });

  it("gives the window a colour of its own with the phone's colour picker", async () => {
    const { w } = await openWindow1();
    expect(fieldLabel(w, 'Couleur')).toBe('Couleur de la fenêtre : celle du filtre');
    await w.find('input[type="color"]').setValue('#123456');
    await tapButton(w, 'Enregistrer');
    expect(savedWindow()).toMatchObject({ filter: 'Ha', color: '#123456' });
  });

  it('adds a filter from the list and comes back to the window as edited, the new filter chosen', async () => {
    const { w, router } = await openWindow1();
    await w.find('#obs-frame').setValue('420');
    await tapButton(w, 'Filtre');
    await tapRow(w, 'Ajouter un filtre');
    expect(router.currentRoute.value.path).toBe('/settings/gear/filter/new');
    expect(w.findComponent(ObsWindowSheet).props('open')).toBe(false);
    // the add page saves a filter, then goes back
    customFilters = [
      {
        id: 'custom-f1',
        brand: 'Perso',
        model: 'Ha 5nm maison',
        subtype: 'Ha',
        center_nm: 656.3,
        fwhm_nm: 5,
        color: '#aa0000',
      },
    ];
    invalidateGearCache('filter');
    gearAdded('filter', 'custom-f1');
    await router.push('/plans/p1/e1');
    await enters.at(-1)!();
    await settle();
    expect(w.findComponent(ObsWindowSheet).props('open')).toBe(true);
    expect((w.find('#obs-frame').element as HTMLInputElement).value).toBe('420');
    expect(fieldLabel(w, 'Filtre')).toBe('Filtre : Ha 5nm maison');
    await tapButton(w, 'Enregistrer');
    expect(backend.plans.updateEntry).toHaveBeenCalledTimes(1);
    expect(savedWindow()).toMatchObject({
      id: 'w1',
      filter: 'Ha 5nm maison',
      frameSeconds: 420,
    });
  });

  it('keeps a new window unsaved while a filter is added, and adds it once on Enregistrer', async () => {
    const { w, router } = await show(PlanEntryPage, '/plans/p1/e1');
    await tapRow(w, "Fenêtre d'observation");
    await tapButton(w, 'Filtre');
    await tapRow(w, 'Ajouter un filtre');
    // nothing saved on the add page: the window comes back as it was, still new
    await router.push('/plans/p1/e1');
    await enters.at(-1)!();
    await settle();
    expect(w.findAll('button').some((b) => b.text() === 'Annuler')).toBe(true);
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
    await tapButton(w, 'Enregistrer');
    expect(backend.plans.updateEntry.mock.calls[0][1].observationWindows).toHaveLength(2);
  });

  it("changes the start and the end of a window with the phone's time picker, keeping a minimum length", async () => {
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Ha'))!
      .trigger('click');
    await settle();
    const [startPicker, endPicker] = w.findAllComponents(PhoneNativePicker);
    expect(startPicker.props('type')).toBe('time');
    const startClock = startPicker.props('value') as string;
    const endClock = endPicker.props('value') as string;
    expect(startClock).toMatch(/^\d\d:\d\d$/);

    // An end before the start is brought back to the minimum length after the start.
    endPicker.vm.$emit('pick', startClock);
    await settle();
    const save = () => w.findAll('button').find((b) => b.text() === 'Enregistrer')!;
    await save().trigger('click');
    await settle();
    const saved = backend.plans.updateEntry.mock.calls[0][1].observationWindows[0];
    expect(saved.startFrac).toBe(0.1);
    expect(saved.endFrac).toBeCloseTo(0.12, 5);
    expect(endClock).not.toBe(startClock);
  });

  it('asks before deleting a window', async () => {
    confirm.mockResolvedValue(false);
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Ha'))!
      .trigger('click');
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Supprimer')!
      .trigger('click');
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Ha'))!
      .trigger('click');
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Supprimer')!
      .trigger('click');
    await settle();
    expect(backend.plans.updateEntry.mock.calls[0][1].observationWindows).toEqual([]);
  });

  it('keeps the window editor open, with its values, when the delete is cancelled', async () => {
    confirm.mockResolvedValue(false);
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    await w
      .findAll('.mob-row')
      .find((r) => r.text().includes('Ha'))!
      .trigger('click');
    await settle();
    await w.find('#obs-frame').setValue('420');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Supprimer')!
      .trigger('click');
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('Pose unitaire');
    expect((w.find('#obs-frame').element as HTMLInputElement).value).toBe('420');
    expect(backend.plans.updateEntry).not.toHaveBeenCalled();
  });

  it('asks before removing the target from the plan, then removes it', async () => {
    confirm.mockResolvedValue(false);
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const remove = w.findAll('.mob-row').find((r) => r.text().includes('Retirer du plan'))!;
    await remove.trigger('click');
    await settle();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      confirmLabel: 'Retirer du plan',
      destructive: true,
    });
    expect(backend.plans.removeEntry).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await remove.trigger('click');
    await settle();
    expect(backend.plans.removeEntry).toHaveBeenCalledWith('e1', 'p1');
  });

  it('shows the error toast when saving a window fails', async () => {
    backend.plans.updateEntry.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlanEntryPage, '/plans/p1/e1');
    const add = w.findAll('.mob-row').find((r) => r.text().trim() === "Fenêtre d'observation")!;
    await add.trigger('click');
    await settle();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Enregistrer')!
      .trigger('click');
    await settle();
    expect(showError).toHaveBeenCalled();
  });
});

describe('the target page ("Cibles, détail d\'une cible")', () => {
  const row = (w: ReturnType<typeof mount>, title: string) =>
    w.findAll('.mob-row').find((r) => r.text().trim() === title)!;

  it("shows the target's figures, altitude and suggested filters for the search's night and setup", async () => {
    const { w } = await show(TargetDetailPage, '/targets/NGC7000');
    const labels = w.findAll('.mob-fact-label').map((l) => l.text());
    expect(labels).toEqual(expect.arrayContaining(['Alt. max', 'Au plus haut', 'Score', 'Champ']));
    // no frame on a target of the list, and the setup is the search's
    expect(labels).not.toContain('Angle');
    expect(w.find('.mob-alt-chart svg').attributes('aria-label')).toMatch(
      /^Trajectoire de la nuit/,
    );
    expect(w.findAll('.mob-alt-chart-window')).toHaveLength(0);
    expect(row(w, 'Filtres suggérés').exists()).toBe(true);
    expect(row(w, 'Afficher sur la carte').exists()).toBe(true);
    expect(row(w, 'Ajouter à un plan').exists()).toBe(true);
    expect(w.text()).not.toContain('Modifier');
  });

  it("shows the target on the map with the search's setup, leaving the Cibles tab", async () => {
    const { w, router } = await show(TargetDetailPage, '/targets/NGC7000');
    const replace = vi.spyOn(router, 'replace').mockResolvedValue(undefined);
    await row(w, 'Afficher sur la carte').trigger('click');
    await settle();
    expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/targets', '/tabs/sky']);
    expect(skyFocus.value).toMatchObject({ ra: DSOS.NGC7000.ra, dec: DSOS.NGC7000.dec });
    expect(useFovFramesStore().framesVisible).toBe(true);
    const shown = skyTargetView.value!;
    expect(shown).toMatchObject({ tab: 'targets', pages: [], page: '/targets/NGC7000' });
    expect(shown.pageOf('M31')).toBe('/targets/M31');
  });

  it('adds the target to a plan or takes it out, the plans ticked where it is, and says so', async () => {
    const { w } = await show(TargetDetailPage, '/targets/M31');
    await row(w, 'Ajouter à un plan').trigger('click');
    await settle();
    const picker = w
      .findAllComponents({ name: 'PhoneSheet' })
      .find((c) => c.props('title') === 'Ajouter au plan')!;
    expect(picker.props('open')).toBe(true);
    const ticks = picker.findAllComponents({ name: 'PhoneCheckRow' });
    expect(ticks.map((c) => [c.props('title'), c.props('modelValue')])).toEqual(
      PLANS.map((p) => [p.name, p.entries.some((e) => e.dsoId === 'M31')]),
    );
    const out = ticks.find((c) => c.props('modelValue') === false)!;
    out.vm.$emit('update:modelValue', true);
    await settle();
    const planId = PLANS.find((p) => p.name === out.props('title'))!.id;
    expect(backend.plans.addEntry).toHaveBeenCalledWith(planId, { dsoId: 'M31' });
    expect(showNotice).toHaveBeenCalledWith(`Ajouté à « ${out.props('title')} »`);

    const inside = ticks.find((c) => c.props('modelValue') === true)!;
    inside.vm.$emit('update:modelValue', false);
    await settle();
    expect(backend.plans.removeEntry).toHaveBeenCalled();
    expect(showNotice).toHaveBeenLastCalledWith(`Retiré de « ${inside.props('title')} »`);
  });

  it('shows a multiple star of the list and adds it to a plan as a frame on its position', async () => {
    STARS.splice(0, STARS.length, {
      ...DSOS.NGC7000,
      id: 'star:95947',
      type: 'MS',
      displayName: 'Albireo',
      catalogs: ['β Cyg'],
      majAxis: null,
      multiplicity: { components: 2, sep: '34.7"' },
    } as DSO);
    const { w } = await show(TargetDetailPage, '/targets/star%3A95947');
    expect(w.find('.mob-topbar-title').text()).toBe('Albireo');
    expect(w.find('.mob-alt-chart svg').exists()).toBe(true);
    expect(w.findAll('.mob-fact-label').map((l) => l.text())).toContain('Alt. max');
    await row(w, 'Ajouter à un plan').trigger('click');
    await settle();
    // added only, as the desktop: plain rows, no tick
    expect(w.findAllComponents({ name: 'PhoneCheckRow' })).toHaveLength(0);
    await row(w, PLANS[1].name).trigger('click');
    await settle();
    expect(backend.plans.addEntry).toHaveBeenCalledWith(PLANS[1].id, {
      ra: DSOS.NGC7000.ra,
      dec: DSOS.NGC7000.dec,
    });
    expect(showNotice).toHaveBeenCalledWith(`Ajouté à « ${PLANS[1].name} »`);
  });

  it('makes a new plan holding the target, named after the night searched', async () => {
    const { w } = await show(TargetDetailPage, '/targets/M31');
    await row(w, 'Ajouter à un plan').trigger('click');
    await settle();
    await row(w, 'Nouveau plan').trigger('click');
    await settle();
    expect(backend.plans.create).toHaveBeenCalledWith({ name: expect.stringMatching(/^Nuit du /) });
    expect(backend.plans.addEntry).toHaveBeenCalledWith('p3', { dsoId: 'M31' });
  });
});

describe('the target page of a plan ("Plan, ajouter une cible, détail")', () => {
  const row = (w: ReturnType<typeof mount>, title: string) =>
    w.findAll('.mob-row').find((r) => r.text().trim() === title)!;
  const add = (w: ReturnType<typeof mount>) =>
    w.findAllComponents({ name: 'PhoneRow' }).find((c) => c.props('title') === 'Ajouter au plan')!;

  it('has one "Ajouter au plan" button, for this plan, instead of the plans picker', async () => {
    const { w } = await show(TargetDetailPage, '/plans/p2/targets/M31');
    expect(row(w, 'Afficher sur la carte').exists()).toBe(true);
    expect(row(w, 'Ajouter à un plan')).toBeUndefined();
    expect(w.findAllComponents({ name: 'PlanPickerSheet' })).toHaveLength(0);
    expect(w.findAllComponents({ name: 'PhoneCheckRow' })).toHaveLength(0);
    expect(add(w).props('disabled')).toBe(false);
  });

  it('adds the target to the plan, says so, and is greyed once it is in it', async () => {
    backend.plans.addEntry.mockImplementation(async () => {
      backend.plans.list.mockResolvedValue([
        PLANS[0],
        { ...PLANS[1], entries: [...PLANS[1].entries, entry('e9', 'M31')] },
      ]);
      return { id: 'e9' };
    });
    const { w } = await show(TargetDetailPage, '/plans/p2/targets/M31');
    await add(w).trigger('click');
    await settle();
    expect(backend.plans.addEntry).toHaveBeenCalledWith('p2', { dsoId: 'M31' });
    expect(backend.plans.removeEntry).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledWith('Ajouté à « Cygne et Céphée »');
    expect(add(w).props('disabled')).toBe(true);
  });

  it('is greyed for a target already in the plan, and a tap adds nothing', async () => {
    const { w } = await show(TargetDetailPage, '/plans/p1/targets/M31');
    expect(add(w).props('disabled')).toBe(true);
    await add(w).trigger('click');
    await settle();
    expect(backend.plans.addEntry).not.toHaveBeenCalled();
    expect(backend.plans.removeEntry).not.toHaveBeenCalled();
  });

  it('shows the target on the map and comes back to it, or to the object its frame was moved onto, in this list', async () => {
    const { w, router } = await show(TargetDetailPage, '/plans/p2/targets/M31');
    const replace = vi.spyOn(router, 'replace').mockResolvedValue(undefined);
    await row(w, 'Afficher sur la carte').trigger('click');
    await settle();
    expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/plans', '/tabs/sky']);
    const shown = skyTargetView.value!;
    expect(shown).toMatchObject({
      dsoId: 'M31',
      tab: 'plans',
      pages: ['/plans/p2', '/plans/p2/targets'],
      page: '/plans/p2/targets/M31',
    });
    expect(shown.pageOf('NGC7000')).toBe('/plans/p2/targets/NGC7000');
  });

  it("uses the plan's night, not the one of the Cibles search", async () => {
    const night = async (path: string) =>
      (await show(TargetDetailPage, path)).w.find('.mob-alt-chart svg').attributes('aria-label');
    // the two plans are a week apart: the night (and so the transit time) differs
    expect(await night('/plans/p1/targets/NGC7000')).not.toBe(
      await night('/plans/p2/targets/NGC7000'),
    );
  });

  it('adds a multiple star to the plan as a frame on its position, with the same button', async () => {
    STARS.splice(0, STARS.length, {
      ...DSOS.NGC7000,
      id: 'star:95947',
      type: 'MS',
      displayName: 'Albireo',
      catalogs: ['β Cyg'],
      majAxis: null,
      multiplicity: { components: 2, sep: '34.7"' },
    } as DSO);
    const { w } = await show(TargetDetailPage, '/plans/p2/targets/star%3A95947');
    expect(add(w).props('disabled')).toBe(false);
    await add(w).trigger('click');
    await settle();
    expect(backend.plans.addEntry).toHaveBeenCalledWith('p2', {
      ra: DSOS.NGC7000.ra,
      dec: DSOS.NGC7000.dec,
    });
    expect(showNotice).toHaveBeenCalledWith('Ajouté à « Cygne et Céphée »');
  });
});
