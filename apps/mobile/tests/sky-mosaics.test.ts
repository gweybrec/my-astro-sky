import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { DSO } from '@myastrosky/core/types';
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import type { Plan } from '@myastrosky/app-state/api';
import { ionicStubs, mapSheetHost } from './helpers';

const showError = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/composables/useSetupLines', async () => {
  const { ref } = await import('vue');
  return {
    useSetupLines: () => ({
      lines: ref([
        { setup: { id: 's1', name: 'Équipement 1' }, subs: ['Askar FRA400 + ASI533MC', 'Champ'] },
        { setup: { id: 's2', name: 'Équipement 2' }, subs: ['C6 + ASI178', 'Champ'] },
        { setup: { id: 'smart', name: 'Seestar' }, subs: ['Seestar S50', 'Champ'] },
      ]),
      load: () => Promise.resolve(),
    }),
  };
});

const andromeda = {
  id: 'M31',
  ra: 10.68,
  dec: 41.27,
  majAxis: 190,
  minAxis: 60,
  pa: 35,
  displayName: "Galaxie d'Andromède",
};
vi.mock('@myastrosky/core/search', () => ({
  searchDSOs: () => [{ dso: andromeda, label: 'M31' }],
}));

import SkyFrameSheet from '../src/pages/sky/SkyFrameSheet.vue';
import SkyFramesSheet from '../src/pages/sky/SkyFramesSheet.vue';
import SkyFramePicker from '../src/pages/sky/SkyFramePicker.vue';
import SkyMosaicSheet from '../src/pages/sky/SkyMosaicSheet.vue';
import SkyObjectSheet from '../src/pages/sky/SkyObjectSheet.vue';
import PhoneStepperRow from '../src/components/PhoneStepperRow.vue';

/** Mosaics on the Ciel map: "Ciel, mosaïque sélectionnée", "Ciel, nouvelle mosaïque", "Ciel, changer d'équipement". */

const spec = (name: string, wDeg: number, hDeg: number, smart = false) => ({
  name,
  label: `${name} · ${wDeg}° × ${hDeg}°`,
  wDeg,
  hDeg,
  smart,
  mosaic: null,
});
function withSpecs() {
  const fov = useFovFramesStore();
  fov.specs = new Map([
    ['s1', spec('Équipement 1', 2.5, 1.7)],
    ['s2', spec('Équipement 2', 1.2, 0.8)],
    ['smart', spec('Seestar', 1.3, 0.7, true)],
  ]);
  vi.spyOn(fov, 'loadSpecs').mockResolvedValue();
  return fov;
}
const plan = (over: Partial<Plan> & { id: string }): Plan =>
  ({ name: over.id, setupId: null, entries: [], mosaics: [], ...over }) as Plan;
const planMosaic = (over: Record<string, unknown> = {}) => ({
  id: 'mo1',
  dsoId: null,
  name: 'Amérique du Nord',
  centerRa: 314.7,
  centerDec: 44.3,
  paDeg: 0,
  overlapPct: 20,
  cols: 3,
  rows: 2,
  position: 0,
  ...over,
});
const outline = (id: string): RenderableFrame => ({
  id,
  name: 'Amérique du Nord',
  label: 'Équipement 1 · 2.5° × 1.7°',
  wDeg: 6.5,
  hDeg: 3.1,
  active: true,
  movable: true,
  pinnable: true,
  isMosaicOutline: true,
  anchorKind: 'sky',
  ra: 314.7,
  dec: 44.3,
  paDeg: 0,
  anchorLabel: 'Amérique du Nord',
});
const fakeMap = () =>
  ({
    toggleFramePinById: vi.fn(),
    resnapFrame: vi.fn(),
    pinAllFloatingFrames: vi.fn(),
    pinActiveIfFloating: vi.fn(),
    selectFrame: vi.fn(),
    viewCenterSky: vi.fn(() => ({ ra: 1, dec: 2 })),
  }) as unknown as SkyMap;

const byText = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('.mob-row, button, ion-button').find((b) => b.text().includes(text));
/** Hidden by v-show (display: none on the element). */
const hidden = (w: { attributes: (k: string) => string | undefined }) =>
  (w.attributes('style') ?? '').includes('display: none');
const confirmButton = (w: ReturnType<typeof mount>) =>
  w.findAll('ion-button, button').find((b) => b.classes('mob-btn--confirm'))!;

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  showError.mockReset();
  push.mockReset();
});

describe('the sheet of a selected mosaic', () => {
  it('re-tiles a plan mosaic with Lignes and Colonnes, and offers its edit', async () => {
    const fov = withSpecs();
    usePlansStore().plans = [plan({ id: 'p1', setupId: 's1', mosaics: [planMosaic()] as never })];
    const grid = vi.spyOn(fov, 'setMosaicGrid').mockImplementation(() => {});
    const w = mount(SkyFrameSheet, {
      props: { frame: outline('mosaic:p1:mo1'), map: fakeMap() },
      global: { stubs: ionicStubs, provide: mapSheetHost },
    });
    expect(w.find('.mob-sheet-title').text()).toBe('Amérique du Nord · Mosaïque');
    const steppers = w.findAllComponents(PhoneStepperRow);
    expect(steppers.map((s) => [s.props('label'), s.props('modelValue')])).toEqual([
      ['Lignes', 2],
      ['Colonnes', 3],
    ]);
    steppers[0].vm.$emit('update:modelValue', 3);
    expect(grid).toHaveBeenCalledWith('mo1', 3, 3);
    steppers[1].vm.$emit('update:modelValue', 2);
    expect(grid).toHaveBeenLastCalledWith('mo1', 2, 2);
    await byText(w, 'Modifier la mosaïque')!.trigger('click');
    expect(w.emitted('editMosaic')).toEqual([['p1', 'mo1']]);
  });

  it('has the steppers but no edit for a free mosaic, as the desktop', () => {
    const fov = withSpecs();
    fov.adhocMosaics.push({ ...planMosaic(), id: 'fm', setupId: 's1', tiles: [] } as never);
    const w = mount(SkyFrameSheet, {
      props: { frame: outline('mosaic:free:fm'), map: fakeMap() },
      global: { stubs: ionicStubs, provide: mapSheetHost },
    });
    expect(w.findAllComponents(PhoneStepperRow)).toHaveLength(2);
    expect(byText(w, 'Modifier la mosaïque')).toBeUndefined();
  });
});

describe('the stepper row', () => {
  it('steps within its bounds and greys the button at the end', async () => {
    const w = mount(PhoneStepperRow, {
      props: { label: 'Lignes', lessLabel: 'Moins', moreLabel: 'Plus', min: 1, modelValue: 1 },
      global: { stubs: ionicStubs },
    });
    const [less, more] = w.findAll('ion-button, button');
    expect(less.attributes('disabled')).toBeDefined();
    await more.trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([[2]]);
  });
});

describe('Créer une mosaïque', () => {
  const target = { dsoId: 'M31', ra: 10.7, dec: 41.3, name: "Galaxie d'Andromède" };
  const mountPicker = () =>
    mount(SkyFramePicker, {
      props: { open: true, target, kind: 'mosaic' },
      global: { stubs: ionicStubs },
    });

  it('leaves the smart telescopes out, in the plans and the setups', async () => {
    withSpecs();
    usePlansStore().plans = [
      plan({ id: 'p1', name: 'Nuit A', setupId: 's1' }),
      plan({ id: 'p2', name: 'Nuit Seestar', setupId: 'smart' }),
      plan({ id: 'p3', name: 'Nuit sans setup' }),
    ];
    const w = mountPicker();
    await flushPromises();
    expect(w.find('.mob-sheet-title').text()).toBe('Créer une mosaïque');
    expect(byText(w, 'Nuit A')).toBeTruthy();
    expect(byText(w, 'Nuit sans setup')).toBeTruthy();
    expect(byText(w, 'Nuit Seestar')).toBeUndefined();
    expect(byText(w, 'Seestar S50')).toBeUndefined();
  });

  it('makes the quick mosaic in a plan, or free with the setup picked', async () => {
    const fov = withSpecs();
    usePlansStore().plans = [plan({ id: 'p1', name: 'Nuit A', setupId: 's1' })];
    const inPlan = vi.spyOn(fov, 'addAdhocMosaicToPlan').mockResolvedValue('m');
    const free = vi.spyOn(fov, 'addAdhocMosaic').mockImplementation(() => {});
    const w = mountPicker();
    await flushPromises();
    await byText(w, 'Nuit A')!.trigger('click');
    await flushPromises();
    expect(inPlan).toHaveBeenCalledWith('p1', 10.7, 41.3, 'M31');
    expect(w.emitted('plan')).toHaveLength(1);
    await byText(w, 'Askar')!.trigger('click');
    expect(free).toHaveBeenCalledWith('s1', 10.7, 41.3, 'M31');
    expect(w.emitted('free')).toHaveLength(1);
  });

  it('is opened by the object sheet', async () => {
    const dso = {
      id: 'M31',
      ra: 10.7,
      dec: 41.3,
      type: 'G',
      catalogs: ['M31'],
      mag: 3.4,
    } as unknown as DSO;
    const w = mount(SkyObjectSheet, {
      props: { selection: { kind: 'dso', dso } },
      global: { stubs: ionicStubs, provide: mapSheetHost },
    });
    const mosaic = w
      .findAll('ion-button, button')
      .find((b) => b.attributes('aria-label') === 'Ajouter une mosaïque')!;
    await mosaic.trigger('click');
    expect(w.emitted('addMosaic')).toHaveLength(1);
  });
});

describe('the mosaic form', () => {
  const m31 = {
    id: 'M31',
    ra: 10.68,
    dec: 41.27,
    majAxis: 190,
    minAxis: 60,
    pa: 35,
    displayName: "Galaxie d'Andromède",
  } as DSO;

  it('creates a free mosaic covering the object once it has a name', async () => {
    const fov = withSpecs();
    const create = vi.spyOn(fov, 'createAdhocMosaic');
    const w = mount(SkyMosaicSheet, {
      props: { open: true, dest: { kind: 'free', setupId: 's1' }, seed: [m31] },
      global: { stubs: ionicStubs },
    });
    expect(w.find('.mob-sheet-title').text()).toBe('Nouvelle mosaïque');
    expect(w.text()).toContain("Galaxie d'Andromède");
    expect(confirmButton(w).attributes('disabled')).toBeDefined();
    const [cols, rows] = w
      .findAllComponents(PhoneStepperRow)
      .slice(1)
      .map((s) => s.props('modelValue'));
    expect(rows).toBeGreaterThan(cols);
    expect(w.text()).toContain(`${cols}×${rows} · ${cols * rows} tuiles`);
    w.findAllComponents({ name: 'PhoneField' })[0].vm.$emit('update:modelValue', 'M31 large');
    await flushPromises();
    await confirmButton(w).trigger('click');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ setupId: 's1', name: 'M31 large', dsoId: 'M31', cols, rows }),
    );
    expect(create.mock.calls[0][0].tiles).toHaveLength(cols * rows);
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('lists the objects found in place of the other fields and the buttons, above the keyboard', async () => {
    withSpecs();
    const w = mount(SkyMosaicSheet, {
      props: { open: true, dest: { kind: 'free', setupId: 's1' } },
      global: { stubs: ionicStubs },
    });
    const fields = w.findAllComponents({ name: 'PhoneField' });
    fields[1].vm.$emit('update:modelValue', 'M31');
    await new Promise((r) => setTimeout(r, 250));
    await flushPromises();
    expect(hidden(w.find('.mob-sheet-footer'))).toBe(true);
    expect(hidden(fields[0])).toBe(true);
    expect(w.findAllComponents(PhoneStepperRow).every(hidden)).toBe(true);
    await byText(w, 'M31 — Galaxie')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain("Galaxie d'Andromède");
    expect(hidden(w.find('.mob-sheet-footer'))).toBe(false);
    expect(hidden(fields[0])).toBe(false);
  });

  it('opens filled to edit a plan mosaic and saves its grid', async () => {
    withSpecs();
    const plans = usePlansStore();
    plans.plans = [plan({ id: 'p1', setupId: 's1', mosaics: [planMosaic()] as never })];
    const update = vi.spyOn(plans, 'updateMosaic').mockResolvedValue();
    const w = mount(SkyMosaicSheet, {
      props: { open: true, dest: { kind: 'plan', planId: 'p1' }, mosaicId: 'mo1' },
      global: { stubs: ionicStubs },
    });
    expect(w.find('.mob-sheet-title').text()).toBe('Modifier la mosaïque');
    expect(w.findAllComponents(PhoneStepperRow).map((s) => s.props('modelValue'))).toEqual([
      20, 3, 2,
    ]);
    await confirmButton(w).trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith(
      'p1',
      'mo1',
      expect.objectContaining({ name: 'Amérique du Nord', cols: 3, rows: 2, centerRa: 314.7 }),
    );
  });
});

describe('the Setup of a plan in Contours de champ', () => {
  /** The choice of the plan's setup, among the sheet's radio choices. */
  const setupChoice = (w: ReturnType<typeof mount>) =>
    w.findAllComponents({ name: 'PhoneRadioGroup' }).find((r) => r.props('label') === 'Setup')!;
  const mountSheet = () =>
    mount(SkyFramesSheet, { props: { open: true, map: fakeMap() }, global: { stubs: ionicStubs } });

  it('shows the plan setup, and switches at once when no mosaic is touched', async () => {
    const fov = withSpecs();
    const plans = usePlansStore();
    plans.plans = [plan({ id: 'p1', name: 'Nuit A', setupId: 's1' })];
    fov.setSelection({ kind: 'plan', planId: 'p1' });
    const settings = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const w = mountSheet();
    await flushPromises();
    expect(byText(w, 'Setup')!.text()).toContain('Équipement 1 · 2.5° × 1.7°');
    setupChoice(w).vm.$emit('update:modelValue', 's2');
    await flushPromises();
    expect(settings).toHaveBeenCalledWith('p1', undefined, 's2', undefined, undefined);
  });

  it('asks Appliquer or Supprimer for each mosaic first, then applies', async () => {
    const fov = withSpecs();
    const plans = usePlansStore();
    plans.plans = [
      plan({ id: 'p1', name: 'Nuit A', setupId: 's1', mosaics: [planMosaic()] as never }),
    ];
    fov.setSelection({ kind: 'plan', planId: 'p1' });
    const settings = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const update = vi.spyOn(plans, 'updateMosaic').mockResolvedValue();
    vi.spyOn(plans, 'load').mockResolvedValue();
    const w = mountSheet();
    await flushPromises();
    setupChoice(w).vm.$emit('update:modelValue', 's2');
    await flushPromises();
    expect(settings).not.toHaveBeenCalled();
    const sheet = w.findComponent({ name: 'SkySetupSwitchSheet' });
    expect(sheet.text()).toContain('Amérique du Nord');
    const ok = confirmButton(sheet);
    expect(ok.attributes('disabled')).toBeDefined();
    await sheet.findAll('.mob-seg-btn')[0].trigger('click');
    expect(ok.attributes('disabled')).toBeUndefined();
    await ok.trigger('click');
    await flushPromises();
    expect(settings).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      'p1',
      'mo1',
      expect.objectContaining({ cols: expect.any(Number) }),
    );
  });

  it('adds a mosaic only in a plan whose setup tiles', () => {
    const fov = withSpecs();
    usePlansStore().plans = [plan({ id: 'p2', name: 'Nuit Seestar', setupId: 'smart' })];
    fov.setSelection({ kind: 'plan', planId: 'p2' });
    expect(byText(mountSheet(), 'Ajouter une mosaïque')).toBeUndefined();
  });
});
