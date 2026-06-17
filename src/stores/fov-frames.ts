import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RenderableFrame, FovFrameChange } from '../sky-map';
import { getGearSetups } from '../api';
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
  const specs = ref<Map<string, SetupSpec>>(new Map());
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
          active: id === activeId.value, movable: true, pinnable: true,
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

      // Mosaic tiles: sky-anchored, read-only, grouped by their mosaic id. The
      // tile inherits the mosaic's target name for the group label.
      const mosaicById = new Map((plan.mosaics ?? []).map(m => [m.id, m]));
      for (const entry of tiles) {
        if (entry.ra == null || entry.dec == null) continue;
        const mosaic = mosaicById.get(entry.mosaicId!);
        const dso = mosaic?.dsoId ? getDSOById(mosaic.dsoId) : undefined;
        out.push({
          id: `plan:${plan.id}:${entry.id}`,
          name: dso ? (dso.displayName ?? dso.id) : spec.name,
          label: spec.label, wDeg: spec.wDeg, hDeg: spec.hDeg,
          active: false, movable: false, pinnable: false, derivesTargetFromContent: false,
          dsoId: mosaic?.dsoId ?? null,
          anchorLabel: dso ? (dso.displayName ?? dso.id) : null,
          anchorKind: 'sky', ra: entry.ra, dec: entry.dec, paDeg: entry.paDeg,
          mosaicId: entry.mosaicId,
        });
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
    activeId.value = id;
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
    nudgeRotation,
    resetRotation,
  };
});
