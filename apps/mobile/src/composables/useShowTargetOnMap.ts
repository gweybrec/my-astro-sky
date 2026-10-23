import { useRouter } from 'vue-router';
import type { DSO } from '@myastrosky/core/types';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { openTab, type Tab } from '../tab-navigation';
import { skyFocus } from './useSkySelection';

/**
 * The desktop's "Afficher sur la carte" of a target (`onNavigate` in its main.ts): with a setup, a free frame of that
 * setup pinned on the target, frames shown and the map zoomed on the frame (its sheet opens there); without one, the
 * map at the target. The tab the page belongs to (`from`) is left at its root, as the map modes do.
 */
export function useShowTargetOnMap(from: Tab) {
  const router = useRouter();
  const fov = useFovFramesStore();
  return async (dso: DSO, setupId: string | null | undefined) => {
    if (setupId && !fov.specs.has(setupId)) await fov.loadSpecs();
    const spec = setupId ? fov.specs.get(setupId) : undefined;
    if (setupId && spec) {
      fov.addAdhocFrameAtSky(setupId, dso.ra, dso.dec);
      fov.setFramesVisible(true);
      skyFocus.value = {
        ra: dso.ra,
        dec: dso.dec,
        scale: 0,
        fov: { wDeg: spec.wDeg, hDeg: spec.hDeg },
      };
    } else {
      skyFocus.value = { ra: dso.ra, dec: dso.dec, scale: 800 };
    }
    await openTab(router, from, 'sky');
  };
}
