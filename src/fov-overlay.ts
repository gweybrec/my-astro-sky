import { watch } from 'vue';
import { t } from './i18n';
import type { FovFrameSpec } from './sky-map';
import {
  buildGearSectionContent,
  type GearSectionPrefs,
} from './targets-view';
import {
  getTelescopes,
  getCameras,
  getAccessories,
  buildGearPreset,
} from './gear-catalog';
import { formatSetupCanvasLabel, fovDeg } from './gear-presets';
import { formatPaDeg } from './frame-orientation';
import { reportUnknownRendererError } from './error-reporter';
import { useFovFramesStore } from './stores/fov-frames';
import { useCanvasStore } from './stores/canvas';
import { usePlansStore } from './stores/plans';
import { useUiStore } from './stores/ui';
import {
  getGearSetups,
  createGearSetup,
  updateGearSetup,
  type GearSetupData,
} from './api';
import trashSvg from './icons/trash.svg?raw';
import anchorSvg from './icons/anchor.svg?raw';
import { confirmPlanEntryDelete } from './photo-delete-confirm';

// ─── State ───────────────────────────────────────────────────────────────────

export type FovSetup = GearSetupData;

// UI-only state (rotation + ribbon open/closed) — persisted in localStorage
export interface FovOverlayUiState {
  frameRotationDeg: number;
  ribbonOpen: boolean;
}

const UI_STATE_KEY = 'fov-overlay-ui-v2';

export function loadFovUiState(): FovOverlayUiState {
  // Clear legacy combined key so old setups don't linger
  localStorage.removeItem('fov-overlay-v1');
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FovOverlayUiState;
      return {
        frameRotationDeg: typeof parsed.frameRotationDeg === 'number' ? parsed.frameRotationDeg : 0,
        ribbonOpen: typeof parsed.ribbonOpen === 'boolean' ? parsed.ribbonOpen : true,
      };
    }
  } catch {
    // ignore parse errors
  }
  return { frameRotationDeg: 0, ribbonOpen: true };
}

export function saveFovUiState(state: FovOverlayUiState): void {
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

// ─── Frame spec builder ───────────────────────────────────────────────────────

export async function buildFovFrameSpecs(setups: FovSetup[]): Promise<FovFrameSpec[]> {
  const enabled = setups.filter(s => s.enabled);
  if (enabled.length === 0) return [];

  try {
    const [telescopes, cameras, accessories] = await Promise.all([
      getTelescopes(), getCameras(), getAccessories(),
    ]);

    const specs: FovFrameSpec[] = [];
    for (const setup of enabled) {
      const tel = telescopes.find(t => t.id === setup.telescopeId);
      const cam = cameras.find(c => c.id === setup.cameraId);
      const acc = setup.accessoryId ? accessories.find(a => a.id === setup.accessoryId) ?? null : null;
      if (!tel || !cam) continue;

      const preset = buildGearPreset(tel, cam, acc);
      const { wDeg, hDeg } = fovDeg(preset);
      specs.push({
        label: formatSetupCanvasLabel(setup.name, wDeg, hDeg),
        wDeg,
        hDeg,
      });
    }
    return specs;
  } catch (err) {
    reportUnknownRendererError('fov_build_specs', err);
    return [];
  }
}

// ─── Shared modal builder ────────────────────────────────────────────────────

function buildSetupModal(opts: {
  titleKey: string;
  initialName?: string;
  initialPrefs?: Partial<GearSectionPrefs>;
  onSave: (name: string, prefs: GearSectionPrefs) => Promise<void>;
}): void {
  let currentPrefs: GearSectionPrefs = {
    telescopeId: opts.initialPrefs?.telescopeId ?? '',
    cameraId: opts.initialPrefs?.cameraId ?? null,
    accessoryId: opts.initialPrefs?.accessoryId ?? null,
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('h2');
  title.textContent = t(opts.titleKey);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => backdrop.remove());

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body modal-form-body';

  // Name input row
  const nameRow = document.createElement('div');
  nameRow.style.display = 'flex';
  nameRow.style.flexDirection = 'column';
  nameRow.style.gap = 'var(--space-1)';

  const nameLabelEl = document.createElement('label');
  nameLabelEl.style.fontSize = 'var(--font-size-small)';
  nameLabelEl.style.color = 'var(--text-label)';
  nameLabelEl.textContent = t('fovOverlay.setupName');

  const requiredStar = document.createElement('span');
  requiredStar.className = 'required-star';
  requiredStar.textContent = ' *';
  nameLabelEl.appendChild(requiredStar);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'dialog-input';
  nameInput.value = opts.initialName ?? '';

  const nameError = document.createElement('span');
  nameError.className = 'input-error-msg hidden';
  nameError.textContent = t('fovOverlay.setupNameRequired');

  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('input-error');
    nameError.classList.add('hidden');
  });

  nameRow.appendChild(nameLabelEl);
  nameRow.appendChild(nameInput);
  nameRow.appendChild(nameError);
  body.appendChild(nameRow);

  const gearContainer = document.createElement('div');
  body.appendChild(gearContainer);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('targets.gear.cancel');
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-confirm';
  saveBtn.textContent = t('targets.gear.save');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('input-error');
      nameError.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    if (!currentPrefs.telescopeId || !currentPrefs.cameraId) return;

    saveBtn.disabled = true;
    try {
      await opts.onSave(name, currentPrefs);
      backdrop.remove();
    } catch (err) {
      reportUnknownRendererError('fov_save_setup', err);
      saveBtn.disabled = false;
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Load gear section
  Promise.all([getTelescopes(), getCameras()]).then(([telescopes, cameras]) => {
    if (!currentPrefs.telescopeId && telescopes.length > 0) currentPrefs.telescopeId = telescopes[0].id;
    if (!currentPrefs.cameraId && cameras.length > 0) currentPrefs.cameraId = cameras[0].id;
    const rebuild = (container: HTMLElement) => {
      buildGearSectionContent(container, currentPrefs, {
        onPrefsChange: (partial) => { Object.assign(currentPrefs, partial); },
        onRebuild: rebuild,
      });
    };
    rebuild(gearContainer);
  }).catch(err => {
    reportUnknownRendererError('fov_load_gear', err);
  });

  // Focus the name input after a tick
  requestAnimationFrame(() => nameInput.focus());
}

// ─── Add setup modal ──────────────────────────────────────────────────────────

export function openAddSetupModal(onSaved: (setup: FovSetup) => void, enabled = true): void {
  buildSetupModal({
    titleKey: 'fovOverlay.modalTitle',
    onSave: async (name, prefs) => {
      const { id } = await createGearSetup({
        name,
        telescopeId: prefs.telescopeId,
        cameraId: prefs.cameraId!,
        accessoryId: prefs.accessoryId,
        enabled,
      });
      onSaved({
        id,
        name,
        telescopeId: prefs.telescopeId,
        cameraId: prefs.cameraId!,
        accessoryId: prefs.accessoryId,
        enabled,
      });
    },
  });
}

// ─── Edit setup modal ─────────────────────────────────────────────────────────

export function openEditSetupModal(setup: FovSetup, onSaved: (updated: FovSetup) => void): void {
  buildSetupModal({
    titleKey: 'fovOverlay.editModalTitle',
    initialName: setup.name,
    initialPrefs: {
      telescopeId: setup.telescopeId,
      cameraId: setup.cameraId,
      accessoryId: setup.accessoryId,
    },
    onSave: async (name, prefs) => {
      await updateGearSetup(setup.id, {
        name,
        telescopeId: prefs.telescopeId,
        cameraId: prefs.cameraId!,
        accessoryId: prefs.accessoryId,
        enabled: setup.enabled,
      });
      onSaved({
        id: setup.id,
        name,
        telescopeId: prefs.telescopeId,
        cameraId: prefs.cameraId!,
        accessoryId: prefs.accessoryId,
        enabled: setup.enabled,
      });
    },
  });
}

// ─── FOV frame-manager popup ───────────────────────────────────────────────────

/**
 * Frame-manager popup: lists the interactive frame instances (plan-derived +
 * ad-hoc) with select / reset-rotation / delete actions, plus an "Add frame"
 * gear picker. Reactive to the fov-frames store; the returned element carries a
 * `__cleanup` hook the caller must invoke on close to stop the watcher.
 */
export function buildFovPopup(onClose: () => void, onReady?: () => void): HTMLElement & { __cleanup?: () => void } {
  const fovStore = useFovFramesStore();
  const plansStore = usePlansStore();
  const uiStore = useUiStore();

  // Populate the plan dropdown.
  plansStore.ensureLoaded();

  const popup = document.createElement('div') as HTMLElement & { __cleanup?: () => void };
  popup.className = 'fov-popup';

  // Suppress the sky tooltip while the cursor is over the popup.
  popup.addEventListener('mouseenter', () => uiStore.setForceSuppressTooltip(true));
  popup.addEventListener('mouseleave', () => uiStore.setForceSuppressTooltip(false));

  // Header
  const header = document.createElement('div');
  header.className = 'fov-popup-header';
  const headerTitle = document.createElement('span');
  headerTitle.textContent = t('fovOverlay.popupTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.style.fontSize = 'var(--font-size-sub)';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', onClose);
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Controls (mode dropdown + plan setup dropdown), padded off the popup edges.
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.flexDirection = 'column';
  controls.style.gap = 'var(--space-2)';
  controls.style.padding = 'var(--space-4) var(--space-6) 0';
  popup.appendChild(controls);

  // input-base's px-4 (16px) is larger than the popup's --space-6 (12px) gutter,
  // so the dropdown's text would sit deeper than the header title and list rows.
  // Outdent the box and trim its left padding so the text lands on the same
  // content column, while the right edge stays aligned with the close/action icons.
  function alignControlSelect(el: HTMLSelectElement): void {
    el.style.paddingLeft = 'var(--space-3)';
    el.style.marginLeft = 'calc(-1 * var(--space-3))';
    el.style.width = 'calc(100% + var(--space-3))';
  }

  // Mode dropdown: Free frames, each plan, or "+ New plan".
  const NEW_PLAN_VALUE = '__new_plan__';
  const FREE_VALUE = '__free__';
  const select = document.createElement('select');
  select.className = 'input-base w-full';
  alignControlSelect(select);
  select.addEventListener('change', () => onSelectChange());
  controls.appendChild(select);

  // Plan setup dropdown (plan mode only): choose the gear setup for the plan.
  // Persisted to the plan, so it reflects in the Targets & Plan tab.
  const setupSelect = document.createElement('select');
  setupSelect.className = 'input-base w-full';
  alignControlSelect(setupSelect);
  setupSelect.addEventListener('change', () => onSetupChange());
  controls.appendChild(setupSelect);

  // Gear setups for the setup dropdown (resolved async; labels include FOV).
  let gearSetups: GearSetupData[] = [];
  getGearSetups()
    .then(s => { gearSetups = s; renderAll(); })
    .catch(err => reportUnknownRendererError('fov_popup_load_setups', err));

  // Body (frame list)
  const body = document.createElement('div');
  body.className = 'fov-popup-body';
  popup.appendChild(body);

  // Footer (Add frame + picker) — free mode only.
  const footer = document.createElement('div');
  footer.className = 'fov-popup-footer';
  popup.appendChild(footer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-action';
  addBtn.style.width = '100%';
  addBtn.textContent = t('fovOverlay.addFrame');
  addBtn.addEventListener('click', () => {
    const sel = fovStore.selection;
    if (sel.kind === 'plan') addPlanFrameToCenter(sel.planId);
    else openSetupPicker();
  });
  footer.appendChild(addBtn);

  // Plan mode: spawn a custom-location frame at the centre of the current view
  // and add it to the plan. The frame is sized by the plan's gear setup.
  function addPlanFrameToCenter(planId: string): void {
    const skyMap = useCanvasStore().skyMap;
    if (!skyMap) return;
    skyMap.pinActiveIfFloating();
    const { ra, dec } = skyMap.viewCenterSky();
    fovStore.addPlanFrame(planId, ra, dec);
  }

  function defaultPlanName(): string {
    const nice = new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    return t('targets.plan.defaultName', { date: nice });
  }

  function renderSelect() {
    select.innerHTML = '';
    const free = document.createElement('option');
    free.value = FREE_VALUE;
    free.textContent = t('fovOverlay.freeFrames');
    select.appendChild(free);
    for (const plan of plansStore.plans) {
      const opt = document.createElement('option');
      opt.value = `plan:${plan.id}`;
      opt.textContent = plan.name;
      select.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = NEW_PLAN_VALUE;
    newOpt.textContent = t('fovOverlay.newPlan');
    select.appendChild(newOpt);

    const sel = fovStore.selection;
    select.value = sel.kind === 'plan' ? `plan:${sel.planId}` : FREE_VALUE;
    // "Add frame" is offered for free frames, and for a plan once it has a gear
    // setup (without one a plan can't size — and therefore can't render — frames).
    if (sel.kind === 'free') {
      footer.classList.remove('hidden');
    } else {
      const plan = plansStore.plans.find(p => p.id === sel.planId);
      footer.classList.toggle('hidden', !plan?.setupId);
    }
  }

  async function onSelectChange() {
    const v = select.value;
    if (v === NEW_PLAN_VALUE) {
      const id = await plansStore.createPlan(defaultPlanName());
      if (id) fovStore.setSelection({ kind: 'plan', planId: id });
      else renderSelect(); // creation failed — restore the previous selection
      return;
    }
    if (v === FREE_VALUE) { fovStore.setSelection({ kind: 'free' }); return; }
    if (v.startsWith('plan:')) fovStore.setSelection({ kind: 'plan', planId: v.slice(5) });
  }

  function renderSetupSelect() {
    const sel = fovStore.selection;
    const plan = sel.kind === 'plan' ? plansStore.plans.find(p => p.id === sel.planId) : undefined;
    // Setup dropdown is only meaningful for a plan.
    setupSelect.style.display = plan ? '' : 'none';
    if (!plan) return;

    setupSelect.innerHTML = '';
    if (!plan.setupId) {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = t('fovOverlay.pickSetup');
      setupSelect.appendChild(ph);
    }
    for (const s of gearSetups) {
      const opt = document.createElement('option');
      opt.value = s.id;
      // Label includes the FOV when the setup's gear resolves to a size.
      opt.textContent = fovStore.specs.get(s.id)?.label ?? s.name;
      setupSelect.appendChild(opt);
    }
    setupSelect.value = plan.setupId ?? '';
  }

  function onSetupChange() {
    const sel = fovStore.selection;
    if (sel.kind !== 'plan') return;
    const plan = plansStore.plans.find(p => p.id === sel.planId);
    if (!plan) return;
    const newSetupId = setupSelect.value || null;
    // Persist on the plan (shared with the Targets & Plan tab) and refresh.
    plansStore.updatePlanSettings(plan.id, plan.nightOf, newSetupId);
    fovStore.loadSpecs().then(() => renderAll());
  }

  function renderBody() {
    body.innerHTML = '';
    const frames = fovStore.renderables;

    if (fovStore.selection.kind === 'plan' && frames.length === 0) {
      // A plan with no gear setup can't size its frames.
      const plan = plansStore.plans.find(p => fovStore.selection.kind === 'plan' && p.id === fovStore.selection.planId);
      if (plan && !plan.setupId) {
        const hint = document.createElement('p');
        hint.style.color = 'var(--text-muted)';
        hint.style.fontSize = 'var(--font-size-small)';
        hint.style.margin = '0';
        hint.textContent = t('fovOverlay.planNeedsSetup');
        body.appendChild(hint);
        return;
      }
    }

    if (frames.length === 0) {
      const empty = document.createElement('p');
      empty.style.color = 'var(--text-muted)';
      empty.style.fontSize = 'var(--font-size-small)';
      empty.style.margin = '0';
      empty.textContent = t('fovOverlay.noFrames');
      body.appendChild(empty);
      return;
    }

    const isPlanMode = fovStore.selection.kind === 'plan';

    // Free mode: tristate "select all" controlling frame visibility on the map.
    if (!isPlanMode) {
      const anyHidden = frames.some(f => f.visible === false);
      const anyVisible = frames.some(f => f.visible !== false);
      const allVisible = !anyHidden;

      const selectAllRow = document.createElement('label');
      selectAllRow.className = 'fov-popup-select-all-row';
      const selectAllBox = document.createElement('input');
      selectAllBox.type = 'checkbox';
      selectAllBox.className = 'shrink-0';
      selectAllBox.checked = allVisible;
      selectAllBox.indeterminate = anyVisible && anyHidden;
      selectAllBox.addEventListener('change', () => fovStore.setAllAdhocVisible(selectAllBox.checked));
      const selectAllLabel = document.createElement('span');
      selectAllLabel.textContent = t('display.selectAll');
      selectAllRow.appendChild(selectAllBox);
      selectAllRow.appendChild(selectAllLabel);
      body.appendChild(selectAllRow);
    }

    for (const f of frames) {
      const row = document.createElement('div');
      row.className = 'fov-popup-setup-row';

      const isPlan = f.id.startsWith('plan:');

      // Free frames: a leading checkbox shows/hides the frame on the map.
      if (!isPlan) {
        const visBox = document.createElement('input');
        visBox.type = 'checkbox';
        visBox.className = 'shrink-0';
        visBox.checked = f.visible !== false;
        visBox.title = t('fovOverlay.showOnMap');
        visBox.addEventListener('click', (e) => e.stopPropagation());
        visBox.addEventListener('change', () => fovStore.setAdhocVisible(f.id, visBox.checked));
        row.appendChild(visBox);
      }

      // Clicking the name centres the frame on the map. Selecting/editing a
      // frame is done by clicking it on the canvas.
      const labelEl = document.createElement('div');
      labelEl.className = 'flex-1 cursor-pointer text-small';
      labelEl.title = t('fovOverlay.centerOnMap');
      labelEl.addEventListener('click', () => {
        useCanvasStore().skyMap?.centerFrameInView(f.id);
      });

      // Plan frames are named by their target DSO (or "custom location"); free
      // frames keep the gear-setup + FOV label.
      const nameSpan = document.createElement('span');
      // Active frame's name is emphasised + accent-coloured to match the canvas.
      nameSpan.className = f.active ? 'font-semibold text-[var(--accent-color)]' : 'text-primary';
      nameSpan.textContent = isPlan ? (f.anchorLabel ?? t('fovOverlay.customLocation')) : f.label;
      labelEl.appendChild(nameSpan);

      // Status line: floating/pinned state + PA readout (no gear label in plan
      // mode — it's shown once above the list).
      const status = document.createElement('span');
      status.style.display = 'block';
      status.style.fontSize = 'var(--font-size-micro)';
      status.style.color = 'var(--text-muted)';
      status.style.marginTop = '1px';
      const parts: string[] = [];
      if (f.anchorKind === 'screen') {
        parts.push(t('fovOverlay.floating'));
      } else if (!isPlan) {
        parts.push(f.anchorLabel ? `${t('fovOverlay.pinnedTo')} ${f.anchorLabel}` : t('fovOverlay.pinned'));
      }
      if (f.anchorKind === 'sky' && f.paDeg != null) {
        parts.push(`${t('fovOverlay.angleLabel')} ${formatPaDeg(f.paDeg)}`);
        status.title = t('fovOverlay.angleHelp');
      }
      status.textContent = parts.join(' · ');
      if (status.textContent) labelEl.appendChild(status);

      // Actions: anchor toggle + delete — identical for plan and free frames.
      const actions = document.createElement('div');
      actions.className = 'fov-popup-setup-actions';

      const anchorOn = f.anchorSnap !== false;
      const anchorBtn = document.createElement('button');
      anchorBtn.type = 'button';
      anchorBtn.className = anchorOn ? 'btn-icon btn-icon--active' : 'btn-icon';
      anchorBtn.setAttribute('aria-pressed', String(anchorOn));
      anchorBtn.innerHTML = anchorSvg;
      anchorBtn.title = anchorOn ? t('fovOverlay.anchorOn') : t('fovOverlay.anchorOff');
      anchorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const turningOn = !anchorOn;
        fovStore.toggleAnchorSnap(f.id);
        // Turning the anchor on re-runs detection and snaps the frame onto a
        // nearby DSO, exactly as pinning does with the anchor on.
        if (turningOn) useCanvasStore().skyMap?.resnapFrame(f.id);
      });
      actions.appendChild(anchorBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-icon--danger';
      deleteBtn.innerHTML = trashSvg;
      deleteBtn.title = t('fovOverlay.deleteFrame');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isPlan) {
          // Plan frames map to plan entries — confirm, then remove from the plan
          // (reflected in the Targets & Plan tab).
          const name = f.anchorLabel ?? t('fovOverlay.customLocation');
          if (await confirmPlanEntryDelete(name)) await fovStore.deletePlanFrame(f.id);
        } else {
          fovStore.removeFrame(f.id);
        }
      });
      actions.appendChild(deleteBtn);

      row.appendChild(labelEl);
      row.appendChild(actions);
      body.appendChild(row);
    }
  }

  // ── "Add frame" gear-setup picker ─────────────────────────────────────────
  function openSetupPicker() {
    getGearSetups().then(setups => {
      const enabledFirst = setups; // order as returned
      if (enabledFirst.length === 0) {
        // No gear yet — jump straight to setup creation, then add a frame for it.
        openAddSetupModal((created) => {
          useCanvasStore().skyMap?.pinActiveIfFloating();
          fovStore.loadSpecs().then(() => fovStore.addAdhocFrame(created.id));
        });
        return;
      }
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal settings-modal';
      const head = document.createElement('div');
      head.className = 'modal-header';
      const h2 = document.createElement('h2');
      h2.textContent = t('fovOverlay.pickSetup');
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'modal-close'; x.textContent = '×';
      x.addEventListener('click', () => backdrop.remove());
      head.appendChild(h2); head.appendChild(x);
      const bodyM = document.createElement('div');
      bodyM.className = 'modal-body modal-form-body';
      for (const s of enabledFirst) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-action';
        b.style.width = '100%';
        b.textContent = s.name;
        b.addEventListener('click', () => {
          useCanvasStore().skyMap?.pinActiveIfFloating();
          fovStore.addAdhocFrame(s.id);
          backdrop.remove();
        });
        bodyM.appendChild(b);
      }
      const foot = document.createElement('div');
      foot.className = 'modal-footer';
      const newSetupBtn = document.createElement('button');
      newSetupBtn.type = 'button';
      newSetupBtn.className = 'btn-cancel';
      newSetupBtn.textContent = t('fovOverlay.addSetup');
      newSetupBtn.addEventListener('click', () => {
        backdrop.remove();
        openAddSetupModal((created) => {
          useCanvasStore().skyMap?.pinActiveIfFloating();
          fovStore.loadSpecs().then(() => fovStore.addAdhocFrame(created.id));
        });
      });
      foot.appendChild(newSetupBtn);
      modal.appendChild(head); modal.appendChild(bodyM); modal.appendChild(foot);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
    }).catch(err => reportUnknownRendererError('fov_pick_setup', err));
  }

  function renderAll() {
    renderSelect();
    renderSetupSelect();
    renderBody();
    // Dim the frame list when the master toggle hides frames from the map.
    body.classList.toggle('opacity-50', !fovStore.framesVisible);
    body.classList.toggle('pointer-events-none', !fovStore.framesVisible);
  }

  // React to store changes; clean up on close. The dropdowns depend on the plan
  // list + selection + each plan's setup; the body depends on the resolved frames.
  const stopFrames = watch(() => fovStore.renderables, () => renderBody(), { deep: true });
  const stopSelect = watch(
    () => [fovStore.selection, plansStore.plans.map(p => `${p.id}:${p.name}:${p.setupId}`).join(',')],
    () => renderAll(),
    { deep: true },
  );
  const stopVisible = watch(() => fovStore.framesVisible, () => renderAll());
  renderAll();

  popup.__cleanup = () => {
    stopFrames();
    stopSelect();
    stopVisible();
    uiStore.setForceSuppressTooltip(false);
  };

  // Defer onReady so the popup is in the DOM and can be positioned.
  requestAnimationFrame(() => onReady?.());

  return popup;
}
