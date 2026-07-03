import { t } from './i18n';
import { formatFov } from './gear-presets';
import { reportUnknownRendererError } from './error-reporter';
import { useFovFramesStore } from './stores/fov-frames';
import { usePlansStore } from './stores/plans';
import { getDSOById } from './dso-catalog';
import { tileCenters, outlineFromGrid, transformMosaicToSetup } from './mosaic';
import type { TargetFov, MosaicTransform } from './mosaic';
import type { Plan } from './api';
import { updatePlanEntryPositionAPI } from './api';

/**
 * Shared "switch a plan's gear setup" flow, used both by the sky-view FOV popup
 * and the Plans list in the Targets tab. Changing a setup re-sizes every frame;
 * mosaics (tile grids and smart-scope enlarged frames) can't always re-fit
 * cleanly, so this module detects them and surfaces a per-mosaic Apply/Drop
 * confirmation modal before committing the switch.
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

/** Resolved angular size + envelope for a setup, read from the fov-frames store. */
export type SetupSpecLite = {
  wDeg: number;
  hDeg: number;
  smart: boolean;
  mosaic: TargetFov['envelope'];
};

/** A mosaic (tile grid or enlarged smart frame) that doesn't map cleanly onto a
 * new setup: its proposed best transformation, plus the actions to commit or
 * drop it. Surfaced as one decision row in the setup-switch modal. */
export type SwitchItem = {
  id: string;
  label: string;
  transform: MosaicTransform;
  apply: () => Promise<void>;
  drop: () => Promise<void>;
};

/** Callbacks the host call site supplies so this module stays UI-agnostic. */
export type SetupSwitchHooks = {
  /** Restore the host dropdown to the old setup (cancel / failure / revert). */
  onRevert: () => void;
  /** Re-render the host view after the specs/plan have been reloaded. */
  onApplied: () => void;
};

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
      label: mosaic.name ?? (dso ? (dso.displayName ?? dso.id) : t('fovOverlay.customLocation')),
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
      label: dso ? (dso.displayName ?? dso.id) : t('fovOverlay.customLocation'),
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
 * Entry point for a setup switch. Reads the plan's current setup as the "old"
 * one, resolves both specs, and either commits the switch directly (no mosaics
 * to reconcile, or clearing the setup) or opens the confirmation modal.
 */
export async function requestSetupSwitch(
  plan: Plan,
  newSetupId: string | null,
  hooks: SetupSwitchHooks,
): Promise<void> {
  const plansStore = usePlansStore();
  const fovStore = useFovFramesStore();
  const oldSetupId = plan.setupId;
  if (newSetupId === oldSetupId) return;

  const proceed = (): void => {
    plansStore.updatePlanSettings(plan.id, plan.nightOf, newSetupId, plan.lat, plan.lon);
    fovStore.loadSpecs().then(() => hooks.onApplied());
  };

  // Switching to no setup (or with both setups resolved) — build the list of
  // mosaics that need a decision. None ⇒ apply the switch directly.
  await fovStore.loadSpecs();
  const oldSpec = oldSetupId ? fovStore.specs.get(oldSetupId) : undefined;
  const newSpec = newSetupId ? fovStore.specs.get(newSetupId) : undefined;
  const items = newSpec && oldSpec ? collectSwitchItems(plan, oldSpec, newSpec) : [];
  if (items.length === 0 || !newSetupId) {
    proceed();
    return;
  }
  openSetupSwitchModal(plan, oldSetupId, newSetupId, items, hooks);
}

/**
 * Confirmation modal shown when a setup switch would disturb existing mosaics:
 * one row per mosaic showing its best transformation to the new setup, with an
 * Apply/Drop choice. OK (enabled once every row is decided) commits the switch
 * then each decision; Cancel reverts the host dropdown to the previous setup.
 */
export function openSetupSwitchModal(
  plan: Plan,
  oldSetupId: string | null,
  newSetupId: string,
  items: SwitchItem[],
  hooks: SetupSwitchHooks,
): void {
  const plansStore = usePlansStore();
  const fovStore = useFovFramesStore();
  const decisions = new Map<string, 'apply' | 'drop'>();

  const proposalText = (tr: MosaicTransform): string =>
    tr.kind === 'grid'
      ? `${tr.cols}×${tr.rows} · ${formatFov(tr.wDeg, tr.hDeg)}`
      : `${t('fovOverlay.switchSingleFrame')} · ${formatFov(tr.wDeg, tr.hDeg)}`;

  // The `.modal-backdrop` below is auto-detected as an open modal, so the sky
  // tooltip stays suppressed for the whole lifetime of this dialog.
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  const close = (revert: boolean): void => {
    if (revert) hooks.onRevert();
    backdrop.remove();
  };

  const head = document.createElement('div');
  head.className = 'modal-header';
  const h2 = document.createElement('h2');
  h2.textContent = t('fovOverlay.switchSetupTitle');
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'modal-close';
  x.textContent = '×';
  x.addEventListener('click', () => close(true));
  head.appendChild(h2);
  head.appendChild(x);

  const bodyM = document.createElement('div');
  bodyM.className = 'modal-body modal-form-body flex flex-col gap-3';
  const intro = document.createElement('p');
  intro.className = 'text-small text-muted m-0';
  intro.textContent = t('fovOverlay.switchSetupIntro');
  bodyM.appendChild(intro);

  const foot = document.createElement('div');
  foot.className = 'modal-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-cancel';
  cancel.textContent = t('targets.gear.cancel');
  cancel.addEventListener('click', () => close(true));
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn-confirm';
  ok.textContent = t('fovOverlay.switchConfirm');
  // Look disabled (and explain via tooltip) until every mosaic is decided, but
  // keep the button enabled so the native title surfaces on hover; the click
  // handler guards the incomplete case. (A real `disabled` swallows the tooltip.)
  const incomplete = (): boolean => decisions.size !== items.length;
  const refreshOk = (): void => {
    const bad = incomplete();
    ok.classList.toggle('opacity-40', bad);
    ok.classList.toggle('cursor-not-allowed', bad);
    ok.title = bad ? t('fovOverlay.switchConfirmHint') : '';
  };

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3';

    const info = document.createElement('div');
    info.className = 'flex-1 min-w-0';
    const name = document.createElement('div');
    name.className = 'text-small text-primary truncate';
    name.textContent = item.label;
    const proposal = document.createElement('div');
    proposal.className = 'text-micro text-muted';
    proposal.textContent = proposalText(item.transform);
    info.append(name, proposal);

    const toggle = document.createElement('div');
    toggle.className = 'flex gap-1 shrink-0';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn-icon';
    applyBtn.textContent = t('fovOverlay.switchApply');
    const dropBtn = document.createElement('button');
    dropBtn.type = 'button';
    dropBtn.className = 'btn-icon';
    dropBtn.textContent = t('fovOverlay.switchDrop');
    const paint = (): void => {
      const d = decisions.get(item.id);
      applyBtn.className = d === 'apply' ? 'btn-icon--active' : 'btn-icon';
      dropBtn.className = d === 'drop' ? 'btn-icon--danger-active' : 'btn-icon';
    };
    applyBtn.addEventListener('click', () => {
      decisions.set(item.id, 'apply');
      paint();
      refreshOk();
    });
    dropBtn.addEventListener('click', () => {
      decisions.set(item.id, 'drop');
      paint();
      refreshOk();
    });
    toggle.append(applyBtn, dropBtn);

    row.append(info, toggle);
    bodyM.appendChild(row);
  }

  ok.addEventListener('click', async () => {
    if (incomplete()) return; // still looks disabled — wait for every decision
    ok.disabled = true;
    cancel.disabled = true;
    try {
      // Persist the new setup first so the spec context matches the new gear.
      await plansStore.updatePlanSettings(plan.id, plan.nightOf, newSetupId, plan.lat, plan.lon);
      for (const item of items) {
        if (decisions.get(item.id) === 'drop') await item.drop();
        else await item.apply();
      }
      await plansStore.load();
      await fovStore.loadSpecs();
      hooks.onApplied();
      close(false);
    } catch (err) {
      reportUnknownRendererError('fov_switch_setup_apply', err, { planId: plan.id });
      close(true);
    }
  });

  refreshOk();
  foot.append(cancel, ok);
  modal.appendChild(head);
  modal.appendChild(bodyM);
  modal.appendChild(foot);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
