import { t } from '@myastrosky/core/i18n/index';
import { formatFov } from '@myastrosky/core/gear-presets';
import { getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { customLocationLabelOr } from '@myastrosky/core/targets/plan';
import { tileCenters, outlineFromGrid, transformMosaicToSetup } from '@myastrosky/core/mosaic';
import type { TargetFov, MosaicTransform } from '@myastrosky/core/mosaic';
import type { Plan } from '@myastrosky/core/domain/plans';
import { updatePlanEntryPositionAPI } from './api';
import { useFovFramesStore } from './stores/fov-frames';
import { usePlansStore } from './stores/plans';

/**
 * Switching a plan's gear setup, without the page: changing a setup re-sizes every frame, but mosaics (tile grids and
 * smart-scope enlarged frames) can't always re-fit cleanly, so this finds them, proposes each one's best conversion,
 * and commits the switch with the user's Apply/Drop choice per mosaic. The desktop (src/setup-switch.ts) and the phone
 * each draw their own confirmation over it.
 */

/** Sky centre of a plan entry: its explicit frame centre, else its DSO position. */
function entryCenter(e: {
  ra: number | null;
  dec: number | null;
  dsoId: string | null;
}): { ra: number; dec: number } | null {
  if (e.ra != null && e.dec != null) return { ra: e.ra, dec: e.dec };
  const dso = e.dsoId ? getDSOById(e.dsoId) : undefined;
  return dso ? { ra: dso.ra, dec: dso.dec } : null;
}

const locationLabel = (ra: number, dec: number): string =>
  customLocationLabelOr(ra, dec, t('fovOverlay.customLocation'));

/** Resolved angular size + envelope for a setup, read from the fov-frames store. */
export type SetupSpecLite = {
  wDeg: number;
  hDeg: number;
  smart: boolean;
  mosaic: TargetFov['envelope'];
};

/** A mosaic (tile grid or enlarged smart frame) that doesn't map cleanly onto a
 * new setup: its proposed best transformation, plus the actions to commit or
 * drop it. Surfaced as one decision row in the setup-switch confirmation. */
export type SwitchItem = {
  id: string;
  label: string;
  transform: MosaicTransform;
  apply: () => Promise<void>;
  drop: () => Promise<void>;
};

export type SwitchDecision = 'apply' | 'drop';

/** The proposed conversion as one line: "4×3 · 5.0° × 3.4°", or "Cadre unique · 2.5° × 1.7°". */
export function switchProposalText(tr: MosaicTransform): string {
  return tr.kind === 'grid'
    ? `${tr.cols}×${tr.rows} · ${formatFov(tr.wDeg, tr.hDeg)}`
    : `${t('fovOverlay.switchSingleFrame')} · ${formatFov(tr.wDeg, tr.hDeg)}`;
}

/**
 * Mosaics in `plan` that need a decision when moving from `oldSpec` to
 * `newSpec`: every tile-grid mosaic, plus every standalone frame a smart scope
 * enlarged beyond native. Each carries the best transformation (re-grid for a
 * classical target, clamp-to-envelope for a smart one) and the apply/drop ops.
 * Plain native-FOV single frames re-fit silently, so they're excluded.
 */
export function collectSwitchItems(
  plan: Plan,
  oldSpec: SetupSpecLite,
  newSpec: SetupSpecLite,
): SwitchItem[] {
  const plansStore = usePlansStore();
  const planId = plan.id;
  const target: TargetFov = {
    wDeg: newSpec.wDeg,
    hDeg: newSpec.hDeg,
    envelope: newSpec.mosaic,
    tileable: !newSpec.smart,
  };
  const newW = newSpec.wDeg,
    newH = newSpec.hDeg;
  // A transformed size within 1% of the new native FOV renders un-enlarged.
  const nearNative = (w: number, h: number): boolean => w <= newW * 1.01 && h <= newH * 1.01;
  const items: SwitchItem[] = [];

  for (const mosaic of plan.mosaics ?? []) {
    const outline = outlineFromGrid(
      mosaic.cols,
      mosaic.rows,
      oldSpec.wDeg,
      oldSpec.hDeg,
      mosaic.overlapPct,
    );
    const transform = transformMosaicToSetup(outline.wDeg, outline.hDeg, mosaic.overlapPct, target);
    const dso = mosaic.dsoId ? getDSOById(mosaic.dsoId) : undefined;
    items.push({
      id: `mosaic:${mosaic.id}`,
      label:
        mosaic.name ??
        (dso ? (dso.displayName ?? dso.id) : locationLabel(mosaic.centerRa, mosaic.centerDec)),
      transform,
      drop: () => plansStore.deleteMosaic(planId, mosaic.id),
      apply: async () => {
        if (transform.kind === 'grid') {
          // Re-tile the same centre/PA/overlap with the new gear FOV.
          const tiles = tileCenters(
            { ra: mosaic.centerRa, dec: mosaic.centerDec },
            mosaic.paDeg,
            transform.cols,
            transform.rows,
            newW,
            newH,
            mosaic.overlapPct,
          ).map((tl) => ({ ra: tl.ra, dec: tl.dec, paDeg: tl.paDeg }));
          await plansStore.updateMosaic(planId, mosaic.id, {
            dsoId: mosaic.dsoId,
            name: mosaic.name ?? undefined,
            centerRa: mosaic.centerRa,
            centerDec: mosaic.centerDec,
            paDeg: mosaic.paDeg,
            overlapPct: mosaic.overlapPct,
            cols: transform.cols,
            rows: transform.rows,
            tiles,
          });
        } else {
          // Collapse to a single (smart-enlarged or native) frame on the target.
          await plansStore.deleteMosaic(planId, mosaic.id);
          const newId = await plansStore.addCustomEntry(planId, mosaic.centerRa, mosaic.centerDec);
          if (newId) {
            const native = nearNative(transform.wDeg, transform.hDeg);
            await updatePlanEntryPositionAPI(planId, newId, {
              dsoId: mosaic.dsoId,
              paDeg: mosaic.paDeg,
              mosaicWDeg: native ? null : transform.wDeg,
              mosaicHDeg: native ? null : transform.hDeg,
            });
          }
        }
      },
    });
  }

  for (const entry of plan.entries) {
    if (entry.mosaicId) continue;
    if (entry.mosaicWDeg == null || entry.mosaicHDeg == null) continue; // not an enlarged frame
    const transform = transformMosaicToSetup(entry.mosaicWDeg, entry.mosaicHDeg, 20, target);
    const dso = entry.dsoId ? getDSOById(entry.dsoId) : undefined;
    const center = entryCenter(entry);
    items.push({
      id: `entry:${entry.id}`,
      label: dso
        ? (dso.displayName ?? dso.id)
        : center
          ? locationLabel(center.ra, center.dec)
          : t('fovOverlay.customLocation'),
      transform,
      drop: () => plansStore.removeEntry(planId, entry.id),
      apply: async () => {
        if (transform.kind === 'single' || !center) {
          // Re-clamp (or clear) the single-frame enlargement for the new scope.
          const native = transform.kind === 'single' && !nearNative(transform.wDeg, transform.hDeg);
          await updatePlanEntryPositionAPI(planId, entry.id, {
            mosaicWDeg: native ? transform.wDeg : null,
            mosaicHDeg: native ? transform.hDeg : null,
          });
        } else {
          // Classical target: tile the enlarged frame into a mosaic.
          const paDeg = entry.paDeg ?? 0;
          const tiles = tileCenters(
            center,
            paDeg,
            transform.cols,
            transform.rows,
            newW,
            newH,
            20,
          ).map((tl) => ({ ra: tl.ra, dec: tl.dec, paDeg: tl.paDeg }));
          await plansStore.createMosaic(planId, {
            dsoId: entry.dsoId,
            centerRa: center.ra,
            centerDec: center.dec,
            paDeg,
            overlapPct: 20,
            cols: transform.cols,
            rows: transform.rows,
            tiles,
            replaceEntryIds: [entry.id],
          });
        }
      },
    });
  }
  return items;
}

/**
 * The mosaics a switch of `plan` to `newSetupId` must ask about (none when the setup is unchanged, cleared, or either
 * setup has no resolved size). Reads the plan's current setup as the old one.
 */
export async function setupSwitchItems(
  plan: Plan,
  newSetupId: string | null,
): Promise<SwitchItem[]> {
  const fovStore = useFovFramesStore();
  if (newSetupId === plan.setupId || !newSetupId) return [];
  await fovStore.loadSpecs();
  const oldSpec = plan.setupId ? fovStore.specs.get(plan.setupId) : undefined;
  const newSpec = fovStore.specs.get(newSetupId);
  return oldSpec && newSpec ? collectSwitchItems(plan, oldSpec, newSpec) : [];
}

/** Switches the plan to the new setup with nothing to ask: saves it, then resizes the frames. */
export async function switchSetupDirectly(plan: Plan, newSetupId: string | null): Promise<void> {
  const plansStore = usePlansStore();
  const fovStore = useFovFramesStore();
  await plansStore.updatePlanSettings(plan.id, plan.nightOf, newSetupId, plan.lat, plan.lon);
  await fovStore.loadSpecs();
}

/**
 * Commits a switch the user confirmed: the new setup first (so the sizes match the new gear), then each mosaic's
 * decision (`apply` for a missing one), then the plans and sizes again.
 */
export async function commitSetupSwitch(
  plan: Plan,
  newSetupId: string,
  items: SwitchItem[],
  decisions: ReadonlyMap<string, SwitchDecision>,
): Promise<void> {
  const plansStore = usePlansStore();
  const fovStore = useFovFramesStore();
  await plansStore.updatePlanSettings(plan.id, plan.nightOf, newSetupId, plan.lat, plan.lon);
  for (const item of items) {
    if (decisions.get(item.id) === 'drop') await item.drop();
    else await item.apply();
  }
  await plansStore.load();
  await fovStore.loadSpecs();
}
