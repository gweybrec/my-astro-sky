import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getPlans,
  createPlanAPI,
  renamePlanAPI,
  updatePlanSettingsAPI,
  deletePlanAPI,
  reorderPlansAPI,
  addPlanEntryAPI,
  removePlanEntryAPI,
  reorderPlanEntriesAPI,
  type Plan,
} from '../api';
import { reportUnknownRendererError } from '../error-reporter';

/**
 * Single source of truth for night plans, shared by the imperative targets-view
 * and the Vue search panel. Mutations call the backend then refresh the cache.
 */
export const usePlansStore = defineStore('plans', () => {
  const plans = ref<Plan[]>([]);
  const loaded = ref(false);

  const planCount = computed(() => plans.value.length);
  const entryCount = computed(() => plans.value.reduce((n, p) => n + p.entries.length, 0));

  function isInPlan(dsoId: string, planId: string): boolean {
    const plan = plans.value.find(p => p.id === planId);
    return !!plan && plan.entries.some(e => e.dsoId === dsoId);
  }

  function plansContaining(dsoId: string): Plan[] {
    return plans.value.filter(p => p.entries.some(e => e.dsoId === dsoId));
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
   * Update a plan's observation night and/or gear setup. Mutates the local
   * cache immediately (so the caller can re-render without a round-trip) then
   * persists in the background.
   */
  async function updatePlanSettings(id: string, nightOf: string | null, setupId: string | null): Promise<void> {
    const plan = plans.value.find(p => p.id === id);
    if (plan) { plan.nightOf = nightOf; plan.setupId = setupId; }
    try {
      await updatePlanSettingsAPI(id, nightOf, setupId);
    } catch (err) {
      reportUnknownRendererError('plan_update_settings_failed', err, { id });
    }
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
    const plan = plans.value.find(p => p.id === planId);
    const existing = plan?.entries.find(e => e.dsoId === dsoId);
    if (existing) await removeEntry(planId, existing.id);
    else await addEntry(planId, dsoId);
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
    load,
    ensureLoaded,
    createPlan,
    renamePlan,
    updatePlanSettings,
    deletePlan,
    reorderPlans,
    addEntry,
    removeEntry,
    toggleEntry,
    reorderEntries,
  };
});
