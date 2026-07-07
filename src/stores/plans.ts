import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getPlans,
  createPlanAPI,
  renamePlanAPI,
  updatePlanSettingsAPI,
  updatePlanSortAPI,
  deletePlanAPI,
  reorderPlansAPI,
  addPlanEntryAPI,
  addCustomPlanEntryAPI,
  removePlanEntryAPI,
  reorderPlanEntriesAPI,
  updatePlanEntryPAAPI,
  updatePlanEntryPositionAPI,
  createPlanMosaicAPI,
  updatePlanMosaicAPI,
  deletePlanMosaicAPI,
  type Plan,
  type MosaicParams,
  type ObservationWindow,
  type PlanSortKey,
} from '../api';
import { reportUnknownRendererError } from '../error-reporter';

/**
 * Single source of truth for night plans, shared by the imperative targets-view
 * and the Vue search panel. Mutations call the backend then refresh the cache.
 */
export const usePlansStore = defineStore('plans', () => {
  const plans = ref<Plan[]>([]);
  const loaded = ref(false);
  // Per-entry debounce timers for position-angle persistence (drag coalescing).
  const paWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Separate per-entry debounce timers for observation-window persistence, so a
  // window drag never clears a pending framing write (they persist disjoint
  // columns via independent partial PATCHes).
  const windowWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const planCount = computed(() => plans.value.length);
  const entryCount = computed(() => plans.value.reduce((n, p) => n + p.entries.length, 0));

  function isInPlan(dsoId: string, planId: string): boolean {
    const plan = plans.value.find((p) => p.id === planId);
    return !!plan && plan.entries.some((e) => e.dsoId === dsoId);
  }

  function plansContaining(dsoId: string): Plan[] {
    return plans.value.filter((p) => p.entries.some((e) => e.dsoId === dsoId));
  }

  /** Plans that reference the given gear setup (used to guard setup deletion). */
  function plansUsingSetup(setupId: string): Plan[] {
    return plans.value.filter((p) => p.setupId === setupId);
  }

  async function load(): Promise<void> {
    try {
      plans.value = await getPlans();
      loaded.value = true;
    } catch (err) {
      reportUnknownRendererError('plans_load_failed', err);
    }
  }

  /** Load once (no-op if already loaded). */
  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load();
  }

  async function createPlan(name: string): Promise<string | null> {
    try {
      const { id } = await createPlanAPI(name);
      await load();
      return id;
    } catch (err) {
      reportUnknownRendererError('plan_create_failed', err);
      return null;
    }
  }

  async function renamePlan(id: string, name: string): Promise<void> {
    try {
      await renamePlanAPI(id, name);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_rename_failed', err, { id });
    }
  }

  /**
   * Update a plan's observation night, gear setup and/or observing location.
   * Mutates the local cache immediately (so the caller can re-render without a
   * round-trip) then persists in the background.
   */
  async function updatePlanSettings(
    id: string,
    nightOf: string | null,
    setupId: string | null,
    lat: number | null,
    lon: number | null,
  ): Promise<void> {
    const plan = plans.value.find((p) => p.id === id);
    if (plan) {
      plan.nightOf = nightOf;
      plan.setupId = setupId;
      plan.lat = lat;
      plan.lon = lon;
    }
    try {
      await updatePlanSettingsAPI(id, nightOf, setupId, lat, lon);
    } catch (err) {
      reportUnknownRendererError('plan_update_settings_failed', err, { id });
    }
  }

  /**
   * Set a plan's objects-list sort key. Mutates the local cache immediately (so
   * the list re-renders without a round-trip) then persists in the background —
   * deliberately does NOT call load().
   */
  function setPlanSort(id: string, sortBy: PlanSortKey): void {
    const plan = plans.value.find((p) => p.id === id);
    if (plan) plan.sortBy = sortBy;
    updatePlanSortAPI(id, sortBy).catch((err) => {
      reportUnknownRendererError('plan_set_sort_failed', err, { id });
    });
  }

  async function deletePlan(id: string): Promise<void> {
    try {
      await deletePlanAPI(id);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_delete_failed', err, { id });
    }
  }

  async function reorderPlans(ids: string[]): Promise<void> {
    try {
      await reorderPlansAPI(ids);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_reorder_failed', err);
    }
  }

  async function addEntry(planId: string, dsoId: string): Promise<void> {
    try {
      await addPlanEntryAPI(planId, dsoId);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_add_entry_failed', err, { planId, dsoId });
    }
  }

  /**
   * Add a custom-location entry (no DSO) framed on empty sky at the given centre.
   * Returns the new entry id, or null on failure.
   */
  async function addCustomEntry(planId: string, ra: number, dec: number): Promise<string | null> {
    try {
      const { id } = await addCustomPlanEntryAPI(planId, ra, dec);
      await load();
      return id;
    } catch (err) {
      reportUnknownRendererError('plan_add_custom_entry_failed', err, { planId });
      return null;
    }
  }

  async function removeEntry(planId: string, entryId: string): Promise<void> {
    try {
      await removePlanEntryAPI(planId, entryId);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_remove_entry_failed', err, { planId, entryId });
    }
  }

  /** Toggle a DSO in a plan: add if absent, remove if present. */
  async function toggleEntry(planId: string, dsoId: string): Promise<void> {
    const plan = plans.value.find((p) => p.id === planId);
    const existing = plan?.entries.find((e) => e.dsoId === dsoId);
    if (existing) await removeEntry(planId, existing.id);
    else await addEntry(planId, dsoId);
  }

  /**
   * Set a plan entry's framing position angle. Mutates the local cache
   * immediately (so frame dragging re-renders without a round-trip) and
   * debounces the background persist so a drag coalesces into one request —
   * deliberately does NOT call load().
   */
  function setEntryPA(planId: string, entryId: string, paDeg: number | null): void {
    const entry = plans.value.find((p) => p.id === planId)?.entries.find((e) => e.id === entryId);
    if (entry) entry.paDeg = paDeg;
    const prev = paWriteTimers.get(entryId);
    if (prev) clearTimeout(prev);
    paWriteTimers.set(
      entryId,
      setTimeout(() => {
        paWriteTimers.delete(entryId);
        updatePlanEntryPAAPI(planId, entryId, paDeg).catch((err) => {
          reportUnknownRendererError('plan_set_entry_pa_failed', err, { planId, entryId });
        });
      }, 250),
    );
  }

  /**
   * Update a plan entry's frame position (centre ra/dec) and/or target dso.
   * Mutates the local cache immediately (so dragging re-renders without a
   * round-trip) and debounces the background persist so a drag coalesces into
   * one request — deliberately does NOT call load().
   */
  function setEntryPosition(
    planId: string,
    entryId: string,
    fields: {
      ra?: number | null;
      dec?: number | null;
      paDeg?: number | null;
      dsoId?: string | null;
      mosaicWDeg?: number | null;
      mosaicHDeg?: number | null;
    },
  ): void {
    const entry = plans.value.find((p) => p.id === planId)?.entries.find((e) => e.id === entryId);
    if (entry) {
      if ('ra' in fields) entry.ra = fields.ra ?? null;
      if ('dec' in fields) entry.dec = fields.dec ?? null;
      if ('paDeg' in fields) entry.paDeg = fields.paDeg ?? null;
      if ('dsoId' in fields) entry.dsoId = fields.dsoId ?? null;
      if ('mosaicWDeg' in fields) entry.mosaicWDeg = fields.mosaicWDeg ?? null;
      if ('mosaicHDeg' in fields) entry.mosaicHDeg = fields.mosaicHDeg ?? null;
    }
    const prev = paWriteTimers.get(entryId);
    if (prev) clearTimeout(prev);
    // Flush the entry's full framing from the cache so a move and a rotation that
    // land in the same debounce window can't drop each other's field.
    paWriteTimers.set(
      entryId,
      setTimeout(() => {
        paWriteTimers.delete(entryId);
        const e = plans.value.find((p) => p.id === planId)?.entries.find((x) => x.id === entryId);
        if (!e) return;
        updatePlanEntryPositionAPI(planId, entryId, {
          ra: e.ra,
          dec: e.dec,
          paDeg: e.paDeg,
          dsoId: e.dsoId,
          mosaicWDeg: e.mosaicWDeg,
          mosaicHDeg: e.mosaicHDeg,
        }).catch((err) => {
          reportUnknownRendererError('plan_set_entry_position_failed', err, { planId, entryId });
        });
      }, 250),
    );
  }

  /**
   * Replace a plan entry's observation windows. Mutates the local cache
   * immediately (so dragging a window edge re-renders without a round-trip) and
   * debounces the background persist so a drag coalesces into one request —
   * deliberately does NOT call load(). Reuses the same per-entry debounce map as
   * the framing writes so window and framing edits can't drop each other.
   */
  function setEntryObservationWindows(
    planId: string,
    entryId: string,
    windows: ObservationWindow[],
  ): void {
    const entry = plans.value.find((p) => p.id === planId)?.entries.find((e) => e.id === entryId);
    if (entry) entry.observationWindows = windows;
    const prev = windowWriteTimers.get(entryId);
    if (prev) clearTimeout(prev);
    windowWriteTimers.set(
      entryId,
      setTimeout(() => {
        windowWriteTimers.delete(entryId);
        const e = plans.value.find((p) => p.id === planId)?.entries.find((x) => x.id === entryId);
        if (!e) return;
        updatePlanEntryPositionAPI(planId, entryId, {
          observationWindows: e.observationWindows,
        }).catch((err) => {
          reportUnknownRendererError('plan_set_entry_windows_failed', err, { planId, entryId });
        });
      }, 250),
    );
  }

  /**
   * Create a mosaic in a plan from client-computed tiles. Returns the new mosaic
   * id, or null on failure. Refreshes the cache so the tiles appear.
   */
  async function createMosaic(planId: string, params: MosaicParams): Promise<string | null> {
    try {
      const { id } = await createPlanMosaicAPI(planId, params);
      await load();
      return id;
    } catch (err) {
      reportUnknownRendererError('plan_create_mosaic_failed', err, { planId });
      return null;
    }
  }

  /** Replace a mosaic's parameters and tile set (used when re-tiling/regenerating). */
  async function updateMosaic(
    planId: string,
    mosaicId: string,
    params: MosaicParams,
  ): Promise<void> {
    try {
      await updatePlanMosaicAPI(planId, mosaicId, params);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_update_mosaic_failed', err, { planId, mosaicId });
    }
  }

  async function deleteMosaic(planId: string, mosaicId: string): Promise<void> {
    try {
      await deletePlanMosaicAPI(planId, mosaicId);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_delete_mosaic_failed', err, { planId, mosaicId });
    }
  }

  async function reorderEntries(planId: string, ids: string[]): Promise<void> {
    try {
      await reorderPlanEntriesAPI(planId, ids);
      await load();
    } catch (err) {
      reportUnknownRendererError('plan_reorder_entries_failed', err, { planId });
    }
  }

  return {
    plans,
    loaded,
    planCount,
    entryCount,
    isInPlan,
    plansContaining,
    plansUsingSetup,
    load,
    ensureLoaded,
    createPlan,
    renamePlan,
    updatePlanSettings,
    deletePlan,
    reorderPlans,
    addEntry,
    addCustomEntry,
    removeEntry,
    toggleEntry,
    reorderEntries,
    setEntryPA,
    setEntryPosition,
    setEntryObservationWindows,
    setPlanSort,
    createMosaic,
    updateMosaic,
    deleteMosaic,
  };
});
