import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../../src/api', () => ({
  getGearSetups: vi.fn().mockResolvedValue([
    { id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null, enabled: true },
  ]),
}));

vi.mock('../../src/gear-catalog', () => ({
  getTelescopes: vi.fn().mockResolvedValue([{ id: 't1', focal_length_mm: 500, aperture_mm: 80 }]),
  getCameras: vi.fn().mockResolvedValue([{ id: 'c1', sensor_width_mm: 23, sensor_height_mm: 15, pixel_size_um: 3.8, color_type: 'OSC' }]),
  getAccessories: vi.fn().mockResolvedValue([]),
  buildGearPreset: vi.fn().mockReturnValue({ focalLengthMm: 500, sensorWidthMm: 23, sensorHeightMm: 15 }),
}));

vi.mock('../../src/gear-presets', () => ({
  fovDeg: vi.fn().mockReturnValue({ wDeg: 2.5, hDeg: 1.7 }),
  formatSetupCanvasLabel: vi.fn().mockReturnValue('Setup 1 · 2.5° × 1.7°'),
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOById: vi.fn((id: string) => (id === 'M42' ? { id: 'M42', ra: 83.8, dec: -5.4 } : undefined)),
}));

vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { useFovFramesStore } from '../../src/stores/fov-frames';
import { usePlansStore } from '../../src/stores/plans';

describe('fov-frames store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  async function withSpecs() {
    const store = useFovFramesStore();
    await store.loadSpecs();
    return store;
  }

  it('addAdhocFrame creates a floating, active, movable frame', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    expect(store.renderables.length).toBe(1);
    const f = store.renderables[0];
    expect(f.active).toBe(true);
    expect(f.movable).toBe(true);
    expect(f.anchorKind).toBe('screen');
    expect(f.label).toContain('Setup 1');
    // persisted
    expect(JSON.parse(localStorage.getItem('fov-frames-v1')!).length).toBe(1);
  });

  it('keeps only one active frame', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    store.addAdhocFrame('s1');
    const active = store.renderables.filter(f => f.active);
    expect(active.length).toBe(1);
    expect(store.renderables.length).toBe(2);
  });

  it('derives a movable, sky-anchored frame per plan entry when that plan is selected', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'Tonight', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: 142, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });

    const frame = store.renderables.find(f => f.id === 'plan:p1:e1');
    expect(frame).toBeDefined();
    expect(frame!.movable).toBe(true);
    expect(frame!.pinnable).toBe(true);
    expect(frame!.derivesTargetFromContent).toBe(true);
    expect(frame!.anchorKind).toBe('sky');
    expect(frame!.ra).toBeCloseTo(83.8);
    expect(frame!.paDeg).toBe(142);
    expect(frame!.dsoId).toBe('M42');
  });

  it('uses the entry ra/dec override as the frame centre when present', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: 100, dec: 30, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const frame = store.renderables.find(f => f.id === 'plan:p1:e1')!;
    expect(frame.ra).toBe(100);
    expect(frame.dec).toBe(30);
  });

  it('scopes renderables to the current selection (free vs plan)', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }],
    }] as any;

    // Free mode (default): only ad-hoc frames, no plan frames.
    store.addAdhocFrame('s1');
    expect(store.renderables.some(f => f.id.startsWith('plan:'))).toBe(false);
    expect(store.renderables.length).toBe(1);

    // Plan mode: only that plan's frames.
    store.setSelection({ kind: 'plan', planId: 'p1' });
    expect(store.renderables.map(f => f.id)).toEqual(['plan:p1:e1']);
  });

  it('moving a plan frame forwards position + derived dso to the plans store', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'setEntryPosition').mockImplementation(() => {});

    // A move that lands on empty sky (dsoId null) → custom location.
    store.applyChange('plan:p1:e1', { anchor: { kind: 'sky', ra: 12, dec: 34, dsoId: null } });
    expect(spy).toHaveBeenCalledWith('p1', 'e1', { ra: 12, dec: 34, dsoId: null });

    // A move that lands on another object → adopts it.
    store.applyChange('plan:p1:e1', { anchor: { kind: 'sky', ra: 56, dec: 78, dsoId: 'M31' } });
    expect(spy).toHaveBeenCalledWith('p1', 'e1', { ra: 56, dec: 78, dsoId: 'M31' });
  });

  it('rotating a plan frame writes PA back via setEntryPosition', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'setEntryPosition').mockImplementation(() => {});

    store.applyChange('plan:p1:e1', { paDeg: 200 });
    expect(spy).toHaveBeenCalledWith('p1', 'e1', { paDeg: 200 });
  });

  it('unpinning a plan frame holds floating state; re-pinning writes through', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });

    // Unpin → transient floating (screen) state, not persisted to the plan.
    store.applyChange('plan:p1:e1', { anchor: { kind: 'screen', nx: 0.4, ny: 0.6 }, screenRotationDeg: 12 });
    const floating = store.renderables.find(f => f.id === 'plan:p1:e1')!;
    expect(floating.anchorKind).toBe('screen');
    expect(floating.nx).toBe(0.4);
    expect(floating.screenRotationDeg).toBe(12);
    expect(JSON.parse(localStorage.getItem('fov-plan-floating-v1')!)['plan:p1:e1'].ny).toBe(0.6);

    // Re-pin → writes position + PA back and clears the floating state.
    const spy = vi.spyOn(plans, 'setEntryPosition').mockImplementation(() => {});
    store.applyChange('plan:p1:e1', { anchor: { kind: 'sky', ra: 1, dec: 2, dsoId: 'M42' }, paDeg: 30 });
    expect(spy).toHaveBeenCalledWith('p1', 'e1', { ra: 1, dec: 2, dsoId: 'M42', paDeg: 30 });
    expect(store.renderables.find(f => f.id === 'plan:p1:e1')!.anchorKind).toBe('sky');
  });

  it('deletePlanFrame removes the entry, clears floating + active', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    store.applyChange('plan:p1:e1', { anchor: { kind: 'screen', nx: 0.5, ny: 0.5 } });
    store.setActive('plan:p1:e1');
    const spy = vi.spyOn(plans, 'removeEntry').mockResolvedValue();

    await store.deletePlanFrame('plan:p1:e1');
    expect(spy).toHaveBeenCalledWith('p1', 'e1');
    expect(store.activeId).toBeNull();
    expect(JSON.parse(localStorage.getItem('fov-plan-floating-v1')!)['plan:p1:e1']).toBeUndefined();
  });

  it('pins/unpins an ad-hoc frame via applyChange anchor', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    store.applyChange(id, { anchor: { kind: 'sky', ra: 10, dec: 20, dsoId: 'M42' } });
    const f = store.renderables.find(x => x.id === id)!;
    expect(f.anchorKind).toBe('sky');
    expect(f.ra).toBe(10);
  });

  it('removeFrame deletes an ad-hoc frame and clears active', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    store.removeFrame(id);
    expect(store.renderables.length).toBe(0);
    expect(store.activeId).toBeNull();
  });

  it('nudgeRotation wraps a floating frame into [-180, 180]', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    store.nudgeRotation(id, 200); // 0 + 200 → -160 after wrap
    const f = store.renderables.find(x => x.id === id)!;
    expect(f.screenRotationDeg).toBe(-160);
  });

  it('nudgeRotation on a plan frame writes wrapped PA back via setEntryPosition', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: 350, ra: null, dec: null, notes: null }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'setEntryPosition').mockImplementation(() => {});
    store.nudgeRotation('plan:p1:e1', 20); // 350 + 20 → 10
    expect(spy).toHaveBeenCalledWith('p1', 'e1', { paDeg: 10 });
  });

  it('hides/shows free frames on the map and persists, defaulting to visible', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const a = store.activeId!;
    store.addAdhocFrame('s1');
    const b = store.activeId!;

    // Default: both visible.
    expect(store.renderables.find(f => f.id === a)!.visible).toBe(true);

    // Hide one → its renderable is not visible, and it loses active.
    store.setAdhocVisible(a, false);
    expect(store.isAdhocVisible(a)).toBe(false);
    expect(store.renderables.find(f => f.id === a)!.visible).toBe(false);
    expect(JSON.parse(localStorage.getItem('fov-frame-hidden-v1')!)[a]).toBe(true);

    // Select-all show / hide.
    store.setAllAdhocVisible(false);
    expect(store.renderables.every(f => f.visible === false)).toBe(true);
    expect(store.activeId).toBeNull(); // hiding the active free frame deselects it
    store.setAllAdhocVisible(true);
    expect(store.renderables.every(f => f.visible === true)).toBe(true);
    expect(JSON.parse(localStorage.getItem('fov-frame-hidden-v1')!)[b]).toBeUndefined();
  });

  it('toggleAnchorSnap flips and persists per-frame anchor state', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    expect(store.isAnchorSnapOn(id)).toBe(true); // default on
    store.toggleAnchorSnap(id);
    expect(store.isAnchorSnapOn(id)).toBe(false);
    expect(store.renderables.find(f => f.id === id)!.anchorSnap).toBe(false);
    expect(JSON.parse(localStorage.getItem('fov-anchor-snap-v1')!)[id]).toBe(false);
  });

  it('resetRotation zeroes an ad-hoc frame rotation', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    store.applyChange(id, { screenRotationDeg: 33 });
    store.resetRotation(id);
    const f = store.renderables.find(x => x.id === id)!;
    expect(f.screenRotationDeg).toBe(0);
  });
});
