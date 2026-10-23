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

const DSOS: Record<string, DSO> = {};
vi.mock('@myastrosky/core/catalog/dso-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/catalog/dso-registry')>()),
  getDSOById: (id: string) => DSOS[id],
}));

import PlansPage from '../src/pages/PlansPage.vue';
import PlanDetailPage from '../src/pages/PlanDetailPage.vue';
import PlanEntryPage from '../src/pages/PlanEntryPage.vue';
import PhoneReorderList from '../src/components/PhoneReorderList.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import { reloadTargetsPrefs } from '../src/composables/useTargets';
import { skyFocus } from '../src/composables/useSkySelection';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';

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
    reorderEntries: vi.fn(),
    removeEntry: vi.fn(),
    updateEntry: vi.fn(),
  },
};

function app(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/plans/:id/:entryId', component: { template: '<div />' } },
      { path: '/plans/:id', component: { template: '<div />' } },
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
  configureGearCatalogLoader(async (type) => [...GEAR[type]] as object[]);
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
  backend.plans.reorderEntries.mockResolvedValue(undefined);
  backend.plans.removeEntry.mockResolvedValue(undefined);
  backend.plans.updateEntry.mockResolvedValue(undefined);
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
    const rows = w.findAll('.mob-entry .mob-row');
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
    await w.find('.mob-entry .mob-row').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toMatch(/^\/plans\/p1\/e[12]$/);
  });

  it('sends one request with the new order after a drag', async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    w.findComponent(PhoneReorderList).vm.$emit('reorder', ['e2', 'e1']);
    await settle();
    expect(backend.plans.reorderEntries).toHaveBeenCalledTimes(1);
    expect(backend.plans.reorderEntries).toHaveBeenCalledWith('p1', ['e2', 'e1']);
    const first = w.findAll('.mob-entry .mob-row')[0].text();
    expect(first).toContain("Galaxie d'Andromède");
  });

  it('shows the error toast when the drag cannot be saved', async () => {
    backend.plans.reorderEntries.mockRejectedValue(new Error('boom'));
    const { w } = await show(PlanDetailPage, '/plans/p1');
    w.findComponent(PhoneReorderList).vm.$emit('reorder', ['e2', 'e1']);
    await settle();
    expect(showError).toHaveBeenCalled();
  });

  it('draws the controls that wait for another screen without a tap', async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    expect(w.find('button[aria-label="Ajouter une cible"]').classes()).toContain('mob-waiting');
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

  it("offers the desktop's eight sorts of a plan and stores the chosen one", async () => {
    const { w } = await show(PlanDetailPage, '/plans/p1');
    const sortRow = () => w.findAll('.mob-row').find((r) => r.text().includes('Trier par'))!;
    expect(sortRow().text()).toContain('Heure de transit');
    await sortRow().trigger('click');
    await settle();
    const sheet = w.findAllComponents(PhoneRadioSheet as Component)[0];
    const sheetProps = sheet.props() as { open: boolean; options: { label: string }[] };
    expect(sheetProps.open).toBe(true);
    expect(sheetProps.options.map((o) => o.label)).toEqual([
      'Heure de transit',
      'Altitude max.',
      'Intérêt photo',
      'Luminosité',
      'Taille',
      'Nom',
      'Difficulté',
      "Fenêtre d'observation",
    ]);
    sheet.vm.$emit('update:value', 'name');
    await settle();
    expect(backend.plans.update).toHaveBeenCalledWith('p1', { sortBy: 'name' });
    expect(sortRow().text()).toContain('Nom');
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
    expect(w.findAll('.mob-entry .mob-row')).toHaveLength(2);
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
      'Transit',
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
    expect(w.find('.mob-facts').classes()).toContain('mob-facts--compact');
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
