import { useRouter } from 'vue-router';
import type { DSO } from '@myastrosky/core/types';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { openTab, swapPagesUnseen, type Tab } from '../tab-navigation';
import { skyTargetView } from '../sky-modes';
import { skyFocus } from './useSkySelection';

/** Where the map goes back to: the tab, the pages under the target's page, and the target's page for an object. */
export interface TargetPages {
  tab: Tab;
  pages: string[];
  /** The page the map was opened from. */
  page: string;
  /** The page of another object, once the frame was moved onto it. */
  pageOf: (dsoId: string) => string;
}

/**
 * The desktop's "Afficher sur la carte" of a target (`onNavigate` in its main.ts), as the map's mode "voir une cible"
 * (board "Ciel, voir une cible"): with a setup, a free frame of that setup pinned on the target, frames shown and the map
 * zoomed on the frame (its sheet opens there); without one, the map at the target. The frame is only a preview, removed
 * when the map is left. The tab the page belongs to is left at its root, as the map modes do; the mode opens it and its
 * pages again (`back`).
 */
export function useShowTargetOnMap(back: TargetPages) {
  const router = useRouter();
  const fov = useFovFramesStore();
  return async (dso: DSO, setupId: string | null | undefined) => {
    if (setupId && !fov.specs.has(setupId)) await fov.loadSpecs();
    const spec = setupId ? fov.specs.get(setupId) : undefined;
    // A multiple star of the list is not in the catalogue: its frame is anchored to no object.
    const isStar = dso.id.startsWith('star:');
    // The frame is a preview: the frames go back to this once the map is left.
    const frames = { visible: fov.framesVisible, selection: { ...fov.selection } };
    let frameId: string | null = null;
    if (setupId && spec) {
      fov.addAdhocFrameAtSky(setupId, dso.ra, dso.dec, isStar ? null : dso.id);
      frameId = fov.adhoc[fov.adhoc.length - 1]?.id ?? null;
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
    skyTargetView.value = {
      frameId,
      frames,
      dsoId: dso.id,
      name: dso.displayName || dso.catalogs[0] || dso.id,
      ...back,
    };
    // Its tab, then the map: out of sight, so that the tab is not glimpsed on the way.
    await swapPagesUnseen(() => openTab(router, back.tab, 'sky'));
  };
}
