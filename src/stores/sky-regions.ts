import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getSkyRegions, createSkyRegion, updateSkyRegion, deleteSkyRegionAPI } from '../api';
import type { SkyRegionData } from '../api';
import { reportUnknownRendererError } from '../error-reporter';

/**
 * Single source of truth for user-drawn sky regions (freehand Alt/Az polygons
 * captured on the Local Sky view), shared by the region drawing/management UI
 * and the Targets search region filter. Mutations call the backend then refresh
 * the local cache.
 */
export const useSkyRegionsStore = defineStore('skyRegions', () => {
  const regions = ref<SkyRegionData[]>([]);
  const loaded = ref(false);

  const byId = computed(() => {
    const m = new Map<string, SkyRegionData>();
    for (const r of regions.value) m.set(r.id, r);
    return m;
  });

  async function load(): Promise<void> {
    try {
      regions.value = await getSkyRegions();
      loaded.value = true;
    } catch (err) {
      reportUnknownRendererError('sky_regions_load_failed', err);
    }
  }

  /** Load once (no-op if already loaded). */
  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load();
  }

  async function create(
    name: string,
    color: string,
    points: { azDeg: number; altDeg: number }[],
  ): Promise<void> {
    await createSkyRegion({ name, color, points });
    await load();
  }

  async function update(
    id: string,
    data: Partial<{ name: string; color: string; points: { azDeg: number; altDeg: number }[] }>,
  ): Promise<void> {
    await updateSkyRegion(id, data);
    await load();
  }

  async function remove(id: string): Promise<void> {
    await deleteSkyRegionAPI(id);
    await load();
  }

  return { regions, loaded, byId, load, ensureLoaded, create, update, remove };
});
