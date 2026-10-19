import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getPoiCategories,
  createPoiCategory,
  updatePoiCategory,
  deletePoiCategoryAPI,
} from '../api';
import type { PoiCategory } from '@myastrosky/core/types';
import type { PoiTypeDraft } from '@myastrosky/core/poi';
import { reportError } from '@myastrosky/core/platform/error-hook';

/**
 * Single source of truth for user-managed POI categories, shared by the per-photo
 * POI editors, the category manager modal, and the two-level filters. Mutations call
 * the backend then refresh the local cache.
 */
export const usePoiCategoriesStore = defineStore('poiCategories', () => {
  const categories = ref<PoiCategory[]>([]);
  const loaded = ref(false);

  const byId = computed(() => {
    const m = new Map<string, PoiCategory>();
    for (const c of categories.value) m.set(c.id, c);
    return m;
  });

  async function load(): Promise<void> {
    try {
      categories.value = await getPoiCategories();
      loaded.value = true;
    } catch (err) {
      reportError('poi_categories_load_failed', err);
    }
  }

  /** Load once (no-op if already loaded). */
  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load();
  }

  async function create(name: string, color: string): Promise<void> {
    await createPoiCategory({ name, color });
    await load();
  }

  async function update(
    id: string,
    data: Partial<{ name: string; color: string; position: number }>,
  ): Promise<void> {
    await updatePoiCategory(id, data);
    await load();
  }

  async function remove(id: string): Promise<void> {
    await deletePoiCategoryAPI(id);
    await load();
  }

  /**
   * Saves an edited list of the types (the types editor's Enregistrer): the saved types missing from it are deleted,
   * the new ones created and the changed ones updated; a type without a name is skipped.
   */
  async function saveDraft(draft: PoiTypeDraft[]): Promise<void> {
    const existing = categories.value;
    const kept = new Set(draft.filter((d) => !d.isNew).map((d) => d.id));
    for (const c of existing) {
      if (!kept.has(c.id)) await deletePoiCategoryAPI(c.id);
    }
    for (const d of draft) {
      const name = d.name.trim();
      if (!name) continue;
      if (d.isNew) {
        await createPoiCategory({ name, color: d.color });
      } else {
        const o = existing.find((c) => c.id === d.id);
        if (o && (o.name !== name || o.color !== d.color)) {
          await updatePoiCategory(d.id, { name, color: d.color });
        }
      }
    }
    await load();
  }

  return { categories, loaded, byId, load, ensureLoaded, create, update, remove, saveDraft };
});
