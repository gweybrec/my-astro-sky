import { defineStore, storeToRefs } from 'pinia';
import { useCanvasStore } from './canvas';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import type { HorizonProfile } from '@myastrosky/core/horizon-io';

/**
 * Observer's terrain horizon (mountain skyline) on the desktop's map. The profile, its persistence and the
 * compute / import actions live in the shared `useHorizonProfileStore` (also used by the phone); this store adds
 * the push of the profile and its visibility to the sky map.
 */
export const useHorizonStore = defineStore('horizon', () => {
  const base = useHorizonProfileStore();
  const { profile, enabled, obsHeightM, loading, error } = storeToRefs(base);

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
    base.setEnabled(v);
    useCanvasStore().skyMap?.setShowMountainHorizon(v);
  }

  function setObsHeight(v: number | null) {
    base.setObsHeight(v);
  }

  function applyProfile(p: HorizonProfile | null, show: boolean) {
    base.applyProfile(p, show);
    syncToCanvas();
  }

  /** Compute the horizon for the sky-time store's current location. */
  async function computeForCurrentLocation() {
    const st = useSkyTimeStore();
    if (await base.computeFor(st.lat, st.lon)) syncToCanvas();
  }

  /** Load a horizon from an imported file's text (CSV / Stellarium polygonal). */
  function importFromText(text: string) {
    const st = useSkyTimeStore();
    if (base.importFromText(text, st.lat, st.lon)) syncToCanvas();
  }

  function clear() {
    base.clear();
    syncToCanvas();
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
