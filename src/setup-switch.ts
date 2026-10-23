import { t } from './i18n';
import { reportUnknownRendererError } from './error-reporter';
import {
  commitSetupSwitch,
  setupSwitchItems,
  switchProposalText,
  switchSetupDirectly,
  type SwitchDecision,
  type SwitchItem,
} from '@myastrosky/app-state/setup-switch';
import type { Plan } from './api';

/**
 * Shared "switch a plan's gear setup" flow, used both by the sky-view FOV popup
 * and the Plans list in the Targets tab. Changing a setup re-sizes every frame;
 * mosaics (tile grids and smart-scope enlarged frames) can't always re-fit
 * cleanly, so the shared part (packages/app-state/src/setup-switch.ts) finds them
 * and this module surfaces a per-mosaic Apply/Drop confirmation modal before
 * committing the switch.
 */

/** Callbacks the host call site supplies so this module stays UI-agnostic. */
export type SetupSwitchHooks = {
  /** Restore the host dropdown to the old setup (cancel / failure / revert). */
  onRevert: () => void;
  /** Re-render the host view after the specs/plan have been reloaded. */
  onApplied: () => void;
};

/**
 * Entry point for a setup switch. Reads the plan's current setup as the "old"
 * one, and either commits the switch directly (no mosaics to reconcile, or
 * clearing the setup) or opens the confirmation modal.
 */
export async function requestSetupSwitch(
  plan: Plan,
  newSetupId: string | null,
  hooks: SetupSwitchHooks,
): Promise<void> {
  if (newSetupId === plan.setupId) return;
  // Switching to no setup, or no mosaic needs a decision: apply the switch directly.
  const items = await setupSwitchItems(plan, newSetupId);
  if (items.length === 0 || !newSetupId) {
    void switchSetupDirectly(plan, newSetupId).then(() => hooks.onApplied());
    return;
  }
  openSetupSwitchModal(plan, newSetupId, items, hooks);
}

/**
 * Confirmation modal shown when a setup switch would disturb existing mosaics:
 * one row per mosaic showing its best transformation to the new setup, with an
 * Apply/Drop choice. OK (enabled once every row is decided) commits the switch
 * then each decision; Cancel reverts the host dropdown to the previous setup.
 */
export function openSetupSwitchModal(
  plan: Plan,
  newSetupId: string,
  items: SwitchItem[],
  hooks: SetupSwitchHooks,
): void {
  const decisions = new Map<string, SwitchDecision>();

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
    proposal.textContent = switchProposalText(item.transform);
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
      await commitSetupSwitch(plan, newSetupId, items, decisions);
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
