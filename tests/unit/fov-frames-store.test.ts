import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../../src/api', () => ({
  getGearSetups: vi.fn().mockResolvedValue([
    { id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null, enabled: true },
  ]),
  updatePlanMosaicAPI: vi.fn().mockResolvedValue(undefined),
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
import { framePointToSky } from '../../src/mosaic';

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

  it('addPlanFrame adds a custom-location entry, selects it, and switches to plan mode', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'Tonight', position: 0, nightOf: null, setupId: 's1', entries: [],
    }] as any;
    const spy = vi.spyOn(plans, 'addCustomEntry').mockImplementation(async (planId, ra, dec) => {
      plans.plans.find(p => p.id === planId)!.entries.push(
        { id: 'e-new', dsoId: null, position: 0, paDeg: null, ra, dec, notes: null } as any,
      );
      return 'e-new';
    });

    await store.addPlanFrame('p1', 120, 45);
    expect(spy).toHaveBeenCalledWith('p1', 120, 45);
    expect(store.selection).toEqual({ kind: 'plan', planId: 'p1' });
    expect(store.activeId).toBe('plan:p1:e-new');

    const frame = store.renderables.find(f => f.id === 'plan:p1:e-new')!;
    expect(frame).toBeDefined();
    expect(frame.anchorKind).toBe('sky');
    expect(frame.ra).toBe(120);
    expect(frame.dec).toBe(45);
    expect(frame.dsoId).toBeNull();
    expect(frame.active).toBe(true);
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

  it('framesVisible defaults to true, toggles, persists, and reloads', async () => {
    const store = await withSpecs();
    expect(store.framesVisible).toBe(true);

    store.toggleFramesVisible();
    expect(store.framesVisible).toBe(false);
    expect(localStorage.getItem('fov-frames-visible-v1')).toBe('false');

    store.setFramesVisible(true);
    expect(store.framesVisible).toBe(true);
    expect(localStorage.getItem('fov-frames-visible-v1')).toBe('true');

    // A fresh store reads the persisted value back.
    store.setFramesVisible(false);
    setActivePinia(createPinia());
    const reloaded = useFovFramesStore();
    expect(reloaded.framesVisible).toBe(false);
  });

  it('framesVisible does not alter the frames themselves (map push is gated elsewhere)', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    const before = JSON.parse(localStorage.getItem('fov-frames-v1')!);
    expect(store.renderables.length).toBe(1);
    // Hiding via the master toggle leaves the frame data intact — the popup list
    // still shows them; only the map push is gated by framesVisible.
    store.setFramesVisible(false);
    expect(store.renderables.length).toBe(1);
    expect(JSON.parse(localStorage.getItem('fov-frames-v1')!)).toEqual(before);
  });

  it('hiding frames clears the active selection so nothing is editable', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    expect(store.activeId).not.toBeNull();

    store.setFramesVisible(false);
    expect(store.activeId).toBeNull();
    expect(store.renderables.every(f => f.active === false)).toBe(true);

    // Showing again does not re-select anything.
    store.setFramesVisible(true);
    expect(store.activeId).toBeNull();
  });

  it('toggleFramesVisible deselects the active frame when it hides them', async () => {
    const store = await withSpecs();
    store.addAdhocFrame('s1');
    expect(store.activeId).not.toBeNull();
    store.toggleFramesVisible(); // → hidden
    expect(store.framesVisible).toBe(false);
    expect(store.activeId).toBeNull();
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

  // ── Mosaics (a frame backed by a tile grid) ─────────────────────────────────
  /** A plan with one 2×2 mosaic ('mo1') of M42, tiles on the true step lattice
   * (spec 2.5°×1.7°, 20% overlap → step 2.0°×1.36° → tile offsets ±1.0°, ±0.68°). */
  function withMosaicPlan(store: ReturnType<typeof useFovFramesStore>) {
    const plans = usePlansStore();
    const C = { ra: 83.8, dec: -5.4 };
    const tile = (id: string, gx: number, gy: number) => {
      const p = framePointToSky(C, 0, gx, gy);
      return { id, dsoId: 'M42', position: 0, paDeg: 0, ra: p.ra, dec: p.dec, notes: null, mosaicId: 'mo1' };
    };
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [tile('t0', -1, 0.68), tile('t1', 1, 0.68), tile('t2', -1, -0.68), tile('t3', 1, -0.68)],
      mosaics: [{ id: 'mo1', dsoId: 'M42', centerRa: C.ra, centerDec: C.dec, paDeg: 0, overlapPct: 20, cols: 2, rows: 2, position: 0 }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    return plans;
  }

  it('renders a mosaic as faint tiles plus one selectable, resizable outline frame', async () => {
    const store = await withSpecs();
    withMosaicPlan(store);
    const tiles = store.renderables.filter(f => f.mosaicId === 'mo1');
    expect(tiles).toHaveLength(4);
    const outline = store.renderables.find(f => f.id === 'mosaic:p1:mo1')!;
    expect(outline.isMosaicOutline).toBe(true);
    expect(outline.movable).toBe(true);
    expect(outline.pinnable).toBe(true);   // a mosaic pins/floats like any frame
    expect(outline.resizable).toBe(true);
    expect(outline.anchorKind).toBe('sky');
    expect(outline.ra).toBe(83.8);
    // Outline size encloses the grid: (cols-1)·tile·(1-overlap) + tile.
    expect(outline.wDeg).toBeCloseTo(1 * 2.5 * 0.8 + 2.5, 6); // 4.5
    expect(outline.hDeg).toBeCloseTo(1 * 1.7 * 0.8 + 1.7, 6); // 3.06
  });

  it('selecting the outline marks the mosaic active (mutually exclusive with a single frame)', async () => {
    const store = await withSpecs();
    withMosaicPlan(store);
    store.setActive('mosaic:p1:mo1');
    expect(store.activeMosaicId).toBe('mo1');
    expect(store.activeId).toBeNull();
    expect(store.renderables.find(f => f.id === 'mosaic:p1:mo1')!.active).toBe(true);
    // Selecting something else clears the mosaic selection.
    store.setActive(null);
    expect(store.activeMosaicId).toBeNull();
  });

  it('moving the outline re-centres the whole mosaic and re-tiles', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    store.applyChange('mosaic:p1:mo1', { anchor: { kind: 'sky', ra: 90, dec: 0, dsoId: 'M42' }, paDeg: 10 });
    const mosaic = plans.plans[0].mosaics[0];
    expect(mosaic.centerRa).toBe(90);
    expect(mosaic.centerDec).toBe(0);
    expect(mosaic.paDeg).toBe(10);
    // Still a 2×2 grid → four tiles, regenerated at the new centre.
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(4);
  });

  it('rotating the outline updates only the mosaic PA', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    store.applyChange('mosaic:p1:mo1', { paDeg: 45 });
    expect(plans.plans[0].mosaics[0].paDeg).toBe(45);
    expect(plans.plans[0].mosaics[0].centerRa).toBe(83.8); // unchanged
  });

  it('unpinning the outline floats it (screen-anchored) and hides the tiles', async () => {
    const store = await withSpecs();
    withMosaicPlan(store);
    store.applyChange('mosaic:p1:mo1', { anchor: { kind: 'screen', nx: 0.4, ny: 0.6 }, screenRotationDeg: 0 });
    expect(store.renderables.filter(f => f.mosaicId === 'mo1')).toHaveLength(0); // tiles hidden
    const outline = store.renderables.find(f => f.id === 'mosaic:p1:mo1')!;
    expect(outline.anchorKind).toBe('screen');
    expect(outline.nx).toBe(0.4);
    expect(outline.resizable).toBe(false); // no resize while floating
  });

  it('resizing the outline re-tiles the mosaic to the new region', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    // A 9°×6° region with 2.5°×1.7° tiles at 20% overlap → 5×5 grid.
    store.applyResize('mosaic:p1:mo1', { centerRa: 83.8, centerDec: -5.4, wDeg: 9, hDeg: 6, paDeg: 0 });
    const mosaic = plans.plans[0].mosaics[0];
    expect(mosaic.cols).toBe(5);
    expect(mosaic.rows).toBe(5);
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(25);
  });

  // ── Phase 3b: per-tile editing → non-rectangular mosaics ────────────────────
  it('removeMosaicTile drops the clicked tile', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    store.removeMosaicTile('plan:p1:t0');
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(3);
  });

  it('a move preserves a trimmed (non-rectangular) tile set instead of regridding', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    store.removeMosaicTile('plan:p1:t3'); // trim one corner → 3 tiles
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(3);
    store.transformMosaic('mo1', { centerRa: 90, centerDec: 0 });
    expect(plans.plans[0].mosaics[0].centerRa).toBe(90);
    // The trim survived the move — still 3 tiles, not regenerated to a full 2×2.
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(3);
  });

  it('a resize re-grids to a full rectangle (resets any trimming)', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store);
    store.removeMosaicTile('plan:p1:t3'); // 3 tiles
    store.applyResize('mosaic:p1:mo1', { centerRa: 83.8, centerDec: -5.4, wDeg: 4.5, hDeg: 3.06, paDeg: 0 });
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(4);
  });

  it('recentres the mosaic on its remaining tiles when an edge row is trimmed', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    const C = { ra: 80, dec: 0 };
    // 1 col × 2 rows: tiles half a step (1.7°·0.8/2 = 0.68°) above/below the centre.
    const top = framePointToSky(C, 0, 0, 0.68);
    const bottom = framePointToSky(C, 0, 0, -0.68);
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [
        { id: 't0', dsoId: 'M42', position: 0, paDeg: 0, ra: top.ra, dec: top.dec, notes: null, mosaicId: 'mo1' },
        { id: 't1', dsoId: 'M42', position: 1, paDeg: 0, ra: bottom.ra, dec: bottom.dec, notes: null, mosaicId: 'mo1' },
      ],
      mosaics: [{ id: 'mo1', dsoId: 'M42', centerRa: 80, centerDec: 0, paDeg: 0, overlapPct: 20, cols: 1, rows: 2, position: 0 }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });

    store.removeMosaicTile('plan:p1:t0'); // trim the top row
    const m = plans.plans[0].mosaics[0];
    expect(m.rows).toBe(1);
    expect(m.cols).toBe(1);
    // The centre must move to the remaining (bottom) tile — not stay at dec 0,
    // which would leave the shrunken outline shifted off the tiles.
    expect(m.centerDec).toBeCloseTo(bottom.dec, 6);
    expect(m.centerRa).toBeCloseTo(bottom.ra, 6);
  });

  it('offers add-tile candidates around the selected mosaic and adds one', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store); // 2×2 mosaic 'mo1'
    store.setActiveMosaic('mo1');
    // A 2×2 block has 8 empty perimeter neighbours.
    expect(store.activeMosaicAddCandidates).toHaveLength(8);
    const before = plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1').length;
    const spot = store.activeMosaicAddCandidates[0];
    store.addMosaicTile(spot.ra, spot.dec);
    expect(plans.plans[0].entries.filter((e: any) => e.mosaicId === 'mo1')).toHaveLength(before + 1);
  });

  it('add-tile candidates are empty while the mosaic floats', async () => {
    const store = await withSpecs();
    withMosaicPlan(store);
    store.setActiveMosaic('mo1');
    store.applyChange('mosaic:p1:mo1', { anchor: { kind: 'screen', nx: 0.5, ny: 0.5 }, screenRotationDeg: 0 });
    expect(store.activeMosaicAddCandidates).toHaveLength(0);
  });

  it('merges a dropped frame into a mosaic as a snapped tile and deletes the frame', async () => {
    const store = await withSpecs();
    const plans = withMosaicPlan(store); // mo1: 2×2 at (83.8, -5.4)
    const F = framePointToSky({ ra: 83.8, dec: -5.4 }, 0, 3, 0.68); // one step right of the grid
    plans.plans[0].entries.push({ id: 'fr', dsoId: null, position: 9, paDeg: 0, ra: F.ra, dec: F.dec, notes: null, mosaicId: null });
    const spy = vi.spyOn(plans, 'updateMosaic').mockResolvedValue();
    await store.mergeOnDrop('plan:p1:fr', 'mosaic:p1:mo1');
    expect(spy).toHaveBeenCalledTimes(1);
    const [pid, mid, params] = spy.mock.calls[0] as any;
    expect(pid).toBe('p1');
    expect(mid).toBe('mo1');
    expect(params.replaceEntryIds).toEqual(['fr']);
    expect(params.tiles).toHaveLength(5); // four tiles + the absorbed frame
  });

  it('merges two overlapping frames into a new two-tile mosaic and deletes both', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    const G = { ra: 80, dec: 0 };
    const F = framePointToSky(G, 0, 1.5, 0); // dropped to the right of G
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [
        { id: 'g', dsoId: 'M42', position: 0, paDeg: 0, ra: G.ra, dec: G.dec, notes: null, mosaicId: null },
        { id: 'f', dsoId: null, position: 1, paDeg: 0, ra: F.ra, dec: F.dec, notes: null, mosaicId: null },
      ],
      mosaics: [],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'createMosaic').mockResolvedValue('mo-new');
    await store.mergeOnDrop('plan:p1:f', 'plan:p1:g');
    expect(spy).toHaveBeenCalledTimes(1);
    const [pid, params] = spy.mock.calls[0] as any;
    expect(pid).toBe('p1');
    expect(params.tiles).toHaveLength(2);
    expect([...params.replaceEntryIds].sort()).toEqual(['f', 'g']);
  });

  it('removing the last tile deletes the whole mosaic', async () => {
    const store = await withSpecs();
    const plans = usePlansStore();
    plans.plans = [{
      id: 'p1', name: 'T', position: 0, nightOf: null, setupId: 's1',
      entries: [{ id: 't0', dsoId: 'M42', position: 0, paDeg: 0, ra: 83.8, dec: -5.4, notes: null, mosaicId: 'mo1' }],
      mosaics: [{ id: 'mo1', dsoId: 'M42', centerRa: 83.8, centerDec: -5.4, paDeg: 0, overlapPct: 20, cols: 1, rows: 1, position: 0 }],
    }] as any;
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'deleteMosaic').mockResolvedValue();
    store.removeMosaicTile('plan:p1:t0');
    expect(spy).toHaveBeenCalledWith('p1', 'mo1');
  });
});
