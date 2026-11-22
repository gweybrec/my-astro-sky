import { useRouter } from 'vue-router';
import { outlineFromGrid } from '@myastrosky/core/mosaic';
import type { Plan, PlanMosaic } from '@myastrosky/app-state/api';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { skyPlanView } from '../sky-modes';
import { framesSheetOpen } from '../sky-frames';
import { openTab, swapPagesUnseen } from '../tab-navigation';
import { skyFocus } from './useSkySelection';
import { targetsPrefs } from './useTargets';

/**
 * The map's mode "voir un plan": the plan's frames shown; the mode puts the frames back as they were when it ends and
 * opens `returnTo` again, above the pages `under` it. A plan opens with the frames' sheet on its frames. A mosaic
 * (`showMosaic`) opens selected, with its own sheet over the map, as a target's page shows its target: the map zoomed so
 * the whole mosaic fits (its outline as the field), as the desktop's navigateToMosaic; a smart telescope's mosaic is one
 * enlarged frame, of its own size.
 */
export function usePlanOnMap() {
  const router = useRouter();
  const fov = useFovFramesStore();

  async function showPlan(
    p: Plan,
    returnTo = `/plans/${p.id}`,
    under: string[] = [],
    mosaicId?: string,
  ) {
    skyPlanView.value = {
      planId: p.id,
      name: p.name,
      frames: { visible: fov.framesVisible, selection: { ...fov.selection } },
      ...(under.length ? { under } : {}),
      ...(mosaicId ? { mosaicId } : {}),
      returnTo,
    };
    fov.setSelection({ kind: 'plan', planId: p.id });
    fov.setFramesVisible(true);
    if (mosaicId) fov.setActiveMosaic(mosaicId);
    // Its tab, then the map: out of sight, so that the tab is not glimpsed on the way. The sheet opens over the map.
    await swapPagesUnseen(() => openTab(router, 'plans', 'sky'));
    if (!mosaicId) framesSheetOpen.value = true;
  }

  async function showMosaic(p: Plan, m: PlanMosaic, returnTo?: string, under: string[] = []) {
    const setupId = p.setupId ?? targetsPrefs.setupId ?? null;
    if (setupId && !fov.specs.has(setupId)) await fov.loadSpecs();
    const spec = setupId ? fov.specs.get(setupId) : undefined;
    const tiles = p.entries.filter((e) => e.mosaicId === m.id);
    const own = tiles.length === 1 ? tiles[0] : undefined;
    const outline =
      own?.mosaicWDeg && own.mosaicHDeg
        ? { wDeg: own.mosaicWDeg, hDeg: own.mosaicHDeg }
        : spec
          ? outlineFromGrid(m.cols, m.rows, spec.wDeg, spec.hDeg, m.overlapPct)
          : null;
    skyFocus.value = outline
      ? { ra: m.centerRa, dec: m.centerDec, scale: 0, fov: outline }
      : { ra: m.centerRa, dec: m.centerDec, scale: 400 };
    await showPlan(p, returnTo, under, m.id);
  }

  return { showPlan, showMosaic };
}
