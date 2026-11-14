import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getPlans,
  createPlanAPI,
  renamePlanAPI,
  updatePlanSettingsAPI,
  updatePlanSortAPI,
  updatePlanArchivedAPI,
  deletePlanAPI,
  reorderPlansAPI,
  addPlanEntryAPI,
  addCustomPlanEntryAPI,
  removePlanEntryAPI,
  reorderPlanEntriesAPI,
  updatePlanEntryPositionAPI,
  createPlanMosaicAPI,
  updatePlanMosaicAPI,
  deletePlanMosaicAPI,
  type Plan,
  type PlanEntry,
  type MosaicParams,
  type ObservationWindow,
  type PlanSortKey,
} from '../api';
import { reportError } from '@myastrosky/core/platform/error-hook';

/** Framing fields of a plan entry that a drag or rotation persists. */
type FramingFields = {
  ra?: number | null;
  dec?: number | null;
  paDeg?: number | null;
  dsoId?: string | null;
  mosaicWDeg?: number | null;
  mosaicHDeg?: number | null;
};

interface PendingEdit<T> {
  planId: string;
  value: T;
}

function findEntry(list: Plan[], planId: string, entryId: string): PlanEntry | undefined {
  return list.find((p) => p.id === planId)?.entries.find((e) => e.id === entryId);
}

function applyFraming(entry: PlanEntry, fields: FramingFields): void {
  if ('ra' in fields) entry.ra = fields.ra ?? null;
  if ('dec' in fields) entry.dec = fields.dec ?? null;
  if ('paDeg' in fields) entry.paDeg = fields.paDeg ?? null;
  if ('dsoId' in fields) entry.dsoId = fields.dsoId ?? null;
  if ('mosaicWDeg' in fields) entry.mosaicWDeg = fields.mosaicWDeg ?? null;
  if ('mosaicHDeg' in fields) entry.mosaicHDeg = fields.mosaicHDeg ?? null;
}

/** Forget a pending edit once its write settles, unless a newer edit replaced it. */
function clearPending<T>(
  map: Map<string, PendingEdit<T>>,
  entryId: string,
  edit: PendingEdit<T>,
): void {
  if (map.get(entryId) === edit) map.delete(entryId);
}

/**
 * Single source of truth for night plans, shared by the imperative targets-view
 * and the Vue search panel. Mutations call the backend then refresh the cache.
 */
export const usePlansStore = defineStore('plans', () => {
  const plans = ref<Plan[]>([]);
  const loaded = ref(false);
  // Per-entry debounce timers for framing persistence (drag coalescing).
  const framingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Separate per-entry debounce timers for observation-window persistence, so a
  // window drag never clears a pending framing write (they persist disjoint
  // columns via independent partial PATCHes).
  const windowWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Edits not yet confirmed by the backend, kept apart from the fetched cache so
  // a refresh during the debounce (or while the write is in flight) can neither
  // show nor write back the old values. Each edit stores a new record, so a write
  // that settles only clears its own record, never a newer edit's.
  const pendingFraming = new Map<string, PendingEdit<FramingFields>>();
  const pendingWindows = new Map<string, PendingEdit<ObservationWindow[]>>();

  const planCount = computed(() => plans.value.length);
  /** The plans the user has not archived: the ones every plan picker offers. */
  const activePlans = computed(() => plans.value.filter((p) => !p.archived));
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

  // Only the latest load may write the cache, so a slow earlier fetch can never
  // overwrite a newer list (e.g. one fetched right after a plan was created).
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    // An edit pending when the fetch starts may be confirmed before it returns,
    // while the fetched list still carries the old values: lay it over too.
    const framingAtStart = [...pendingFraming];
    const windowsAtStart = [...pendingWindows];
    try {
      const fresh = await getPlans();
      if (seq !== loadSeq) return;
      for (const [entryId, edit] of [...framingAtStart, ...pendingFraming]) {
        const entry = findEntry(fresh, edit.planId, entryId);
        if (entry) applyFraming(entry, edit.value);
      }
      for (const [entryId, edit] of [...windowsAtStart, ...pendingWindows]) {
        const entry = findEntry(fresh, edit.planId, entryId);
        if (entry) entry.observationWindows = edit.value;
      }
      plans.value = fresh;
      loaded.value = true;
    } catch (err) {
      reportError('plans_load_failed', err);
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
      reportError('plan_create_failed', err);
      return null;
    }
  }

  /**
   * Rename a plan in the cache once the backend confirms — deliberately does NOT
   * call load(): the targets view keeps the plan objects it was built from, and
   * a reload would leave its sort and settings controls writing to orphans.
   */
  async function renamePlan(id: string, name: string): Promise<void> {
    try {
      await renamePlanAPI(id, name);
      const plan = plans.value.find((p) => p.id === id);
      if (plan) plan.name = name;
    } catch (err) {
      reportError('plan_rename_failed', err, { id });
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
      reportError('plan_update_settings_failed', err, { id });
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
      reportError('plan_set_sort_failed', err, { id });
    });
  }

  /**
   * Archive or unarchive a plan. Mutates the local cache immediately then
   * persists in the background — deliberately does NOT call load().
   */
  function setPlanArchived(id: string, archived: boolean): void {
    const plan = plans.value.find((p) => p.id === id);
    if (plan) plan.archived = archived;
    updatePlanArchivedAPI(id, archived).catch((err) => {
      reportError('plan_set_archived_failed', err, { id });
    });
  }

  async function deletePlan(id: string): Promise<void> {
    try {
      await deletePlanAPI(id);
      await load();
    } catch (err) {
      reportError('plan_delete_failed', err, { id });
    }
  }

  async function reorderPlans(ids: string[]): Promise<void> {
    try {
      await reorderPlansAPI(ids);
      await load();
    } catch (err) {
      reportError('plan_reorder_failed', err);
    }
  }

  async function addEntry(planId: string, dsoId: string): Promise<void> {
    try {
      await addPlanEntryAPI(planId, dsoId);
      await load();
    } catch (err) {
      reportError('plan_add_entry_failed', err, { planId, dsoId });
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
      reportError('plan_add_custom_entry_failed', err, { planId });
      return null;
    }
  }

  async function removeEntry(planId: string, entryId: string): Promise<void> {
    try {
      await removePlanEntryAPI(planId, entryId);
      await load();
    } catch (err) {
      reportError('plan_remove_entry_failed', err, { planId, entryId });
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
    setEntryPosition(planId, entryId, { paDeg });
  }

  /**
   * Update a plan entry's frame position (centre ra/dec) and/or target dso.
   * Mutates the local cache immediately (so dragging re-renders without a
   * round-trip) and debounces the background persist so a drag coalesces into
   * one request — deliberately does NOT call load().
   */
  function setEntryPosition(planId: string, entryId: string, fields: FramingFields): void {
    const entry = findEntry(plans.value, planId, entryId);
    if (entry) applyFraming(entry, fields);
    // Accumulate the fields so a move and a rotation that land in the same
    // debounce window can't drop each other's field.
    const edit = { planId, value: { ...pendingFraming.get(entryId)?.value, ...fields } };
    pendingFraming.set(entryId, edit);
    const prev = framingWriteTimers.get(entryId);
    if (prev) clearTimeout(prev);
    framingWriteTimers.set(
      entryId,
      setTimeout(() => {
        framingWriteTimers.delete(entryId);
        const e = findEntry(plans.value, planId, entryId);
        if (!e) {
          clearPending(pendingFraming, entryId, edit);
          return;
        }
        updatePlanEntryPositionAPI(planId, entryId, {
          ra: e.ra,
          dec: e.dec,
          paDeg: e.paDeg,
          dsoId: e.dsoId,
          mosaicWDeg: e.mosaicWDeg,
          mosaicHDeg: e.mosaicHDeg,
          ...edit.value,
        })
          .catch((err) => {
            reportError('plan_set_entry_position_failed', err, { planId, entryId });
          })
          .finally(() => clearPending(pendingFraming, entryId, edit));
      }, 250),
    );
  }

  /**
   * Replace a plan entry's observation windows. Mutates the local cache
   * immediately (so dragging a window edge re-renders without a round-trip) and
   * debounces the background persist so a drag coalesces into one request —
   * deliberately does NOT call load().
   */
  function setEntryObservationWindows(
    planId: string,
    entryId: string,
    windows: ObservationWindow[],
  ): void {
    const entry = findEntry(plans.value, planId, entryId);
    if (entry) entry.observationWindows = windows;
    const edit = { planId, value: windows };
    pendingWindows.set(entryId, edit);
    const prev = windowWriteTimers.get(entryId);
    if (prev) clearTimeout(prev);
    windowWriteTimers.set(
      entryId,
      setTimeout(() => {
        windowWriteTimers.delete(entryId);
        if (!findEntry(plans.value, planId, entryId)) {
          clearPending(pendingWindows, entryId, edit);
          return;
        }
        updatePlanEntryPositionAPI(planId, entryId, { observationWindows: edit.value })
          .catch((err) => {
            reportError('plan_set_entry_windows_failed', err, { planId, entryId });
          })
          .finally(() => clearPending(pendingWindows, entryId, edit));
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
      reportError('plan_create_mosaic_failed', err, { planId });
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
      reportError('plan_update_mosaic_failed', err, { planId, mosaicId });
    }
  }

  async function deleteMosaic(planId: string, mosaicId: string): Promise<void> {
    try {
      await deletePlanMosaicAPI(planId, mosaicId);
      await load();
    } catch (err) {
      reportError('plan_delete_mosaic_failed', err, { planId, mosaicId });
    }
  }

  async function reorderEntries(planId: string, ids: string[]): Promise<void> {
    try {
      await reorderPlanEntriesAPI(planId, ids);
      await load();
    } catch (err) {
      reportError('plan_reorder_entries_failed', err, { planId });
    }
  }

  return {
    plans,
    activePlans,
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
    setPlanArchived,
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
