import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCanvasStore } from './canvas';
import { useSkyTimeStore } from './sky-time';
import { fetchHorizonProfile } from '../api';
import { parseHorizonFile, type HorizonProfile } from '../horizon-io';
import { t } from '../i18n';

const HORIZON_SETTINGS_KEY = 'horizon-settings-v1';

interface HorizonSettings {
  enabled: boolean;
  obsHeightM: number | null;
  profile: HorizonProfile | null;
}

function loadHorizonSettings(): HorizonSettings {
  try {
    const raw = localStorage.getItem(HORIZON_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        obsHeightM: typeof parsed.obsHeightM === 'number' ? parsed.obsHeightM : null,
        profile: parsed.profile ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: false, obsHeightM: null, profile: null };
}

/**
 * Observer's terrain horizon (mountain skyline). Holds the active profile, whether
 * it's shown on the map, and drives compute/import. The profile is computed
 * server-side (DEM ray-trace) or imported from a file; it's persisted to
 * localStorage keyed by nothing but "the current one", so reopening restores the
 * last skyline without a refetch. Recompute is always an explicit user action —
 * never automatic on a lat/lon keystroke — to avoid hammering the tile server.
 */
export const useHorizonStore = defineStore('horizon', () => {
  const s = loadHorizonSettings();

  const profile = ref<HorizonProfile | null>(s.profile);
  const enabled = ref<boolean>(s.enabled);
  const obsHeightM = ref<number | null>(s.obsHeightM);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function persist() {
    const payload: HorizonSettings = {
      enabled: enabled.value,
      obsHeightM: obsHeightM.value,
      profile: profile.value,
    };
    localStorage.setItem(HORIZON_SETTINGS_KEY, JSON.stringify(payload));
  }

  /** Push the current profile + visibility to the canvas. */
  function syncToCanvas() {
    const sm = useCanvasStore().skyMap;
    sm?.setMountainHorizon(profile.value);
    sm?.setShowMountainHorizon(enabled.value);
  }

  // Restore into the canvas once the map exists (called from the map bootstrap).
  function applyToCanvas() {
    syncToCanvas();
  }

  function setEnabled(v: boolean) {
    enabled.value = v;
    useCanvasStore().skyMap?.setShowMountainHorizon(v);
    persist();
  }

  function setObsHeight(v: number | null) {
    obsHeightM.value = v != null && Number.isFinite(v) ? v : null;
    persist();
  }

  function applyProfile(p: HorizonProfile | null, show: boolean) {
    profile.value = p;
    if (show && p) enabled.value = true;
    syncToCanvas();
    persist();
  }

  /** Compute the horizon for the sky-time store's current location. */
  async function computeForCurrentLocation() {
    const st = useSkyTimeStore();
    if (st.lat === null || st.lon === null) {
      error.value = t('horizon.error.noLocation');
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const p = await fetchHorizonProfile(st.lat, st.lon, { obsHeightM: obsHeightM.value });
      applyProfile(p, true);
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('horizon.error.compute');
    } finally {
      loading.value = false;
    }
  }

  /** Load a horizon from an imported file's text (CSV / Stellarium polygonal). */
  function importFromText(text: string) {
    error.value = null;
    const st = useSkyTimeStore();
    try {
      const p = parseHorizonFile(text, { lat: st.lat ?? 0, lon: st.lon ?? 0 });
      applyProfile(p, true);
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('horizon.error.parse');
    }
  }

  function clear() {
    applyProfile(null, false);
    enabled.value = false;
    error.value = null;
    persist();
  }

  return {
    // state
    profile,
    enabled,
    obsHeightM,
    loading,
    error,
    // actions
    applyToCanvas,
    setEnabled,
    setObsHeight,
    computeForCurrentLocation,
    importFromText,
    clear,
  };
});
