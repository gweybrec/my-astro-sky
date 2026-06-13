import { t } from './i18n';
import type { FovFrameSpec } from './sky-map';
import type { SkyMap } from './sky-map';
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
import { formatGearFovLabel, formatSetupCanvasLabel, fovDeg } from './gear-presets';
import { reportUnknownRendererError } from './error-reporter';
import {
  getGearSetups,
  createGearSetup,
  updateGearSetup,
  patchGearSetupEnabled,
  deleteGearSetupAPI,
  type GearSetupData,
} from './api';
import trashSvg from './icons/trash.svg?raw';
import penSvg from './icons/pen.svg?raw';

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

// ─── FOV popup ───────────────────────────────────────────────────────────────

export function buildFovPopup(
  skyMap: SkyMap,
  onFramesChanged: (setups: FovSetup[]) => void,
  onClose: () => void,
  onReady?: () => void,
): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'fov-popup';

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

  // Body
  const body = document.createElement('div');
  body.className = 'fov-popup-body';
  popup.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'fov-popup-footer';
  popup.appendChild(footer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-action';
  addBtn.style.width = '100%';
  addBtn.textContent = t('fovOverlay.addSetup');
  addBtn.addEventListener('click', () => {
    openAddSetupModal(() => {
      reload(() => onFramesChanged(setups));
    });
  });
  footer.appendChild(addBtn);

  // Local state
  let setups: FovSetup[] = [];
  let gearCatalogs: { tels: any[]; cams: any[]; accs: any[] } | null = null;

  // Enabled toggle debounce map
  const toggleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  let isFirstRender = true;

  function reload(onComplete?: () => void) {
    body.innerHTML = '';
    if (!isFirstRender) {
      const spinner = document.createElement('div');
      spinner.className = 'modal-loading-placeholder';
      spinner.innerHTML = '<div class="auto-solve-spinner"></div>';
      body.appendChild(spinner);
    }

    Promise.all([
      getGearSetups(),
      gearCatalogs
        ? Promise.resolve(gearCatalogs)
        : Promise.all([getTelescopes(), getCameras(), getAccessories()]).then(([tels, cams, accs]) => {
            gearCatalogs = { tels, cams, accs };
            return gearCatalogs;
          }),
    ]).then(([loaded]) => {
      setups = loaded;
      renderBody();
      onComplete?.();
      if (isFirstRender) {
        isFirstRender = false;
        onReady?.();
      }
    }).catch(err => {
      reportUnknownRendererError('fov_popup_load', err);
      body.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'modal-loading-error';
      errEl.textContent = String(err?.message ?? err);
      body.appendChild(errEl);
      if (isFirstRender) {
        isFirstRender = false;
        onReady?.();
      }
    });
  }

  function renderBody() {
    body.innerHTML = '';

    if (setups.length === 0) {
      const empty = document.createElement('p');
      empty.style.color = 'var(--text-muted)';
      empty.style.fontSize = 'var(--font-size-small)';
      empty.style.margin = '0';
      empty.textContent = t('fovOverlay.noSetups');
      body.appendChild(empty);
      return;
    }

    // Select-all tristate row
    const selectAllRow = document.createElement('label');
    selectAllRow.className = 'fov-popup-select-all-row';

    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.style.margin = '0';

    const selectAllLabel = document.createElement('span');
    selectAllLabel.textContent = t('fovOverlay.selectAll');

    selectAllRow.appendChild(selectAllCb);
    selectAllRow.appendChild(selectAllLabel);
    body.appendChild(selectAllRow);

    function updateSelectAllState() {
      const total = setups.length;
      const enabledCount = setups.filter(s => s.enabled).length;
      selectAllCb.indeterminate = enabledCount > 0 && enabledCount < total;
      selectAllCb.checked = enabledCount === total;
    }

    selectAllCb.addEventListener('change', () => {
      const checked = selectAllCb.checked;
      const toToggle = setups.filter(s => s.enabled !== checked);
      setups.forEach(s => { s.enabled = checked; });
      Promise.all(toToggle.map(s => patchGearSetupEnabled(s.id, checked))).catch(err => {
        reportUnknownRendererError('fov_toggle_all', err);
      });
      renderBody();
      onFramesChanged(setups);
    });

    // Per-setup rows
    for (const setup of setups) {
      const row = document.createElement('div');
      row.className = 'fov-popup-setup-row';

      const labelEl = document.createElement('label');
      labelEl.style.display = 'flex';
      labelEl.style.alignItems = 'flex-start';
      labelEl.style.gap = 'var(--space-3)';
      labelEl.style.cursor = 'pointer';
      labelEl.style.fontSize = 'var(--font-size-small)';
      labelEl.style.color = 'var(--text-primary)';
      labelEl.style.flex = '1';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = setup.enabled;
      cb.style.marginTop = '2px';
      cb.style.flexShrink = '0';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = setup.name;

      // Compute FOV detail line
      if (gearCatalogs) {
        const tel = gearCatalogs.tels.find(t => t.id === setup.telescopeId);
        const cam = gearCatalogs.cams.find(c => c.id === setup.cameraId);
        const acc = setup.accessoryId ? gearCatalogs.accs.find(a => a.id === setup.accessoryId) ?? null : null;
        if (tel && cam) {
          const preset = buildGearPreset(tel, cam, acc);
          const fovDetail = `${t('targets.gear.effectiveFocalLength')}: ${formatGearFovLabel(preset)}`;
          const fovSpan = document.createElement('span');
          fovSpan.textContent = fovDetail;
          fovSpan.style.display = 'block';
          fovSpan.style.fontSize = 'var(--font-size-micro)';
          fovSpan.style.color = 'var(--text-muted)';
          fovSpan.style.marginTop = '1px';
          fovSpan.style.whiteSpace = 'nowrap';
          nameSpan.appendChild(fovSpan);
        }
      }

      cb.addEventListener('change', () => {
        setup.enabled = cb.checked;
        updateSelectAllState();
        onFramesChanged(setups);  // use in-memory state — no API fetch race
        // Debounced API call
        const prev = toggleTimers.get(setup.id);
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => {
          patchGearSetupEnabled(setup.id, setup.enabled).catch(err => {
            reportUnknownRendererError('fov_toggle_enabled', err);
          });
          toggleTimers.delete(setup.id);
        }, 150);
        toggleTimers.set(setup.id, timer);
      });

      labelEl.appendChild(cb);
      labelEl.appendChild(nameSpan);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'fov-popup-setup-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon';
      editBtn.innerHTML = penSvg;
      editBtn.title = t('fovOverlay.editModalTitle');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditSetupModal(setup, () => {
          reload(() => onFramesChanged(setups));
        });
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-icon--danger';
      deleteBtn.innerHTML = trashSvg;
      deleteBtn.title = t('photos.delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteGearSetupAPI(setup.id).then(() => {
          reload(() => onFramesChanged(setups));
        }).catch(err => {
          reportUnknownRendererError('fov_delete_setup', err);
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(labelEl);
      row.appendChild(actions);
      body.appendChild(row);
    }

    updateSelectAllState();
  }

  reload();

  return popup;
}
