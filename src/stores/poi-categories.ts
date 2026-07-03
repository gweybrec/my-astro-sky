import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getPoiCategories,
  createPoiCategory,
  updatePoiCategory,
  deletePoiCategoryAPI,
} from '../api';
import type { PoiCategory } from '../types';
import { reportUnknownRendererError } from '../error-reporter';

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
      reportUnknownRendererError('poi_categories_load_failed', err);
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

  return { categories, loaded, byId, load, ensureLoaded, create, update, remove };
});
