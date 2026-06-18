import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RenderableFrame, FovFrameChange, FovFrameResizeRegion } from '../sky-map';
import { planGrid, tileCenters } from '../mosaic';
import { getGearSetups, updatePlanMosaicAPI } from '../api';
import { getTelescopes, getCameras, getAccessories, buildGearPreset } from '../gear-catalog';
import { fovDeg, formatSetupCanvasLabel } from '../gear-presets';
import { getDSOById } from '../dso-catalog';
import { usePlansStore } from './plans';
import { orderPlanEntryIds } from '../plan-order';
import { reportUnknownRendererError } from '../error-reporter';

/** Resolved angular size + labels for a gear setup. */
interface SetupSpec { name: string; label: string; wDeg: number; hDeg: number; }

type FrameAnchor =
  | { kind: 'screen'; nx: number; ny: number }
  | { kind: 'sky'; ra: number; dec: number; dsoId: string | null };

/** An ad-hoc (not plan-derived) frame instance, persisted to localStorage. */
interface AdhocFrame {
  id: string;
  setupId: string;
  anchor: FrameAnchor;
  /** Meaning depends on anchor: floating → screen rotation (deg); pinned → PA (°E of N). */
  rotationDeg: number;
}

const STORE_KEY = 'fov-frames-v1';
const SELECTION_KEY = 'fov-frame-selection-v1';
const ANCHOR_SNAP_KEY = 'fov-anchor-snap-v1';
const PLAN_FLOATING_KEY = 'fov-plan-floating-v1';
const HIDDEN_KEY = 'fov-frame-hidden-v1';
const FRAMES_VISIBLE_KEY = 'fov-frames-visible-v1';

/** Transient screen-anchored state for a plan frame that's been unpinned. */
interface PlanFloating { nx: number; ny: number; rotationDeg: number; }

/** Which set of frames the manager is showing: free (ad-hoc) or one plan. */
export type FovSelection = { kind: 'free' } | { kind: 'plan'; planId: string };

function genId(): string {
  return `adhoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadAdhoc(): AdhocFrame[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSelection(): FovSelection {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === 'plan' && typeof parsed.planId === 'string') return parsed;
    }
  } catch { /* ignore */ }
  return { kind: 'free' };
}

function loadAnchorSnap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ANCHOR_SNAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
    }
  } catch { /* ignore */ }
  return {};
}

function loadPlanFloating(): Record<string, PlanFloating> {
  try {
    const raw = localStorage.getItem(PLAN_FLOATING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, PlanFloating>;
    }
  } catch { /* ignore */ }
  return {};
}

function loadHidden(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
    }
  } catch { /* ignore */ }
  return {};
}

/** Global master toggle for drawing frames on the map (defaults to visible). */
function loadFramesVisible(): boolean {
  try {
    return localStorage.getItem(FRAMES_VISIBLE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Source of truth for interactive FOV frames on the sky map. Plan-derived frames
 * are reactive projections of the plans store (one pinned frame per entry of any
 * plan that has a gear setup); ad-hoc frames are user-created and persisted
 * locally. Exactly one frame is "active" (manipulable) at a time.
 */
export const useFovFramesStore = defineStore('fovFrames', () => {
  const plansStore = usePlansStore();

  const adhoc = ref<AdhocFrame[]>(loadAdhoc());
  const activeId = ref<string | null>(null);
  // The selected mosaic (group), mutually exclusive with a single active frame.
  const activeMosaicId = ref<string | null>(null);
  // Mosaics temporarily unpinned to floating (transient screen state, keyed by
  // mosaic id) — pin/float works just like a single frame. While floating the
  // outline is screen-anchored and the tiles are hidden until it's re-pinned.
  const mosaicFloating = ref<Record<string, PlanFloating>>({});
  const specs = ref<Map<string, SetupSpec>>(new Map());
  // Per-mosaic debounce timers so a group drag coalesces into one persist.
  const mosaicWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const selection = ref<FovSelection>(loadSelection());
  // Per-frame "snap to nearest DSO when pinning" toggle (id → on/off), persisted.
  const anchorSnap = ref<Record<string, boolean>>(loadAnchorSnap());
  // Plan frames temporarily unpinned to floating (transient editing state).
  const planFloating = ref<Record<string, PlanFloating>>(loadPlanFloating());
  // Ad-hoc (free) frames hidden from the map (id → true), persisted.
  const adhocHidden = ref<Record<string, boolean>>(loadHidden());
  // Global master toggle: when false, no frames are drawn on the map (selection
  // is preserved so toggling back on restores everything). Persisted.
  const framesVisible = ref<boolean>(loadFramesVisible());

  function persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(adhoc.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist', err);
    }
  }

  function persistSelection(): void {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(selection.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist_selection', err);
    }
  }

  function persistAnchorSnap(): void {
    try {
      localStorage.setItem(ANCHOR_SNAP_KEY, JSON.stringify(anchorSnap.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist_anchor', err);
    }
  }

  function persistPlanFloating(): void {
    try {
      localStorage.setItem(PLAN_FLOATING_KEY, JSON.stringify(planFloating.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist_plan_floating', err);
    }
  }

  function persistHidden(): void {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(adhocHidden.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist_hidden', err);
    }
  }

  function persistFramesVisible(): void {
    try {
      localStorage.setItem(FRAMES_VISIBLE_KEY, JSON.stringify(framesVisible.value));
    } catch (err) {
      reportUnknownRendererError('fov_frames_persist_visible', err);
    }
  }

  /** Show/hide all frames on the map at once (global master toggle). */
  function setFramesVisible(v: boolean): void {
    framesVisible.value = v;
    // Hidden frames can't be selected or edited, so drop the active selection.
    if (!v) activeId.value = null;
    persistFramesVisible();
  }

  function toggleFramesVisible(): void {
    setFramesVisible(!framesVisible.value);
  }

  /** Whether a free frame is shown on the map (defaults to visible). */
  function isAdhocVisible(id: string): boolean {
    return !adhocHidden.value[id];
  }

  /** Show/hide a single free frame on the map. */
  function setAdhocVisible(id: string, visible: boolean): void {
    const next = { ...adhocHidden.value };
    if (visible) delete next[id]; else next[id] = true;
    adhocHidden.value = next;
    if (!visible && activeId.value === id) activeId.value = null; // can't edit a hidden frame
    persistHidden();
  }

  /** Show/hide every free frame at once (the select-all checkbox). */
  function setAllAdhocVisible(visible: boolean): void {
    if (visible) {
      adhocHidden.value = {};
    } else {
      const next: Record<string, boolean> = {};
      for (const f of adhoc.value) next[f.id] = true;
      adhocHidden.value = next;
      if (activeId.value && adhoc.value.some(f => f.id === activeId.value)) activeId.value = null;
    }
    persistHidden();
  }

  function setSelection(s: FovSelection): void {
    selection.value = s;
    activeId.value = null;
    activeMosaicId.value = null;
    persistSelection();
  }

  /** Per-frame anchor-snap state (defaults to on). */
  function isAnchorSnapOn(id: string): boolean {
    return anchorSnap.value[id] ?? true;
  }

  function toggleAnchorSnap(id: string): void {
    anchorSnap.value = { ...anchorSnap.value, [id]: !isAnchorSnapOn(id) };
    persistAnchorSnap();
  }

  /** Resolve the angular size + label of every gear setup (call after gear edits). */
  async function loadSpecs(): Promise<void> {
    try {
      const [setups, tels, cams, accs] = await Promise.all([
        getGearSetups(), getTelescopes(), getCameras(), getAccessories(),
      ]);
      const m = new Map<string, SetupSpec>();
      for (const s of setups) {
        const tel = tels.find(t => t.id === s.telescopeId);
        const cam = cams.find(c => c.id === s.cameraId);
        const acc = s.accessoryId ? accs.find(a => a.id === s.accessoryId) ?? null : null;
        if (!tel || !cam) continue;
        const preset = buildGearPreset(tel, cam, acc);
        const { wDeg, hDeg } = fovDeg(preset);
        m.set(s.id, { name: s.name, label: formatSetupCanvasLabel(s.name, wDeg, hDeg), wDeg, hDeg });
      }
      specs.value = m;
    } catch (err) {
      reportUnknownRendererError('fov_frames_load_specs', err);
    }
  }

  /**
   * Frames resolved for rendering, scoped to the current selection:
   *  - free → ad-hoc frames (movable + pinnable);
   *  - plan → that plan's entries (movable, sky-anchored, rotate + reposition;
   *    target DSO derived from frame content on move). A plan needs a gear setup
   *    to size its frames; without one it renders nothing (the popup hints).
   */
  const renderables = computed<RenderableFrame[]>(() => {
    const out: RenderableFrame[] = [];

    if (selection.value.kind === 'plan') {
      const plan = plansStore.plans.find(p => p.id === (selection.value as { planId: string }).planId);
      if (!plan || !plan.setupId) return out;
      const spec = specs.value.get(plan.setupId);
      if (!spec) return out;

      // Standalone frames (one per target) and mosaic tiles render differently:
      // standalone frames are individually movable; mosaic tiles render as a
      // read-only group (Phase 1) tagged with their mosaic id.
      const standalone = plan.entries.filter(e => !e.mosaicId);
      const tiles = plan.entries.filter(e => e.mosaicId);

      // Resolve each standalone entry to a frame centre, then order them exactly
      // like the "Targets & Plan" tab (transit time, earliest culmination first).
      const placeable = standalone
        .map(entry => {
          const dso = entry.dsoId ? getDSOById(entry.dsoId) : undefined;
          const ra = entry.ra ?? dso?.ra;
          const dec = entry.dec ?? dso?.dec;
          if (ra == null || dec == null) return null;
          return { entry, dso, ra, dec };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const order = orderPlanEntryIds(placeable.map(p => ({ id: p.entry.id, ra: p.ra, dec: p.dec })), plan.nightOf);
      placeable.sort((a, b) => order.indexOf(a.entry.id) - order.indexOf(b.entry.id));

      for (const { entry, dso, ra, dec } of placeable) {
        const id = `plan:${plan.id}:${entry.id}`;
        const base = {
          id, name: spec.name, label: spec.label, wDeg: spec.wDeg, hDeg: spec.hDeg,
          active: id === activeId.value, movable: true, pinnable: true, resizable: true,
          derivesTargetFromContent: true, dsoId: entry.dsoId ?? null,
          anchorLabel: dso ? (dso.displayName ?? dso.id) : null,
          anchorSnap: isAnchorSnapOn(id),
        };
        const floating = planFloating.value[id];
        if (floating) {
          out.push({ ...base, anchorKind: 'screen', nx: floating.nx, ny: floating.ny, screenRotationDeg: floating.rotationDeg });
        } else {
          out.push({ ...base, anchorKind: 'sky', ra, dec, paDeg: entry.paDeg });
        }
      }

      // Each mosaic renders as faint read-only tiles plus one selectable,
      // movable/rotatable/resizable outline frame (sized to enclose the grid) —
      // so a mosaic behaves like a single frame. Interactions on the outline are
      // routed to mosaic ops by its `mosaic:` id.
      for (const entry of tiles) {
        if (entry.ra == null || entry.dec == null) continue;
        if (mosaicFloating.value[entry.mosaicId!]) continue; // hidden while its mosaic floats
        out.push({
          id: `plan:${plan.id}:${entry.id}`,
          name: spec.name, label: spec.label, wDeg: spec.wDeg, hDeg: spec.hDeg,
          active: false, movable: false, pinnable: false, derivesTargetFromContent: false,
          anchorKind: 'sky', ra: entry.ra, dec: entry.dec, paDeg: entry.paDeg,
          mosaicId: entry.mosaicId,
        });
      }
      for (const mosaic of plan.mosaics ?? []) {
        const id = `mosaic:${plan.id}:${mosaic.id}`;
        const dso = mosaic.dsoId ? getDSOById(mosaic.dsoId) : undefined;
        const f = 1 - mosaic.overlapPct / 100;
        const wDeg = (mosaic.cols - 1) * spec.wDeg * f + spec.wDeg;
        const hDeg = (mosaic.rows - 1) * spec.hDeg * f + spec.hDeg;
        // A mosaic is a frame: movable, pinnable, rotatable, resizable. Its outline
        // encloses the grid; interactions route to mosaic ops by id.
        const base = {
          id, name: dso ? (dso.displayName ?? dso.id) : spec.name,
          label: spec.label, wDeg, hDeg,
          active: mosaic.id === activeMosaicId.value,
          movable: true, pinnable: true, isMosaicOutline: true,
          derivesTargetFromContent: true, anchorSnap: isAnchorSnapOn(id),
          dsoId: mosaic.dsoId, anchorLabel: dso ? (dso.displayName ?? dso.id) : null,
        };
        const floating = mosaicFloating.value[mosaic.id];
        if (floating) {
          out.push({ ...base, resizable: false, anchorKind: 'screen', nx: floating.nx, ny: floating.ny, screenRotationDeg: floating.rotationDeg });
        } else {
          out.push({ ...base, resizable: true, anchorKind: 'sky', ra: mosaic.centerRa, dec: mosaic.centerDec, paDeg: mosaic.paDeg });
        }
      }
      return out;
    }

    for (const f of adhoc.value) {
      const spec = specs.value.get(f.setupId);
      if (!spec) continue;
      const base = {
        id: f.id, name: spec.name, label: spec.label, wDeg: spec.wDeg, hDeg: spec.hDeg,
        active: f.id === activeId.value, movable: true, pinnable: true,
        anchorSnap: isAnchorSnapOn(f.id), visible: isAdhocVisible(f.id),
      };
      if (f.anchor.kind === 'sky') {
        const dso = f.anchor.dsoId ? getDSOById(f.anchor.dsoId) : undefined;
        out.push({
          ...base, anchorKind: 'sky', ra: f.anchor.ra, dec: f.anchor.dec, paDeg: f.rotationDeg,
          dsoId: f.anchor.dsoId, anchorLabel: dso ? (dso.displayName ?? dso.id) : null,
        });
      } else {
        out.push({ ...base, anchorKind: 'screen', nx: f.anchor.nx, ny: f.anchor.ny, screenRotationDeg: f.rotationDeg });
      }
    }

    return out;
  });

  function setActive(id: string | null): void {
    // A mosaic outline frame routes selection to the mosaic, not a single frame.
    if (id && id.startsWith('mosaic:')) { setActiveMosaic(id.split(':')[2] ?? null); return; }
    activeId.value = id;
    activeMosaicId.value = null; // a single frame and a mosaic can't both be selected
  }

  /** Select a mosaic (or clear with null). Deselects any single frame. */
  function setActiveMosaic(id: string | null): void {
    activeMosaicId.value = id;
    if (id) activeId.value = null;
  }

  /**
   * Re-lay a mosaic's tiles from its current record (optimistic local update so
   * the map follows a drag live), then debounce-persist the regenerated tiles —
   * mirroring the per-entry drag coalescing. Shared by move/rotate and resize.
   */
  function retileAndPersist(planId: string, mosaicId: string): void {
    const plan = plansStore.plans.find(p => p.id === planId);
    const mosaic = plan?.mosaics.find(m => m.id === mosaicId);
    const spec = plan?.setupId ? specs.value.get(plan.setupId) : undefined;
    if (!plan || !mosaic || !spec) return;
    const tiles = tileCenters(
      { ra: mosaic.centerRa, dec: mosaic.centerDec }, mosaic.paDeg,
      mosaic.cols, mosaic.rows, spec.wDeg, spec.hDeg, mosaic.overlapPct,
    );
    const others = plan.entries.filter(e => e.mosaicId !== mosaicId);
    plan.entries = [
      ...others,
      ...tiles.map((t, i) => ({
        id: `tile-${mosaicId}-l${i}`, dsoId: mosaic.dsoId, position: i,
        paDeg: t.paDeg, ra: t.ra, dec: t.dec, notes: null, mosaicId,
      })),
    ];
    const prev = mosaicWriteTimers.get(mosaicId);
    if (prev) clearTimeout(prev);
    mosaicWriteTimers.set(mosaicId, setTimeout(() => {
      mosaicWriteTimers.delete(mosaicId);
      updatePlanMosaicAPI(planId, mosaicId, {
        dsoId: mosaic.dsoId, centerRa: mosaic.centerRa, centerDec: mosaic.centerDec,
        paDeg: mosaic.paDeg, overlapPct: mosaic.overlapPct, cols: mosaic.cols, rows: mosaic.rows,
        tiles: tiles.map(t => ({ ra: t.ra, dec: t.dec, paDeg: t.paDeg })),
      }).catch(err => reportUnknownRendererError('plan_transform_mosaic_failed', err, { mosaicId }));
    }, 250));
  }

  /** Move/rotate/retarget a whole mosaic (the outline frame drag routes here). */
  function transformMosaic(mosaicId: string, fields: { centerRa?: number; centerDec?: number; paDeg?: number; dsoId?: string | null }): void {
    const plan = plansStore.plans.find(p => p.mosaics?.some(m => m.id === mosaicId));
    const mosaic = plan?.mosaics.find(m => m.id === mosaicId);
    if (!plan || !mosaic) return;
    if (fields.centerRa != null) mosaic.centerRa = fields.centerRa;
    if (fields.centerDec != null) mosaic.centerDec = fields.centerDec;
    if (fields.paDeg != null) mosaic.paDeg = fields.paDeg;
    if (fields.dsoId !== undefined) mosaic.dsoId = fields.dsoId;
    retileAndPersist(plan.id, mosaicId);
  }

  /** Re-tile a mosaic to a new region (the outline frame's corner-resize drag). */
  function resizeMosaic(mosaicId: string, region: FovFrameResizeRegion): void {
    const plan = plansStore.plans.find(p => p.mosaics?.some(m => m.id === mosaicId));
    const mosaic = plan?.mosaics.find(m => m.id === mosaicId);
    const spec = plan?.setupId ? specs.value.get(plan.setupId) : undefined;
    if (!plan || !mosaic || !spec) return;
    const { cols, rows } = planGrid(spec.wDeg, spec.hDeg, region.wDeg, region.hDeg, mosaic.overlapPct);
    mosaic.cols = Math.max(1, cols);
    mosaic.rows = Math.max(1, rows);
    mosaic.centerRa = region.centerRa;
    mosaic.centerDec = region.centerDec;
    mosaic.paDeg = region.paDeg;
    retileAndPersist(plan.id, mosaicId);
  }

  /** Create a floating frame at viewport centre for the given setup, and select
   * it. Switches to free mode so the new frame is visible. */
  function addAdhocFrame(setupId: string): void {
    if (selection.value.kind !== 'free') { selection.value = { kind: 'free' }; persistSelection(); }
    const id = genId();
    adhoc.value.push({ id, setupId, anchor: { kind: 'screen', nx: 0.5, ny: 0.5 }, rotationDeg: 0 });
    activeId.value = id;
    persist();
  }

  /**
   * Create a custom-location frame in the given plan at the supplied sky centre,
   * select it, and switch to that plan. The new entry has no target DSO, so it
   * renders (and lists) as a "custom location" until moved onto an object.
   */
  async function addPlanFrame(planId: string, ra: number, dec: number): Promise<void> {
    if (selection.value.kind !== 'plan' || selection.value.planId !== planId) {
      selection.value = { kind: 'plan', planId };
      persistSelection();
    }
    const entryId = await plansStore.addCustomEntry(planId, ra, dec);
    if (entryId) activeId.value = `plan:${planId}:${entryId}`;
  }

  /** Remove an ad-hoc frame (plan frames are deleted via deletePlanFrame). */
  function removeFrame(id: string): void {
    const i = adhoc.value.findIndex(f => f.id === id);
    if (i >= 0) {
      adhoc.value.splice(i, 1);
      if (activeId.value === id) activeId.value = null;
      if (adhocHidden.value[id]) { const next = { ...adhocHidden.value }; delete next[id]; adhocHidden.value = next; persistHidden(); }
      persist();
    }
  }

  /** Delete a plan frame: drop any floating state and remove its plan entry. */
  async function deletePlanFrame(id: string): Promise<void> {
    if (planFloating.value[id]) { delete planFloating.value[id]; persistPlanFloating(); }
    if (activeId.value === id) activeId.value = null;
    const [, planId, entryId] = id.split(':');
    await plansStore.removeEntry(planId, entryId);
  }

  /** Apply an interactive move/rotate/pin change emitted by the sky map. */
  function applyChange(id: string, change: FovFrameChange): void {
    // A mosaic outline frame: route move/rotate/pin to the whole mosaic.
    if (id.startsWith('mosaic:')) {
      const mosaicId = id.split(':')[2];
      // Unpinned to floating: hold transient screen state; tiles hide.
      if (change.anchor && change.anchor.kind === 'screen') {
        const cur = mosaicFloating.value[mosaicId];
        mosaicFloating.value = { ...mosaicFloating.value, [mosaicId]: {
          nx: change.anchor.nx, ny: change.anchor.ny,
          rotationDeg: change.screenRotationDeg ?? cur?.rotationDeg ?? 0,
        } };
        return;
      }
      // Pinned to the sky: clear floating and re-tile at the new centre/target.
      if (change.anchor && change.anchor.kind === 'sky') {
        if (mosaicFloating.value[mosaicId]) { const next = { ...mosaicFloating.value }; delete next[mosaicId]; mosaicFloating.value = next; }
        transformMosaic(mosaicId, { centerRa: change.anchor.ra, centerDec: change.anchor.dec, paDeg: change.paDeg, dsoId: change.anchor.dsoId });
        return;
      }
      // Rotating while floating updates the transient rotation only.
      if (change.screenRotationDeg !== undefined) {
        const cur = mosaicFloating.value[mosaicId];
        if (cur) mosaicFloating.value = { ...mosaicFloating.value, [mosaicId]: { ...cur, rotationDeg: change.screenRotationDeg } };
        return;
      }
      if (change.paDeg !== undefined) transformMosaic(mosaicId, { paDeg: change.paDeg });
      return;
    }
    if (id.startsWith('plan:')) {
      const [, planId, entryId] = id.split(':');
      // Unpinned to floating: hold screen state transiently (not in the plan).
      if (change.anchor && change.anchor.kind === 'screen') {
        const cur = planFloating.value[id];
        planFloating.value[id] = {
          nx: change.anchor.nx, ny: change.anchor.ny,
          rotationDeg: change.screenRotationDeg ?? cur?.rotationDeg ?? 0,
        };
        persistPlanFloating();
        return;
      }
      // Pinned to the sky: clear any floating state and write through to the
      // plan (position + derived target, plus rotation if the pin carried one).
      if (change.anchor && change.anchor.kind === 'sky') {
        if (planFloating.value[id]) { delete planFloating.value[id]; persistPlanFloating(); }
        const fields: { ra: number; dec: number; dsoId: string | null; paDeg?: number } = {
          ra: change.anchor.ra, dec: change.anchor.dec, dsoId: change.anchor.dsoId,
        };
        if (change.paDeg !== undefined) fields.paDeg = change.paDeg;
        plansStore.setEntryPosition(planId, entryId, fields);
        return;
      }
      // Rotating a floating plan frame updates its transient screen rotation.
      if (change.screenRotationDeg !== undefined) {
        const cur = planFloating.value[id];
        if (cur) { cur.rotationDeg = change.screenRotationDeg; persistPlanFloating(); }
        return;
      }
      // Rotating a pinned plan frame writes the PA back to the plan.
      if (change.paDeg !== undefined) {
        plansStore.setEntryPosition(planId, entryId, { paDeg: change.paDeg });
      }
      return;
    }
    const f = adhoc.value.find(x => x.id === id);
    if (!f) return;
    if (change.anchor) f.anchor = change.anchor;
    if (change.paDeg !== undefined) f.rotationDeg = change.paDeg;
    if (change.screenRotationDeg !== undefined) f.rotationDeg = change.screenRotationDeg;
    persist();
  }

  /**
   * Commit a drag-to-extend on a plan frame: tile the dragged region with the
   * plan's gear FOV and replace the single frame with a mosaic. A drag too small
   * to need more than one tile is ignored (the single frame is kept).
   */
  async function applyResize(id: string, region: FovFrameResizeRegion): Promise<void> {
    // Resizing an existing mosaic outline re-tiles it to the new region.
    if (id.startsWith('mosaic:')) { resizeMosaic(id.split(':')[2], region); return; }
    if (!id.startsWith('plan:')) return;
    const [, planId, entryId] = id.split(':');
    const plan = plansStore.plans.find(p => p.id === planId);
    if (!plan || !plan.setupId) return;
    const spec = specs.value.get(plan.setupId);
    if (!spec) return;
    const overlapPct = 20;
    const { cols, rows } = planGrid(spec.wDeg, spec.hDeg, region.wDeg, region.hDeg, overlapPct);
    if (cols * rows <= 1) return; // not extended enough to be a mosaic
    const tiles = tileCenters(
      { ra: region.centerRa, dec: region.centerDec }, region.paDeg,
      cols, rows, spec.wDeg, spec.hDeg, overlapPct,
    ).map(tl => ({ ra: tl.ra, dec: tl.dec, paDeg: tl.paDeg }));
    const dsoId = plan.entries.find(e => e.id === entryId)?.dsoId ?? null;
    if (planFloating.value[id]) { delete planFloating.value[id]; persistPlanFloating(); }
    activeId.value = null;
    await plansStore.createMosaic(planId, {
      dsoId, centerRa: region.centerRa, centerDec: region.centerDec, paDeg: region.paDeg,
      overlapPct, cols, rows, tiles, replaceEntryIds: [entryId],
    });
  }

  /** Nudge a frame's rotation by `deltaDeg` (PA for pinned/plan, screen rotation for floating). */
  function nudgeRotation(id: string, deltaDeg: number): void {
    if (id.startsWith('plan:')) {
      const floating = planFloating.value[id];
      if (floating) {
        let n = (floating.rotationDeg + deltaDeg) % 360;
        if (n > 180) n -= 360;
        if (n < -180) n += 360;
        floating.rotationDeg = n;
        persistPlanFloating();
        return;
      }
      const [, planId, entryId] = id.split(':');
      const entry = plansStore.plans.find(p => p.id === planId)?.entries.find(e => e.id === entryId);
      const next = (((entry?.paDeg ?? 0) + deltaDeg) % 360 + 360) % 360;
      plansStore.setEntryPosition(planId, entryId, { paDeg: next });
      return;
    }
    const f = adhoc.value.find(x => x.id === id);
    if (!f) return;
    if (f.anchor.kind === 'sky') {
      f.rotationDeg = ((f.rotationDeg + deltaDeg) % 360 + 360) % 360;
    } else {
      let n = (f.rotationDeg + deltaDeg) % 360;
      if (n > 180) n -= 360;
      if (n < -180) n += 360;
      f.rotationDeg = n;
    }
    persist();
  }

  /** Reset a frame's rotation to 0 (PA for pinned, screen rotation for floating). */
  function resetRotation(id: string): void {
    if (id.startsWith('plan:')) {
      const floating = planFloating.value[id];
      if (floating) { floating.rotationDeg = 0; persistPlanFloating(); return; }
      const [, planId, entryId] = id.split(':');
      plansStore.setEntryPosition(planId, entryId, { paDeg: 0 });
      return;
    }
    const f = adhoc.value.find(x => x.id === id);
    if (f) { f.rotationDeg = 0; persist(); }
  }

  return {
    adhoc,
    activeId,
    specs,
    selection,
    anchorSnap,
    renderables,
    loadSpecs,
    setActive,
    setSelection,
    isAnchorSnapOn,
    toggleAnchorSnap,
    adhocHidden,
    isAdhocVisible,
    setAdhocVisible,
    setAllAdhocVisible,
    framesVisible,
    setFramesVisible,
    toggleFramesVisible,
    addAdhocFrame,
    addPlanFrame,
    removeFrame,
    deletePlanFrame,
    applyChange,
    applyResize,
    activeMosaicId,
    setActiveMosaic,
    transformMosaic,
    nudgeRotation,
    resetRotation,
  };
});
