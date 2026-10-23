import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Keep the heavy gear/catalog modules out of the flow under test; the mosaic
// math is real (pure functions) so the transform proposals are exercised.
vi.mock('@myastrosky/core/gear-presets', () => ({
  formatFov: vi.fn().mockReturnValue('5.0° × 3.0°'),
}));
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  getDSOById: vi.fn((id: string) =>
    id === 'M42' ? { id: 'M42', ra: 83.8, dec: -5.4, displayName: 'Orion Nebula' } : undefined,
  ),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { requestSetupSwitch } from '../../src/setup-switch';
import { commitSetupSwitch, setupSwitchItems } from '@myastrosky/app-state/setup-switch';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';

type SpecLite = {
  name: string;
  label: string;
  wDeg: number;
  hDeg: number;
  smart: boolean;
  mosaic: null;
};
const spec = (wDeg: number, hDeg: number): SpecLite => ({
  name: 's',
  label: 's',
  wDeg,
  hDeg,
  smart: false,
  mosaic: null,
});

function seedPlan(setupId: string | null, opts: { entries?: any[]; mosaics?: any[] } = {}) {
  const plans = usePlansStore();
  const plan = {
    id: 'p1',
    name: 'Tonight',
    position: 0,
    nightOf: null,
    setupId,
    lat: null,
    lon: null,
    entries: opts.entries ?? [],
    mosaics: opts.mosaics ?? [],
  };
  (plans as any).plans = [plan];
  (plans as any).loaded = true;
  return plan;
}

/** Seed both setups' specs and stop loadSpecs from overwriting them. */
function seedSpecs() {
  const fov = useFovFramesStore();
  (fov as any).specs = new Map([
    ['s1', spec(2.5, 1.7)],
    ['s2', spec(1.2, 0.8)],
  ]);
  vi.spyOn(fov, 'loadSpecs').mockResolvedValue();
  return fov;
}

const hooks = () => ({ onRevert: vi.fn(), onApplied: vi.fn() });

describe('requestSetupSwitch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('is a no-op when the setup is unchanged', async () => {
    const plan = seedPlan('s1');
    const plans = usePlansStore();
    const spy = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const h = hooks();

    await requestSetupSwitch(plan as any, 's1', h);

    expect(spy).not.toHaveBeenCalled();
    expect(h.onApplied).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  it('persists directly (no modal) when the plan has no mosaics', async () => {
    const plan = seedPlan('s1', {
      entries: [
        {
          id: 'e1',
          dsoId: 'M42',
          position: 0,
          paDeg: null,
          ra: null,
          dec: null,
          notes: null,
          mosaicId: null,
          mosaicWDeg: null,
          mosaicHDeg: null,
        },
      ],
    });
    seedSpecs();
    const plans = usePlansStore();
    const spy = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const h = hooks();

    await requestSetupSwitch(plan as any, 's2', h);
    await new Promise((r) => setTimeout(r)); // loadSpecs().then(onApplied)

    expect(spy).toHaveBeenCalledWith('p1', null, 's2', null, null);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
    expect(h.onApplied).toHaveBeenCalled();
  });

  it('opens the confirmation modal (and does not persist yet) when a mosaic is affected', async () => {
    const mosaic = {
      id: 'm1',
      dsoId: 'M42',
      name: null,
      centerRa: 83.8,
      centerDec: -5.4,
      paDeg: 0,
      overlapPct: 20,
      cols: 2,
      rows: 1,
      tiles: [],
    };
    const plan = seedPlan('s1', { mosaics: [mosaic] });
    seedSpecs();
    const plans = usePlansStore();
    const spy = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const h = hooks();

    await requestSetupSwitch(plan as any, 's2', h);

    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    expect(spy).not.toHaveBeenCalled(); // switch deferred until the user decides
    expect(h.onApplied).not.toHaveBeenCalled();
  });

  it('reverts the host dropdown when the modal is cancelled', async () => {
    const mosaic = {
      id: 'm1',
      dsoId: 'M42',
      name: null,
      centerRa: 83.8,
      centerDec: -5.4,
      paDeg: 0,
      overlapPct: 20,
      cols: 2,
      rows: 1,
      tiles: [],
    };
    const plan = seedPlan('s1', { mosaics: [mosaic] });
    seedSpecs();
    const h = hooks();

    await requestSetupSwitch(plan as any, 's2', h);
    const cancel = document.querySelector('.modal-footer .btn-cancel') as HTMLButtonElement;
    cancel.click();

    expect(h.onRevert).toHaveBeenCalled();
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });
});

const m42Mosaic = () => ({
  id: 'm1',
  dsoId: 'M42',
  name: null,
  centerRa: 83.8,
  centerDec: -5.4,
  paDeg: 0,
  overlapPct: 20,
  cols: 2,
  rows: 1,
  tiles: [],
});

describe('setupSwitchItems / commitSetupSwitch (shared part)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('proposes a re-grid named after the mosaic target onto a smaller setup', async () => {
    const plan = seedPlan('s1', { mosaics: [m42Mosaic()] });
    seedSpecs();
    const items = await setupSwitchItems(plan as any, 's2');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Orion Nebula');
    // A 2×1 grid of 2.5° × 1.7° tiles re-fitted with 1.2° × 0.8° tiles needs more of them.
    expect(items[0].transform.kind).toBe('grid');
  });

  it('asks nothing when the setup is cleared or unchanged', async () => {
    const plan = seedPlan('s1', { mosaics: [m42Mosaic()] });
    seedSpecs();
    expect(await setupSwitchItems(plan as any, null)).toEqual([]);
    expect(await setupSwitchItems(plan as any, 's1')).toEqual([]);
  });

  it('saves the new setup first, then applies or drops each mosaic as decided', async () => {
    const plan = seedPlan('s1', { mosaics: [m42Mosaic(), { ...m42Mosaic(), id: 'm2' }] });
    seedSpecs();
    const plans = usePlansStore();
    const calls: string[] = [];
    vi.spyOn(plans, 'updatePlanSettings').mockImplementation(async () => {
      calls.push('settings');
    });
    vi.spyOn(plans, 'updateMosaic').mockImplementation(async (_p, id) => {
      calls.push(`update:${id}`);
    });
    vi.spyOn(plans, 'deleteMosaic').mockImplementation(async (_p, id) => {
      calls.push(`delete:${id}`);
    });
    vi.spyOn(plans, 'load').mockResolvedValue();
    const items = await setupSwitchItems(plan as any, 's2');
    await commitSetupSwitch(plan as any, 's2', items, new Map([['mosaic:m2', 'drop' as const]]));
    expect(calls).toEqual(['settings', 'update:m1', 'delete:m2']);
  });
});
