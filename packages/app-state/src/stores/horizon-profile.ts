import { defineStore } from 'pinia';
import { ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { parseHorizonFile, type HorizonProfile } from '@myastrosky/core/horizon-io';
import { loadHorizonSettings, saveHorizonSettings } from '@myastrosky/core/horizon-settings';
import { fetchHorizonProfile } from '../api';

/**
 * The observer's terrain horizon (mountain skyline) without any map: the active profile, whether it is shown, the
 * eye height, and the compute / import / clear actions. It is stored under `horizon-settings-v1` (the last
 * skyline is restored without a refetch). Recomputing is always an explicit action, never automatic on a
 * latitude/longitude keystroke, to spare the elevation-tile server. The desktop's `useHorizonStore` adds the push
 * to its canvas on top of this store.
 */
export const useHorizonProfileStore = defineStore('horizon-profile', () => {
  const s = loadHorizonSettings();

  const profile = ref<HorizonProfile | null>(s.profile);
  const enabled = ref<boolean>(s.enabled);
  const obsHeightM = ref<number | null>(s.obsHeightM);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function persist() {
    saveHorizonSettings({
      enabled: enabled.value,
      obsHeightM: obsHeightM.value,
      profile: profile.value,
    });
  }

  function setEnabled(v: boolean) {
    enabled.value = v;
    persist();
  }

  function setObsHeight(v: number | null) {
    obsHeightM.value = v != null && Number.isFinite(v) ? v : null;
    persist();
  }

  /** Makes `p` the active profile; `show` also turns the display on (when there is a profile). */
  function applyProfile(p: HorizonProfile | null, show: boolean) {
    profile.value = p;
    if (show && p) enabled.value = true;
    persist();
  }

  /** Computes the horizon for a location; returns whether a profile was applied (`error` says why not). */
  async function computeFor(lat: number | null, lon: number | null): Promise<boolean> {
    if (lat === null || lon === null) {
      error.value = t('horizon.error.noLocation');
      return false;
    }
    loading.value = true;
    error.value = null;
    try {
      applyProfile(await fetchHorizonProfile(lat, lon, { obsHeightM: obsHeightM.value }), true);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('horizon.error.compute');
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** Loads a horizon from an imported file's text (CSV / Stellarium polygonal); returns whether it was applied. */
  function importFromText(text: string, lat: number | null, lon: number | null): boolean {
    error.value = null;
    try {
      applyProfile(parseHorizonFile(text, { lat: lat ?? 0, lon: lon ?? 0 }), true);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('horizon.error.parse');
      return false;
    }
  }

  function clear() {
    profile.value = null;
    enabled.value = false;
    error.value = null;
    persist();
  }

  return {
    profile,
    enabled,
    obsHeightM,
    loading,
    error,
    setEnabled,
    setObsHeight,
    applyProfile,
    computeFor,
    importFromText,
    clear,
  };
});
