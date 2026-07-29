import { watch } from 'vue';
import { t } from './i18n';
import type { FovFrameSpec } from './sky-map';
import type { DSO } from './types';
import { buildGearSectionContent, type GearSectionPrefs } from './targets-view';
import {
  getTelescopes,
  getCameras,
  getAccessories,
  buildGearPreset,
  resolveSetupCamera,
} from './gear-catalog';
import { formatSetupCanvasLabel, formatFov, fovDeg } from './gear-presets';
import { formatPaDeg } from './frame-orientation';
import { reportUnknownRendererError } from './error-reporter';
import { useFovFramesStore } from './stores/fov-frames';
import { useCanvasStore } from './stores/canvas';
import { usePlansStore } from './stores/plans';
import { useUiStore } from './stores/ui';
import { getDSOById } from './dso-catalog';
import { customLocationLabel } from './star-catalog';
import { autoRegionForDsos, planGrid, tileCenters } from './mosaic';
import { requestSetupSwitch } from './setup-switch';
import { searchDSOs } from './search';
import type { MosaicParams } from './api';
import {
  getGearSetups,
  createGearSetup,
  updateGearSetup,
  deleteGearSetupAPI,
  type GearSetupData,
} from './api';
import trashSvg from './icons/trash.svg?raw';
import anchorSvg from './icons/anchor.svg?raw';
import penSvg from './icons/pen.svg?raw';
import plusSvg from './icons/plus.svg?raw';
import addFrameSvg from './icons/add-frame.svg?raw';
import addMosaicSvg from './icons/add-mosaic.svg?raw';
import planListSvg from './icons/plan-list.svg?raw';
import listPlusSvg from './icons/list-plus.svg?raw';
import {
  confirmMosaicDelete,
  confirmPlanEntryDelete,
  confirmSetupDelete,
} from './photo-delete-confirm';
import { showToast } from './toast';
import { deleteFrameWithUndo } from './frame-delete';

// ─── State ───────────────────────────────────────────────────────────────────

export type FovSetup = GearSetupData;

/**
 * Display name for a custom-location frame (no target DSO): the nearest named star,
 * else the generic "custom location" string. Display-only — never affects anchoring.
 */
function customFrameLabel(f: { ra?: number; dec?: number }): string {
  return f.ra != null && f.dec != null
    ? customLocationLabel(f.ra, f.dec)
    : t('fovOverlay.customLocation');
}

/** Great-circle angular distance between two sky points, in degrees. */
function angularDistDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d2r = Math.PI / 180;
  const dLat = (dec2 - dec1) * d2r;
  const dLon = (ra2 - ra1) * d2r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / d2r;
}

// ─── Frame spec builder ───────────────────────────────────────────────────────

export async function buildFovFrameSpecs(setups: FovSetup[]): Promise<FovFrameSpec[]> {
  const enabled = setups.filter((s) => s.enabled);
  if (enabled.length === 0) return [];

  try {
    const [telescopes, cameras, accessories] = await Promise.all([
      getTelescopes(),
      getCameras(),
      getAccessories(),
    ]);

    const specs: FovFrameSpec[] = [];
    for (const setup of enabled) {
      const tel = telescopes.find((t) => t.id === setup.telescopeId);
      if (!tel) continue;
      const cam = resolveSetupCamera(tel, cameras, setup.cameraId);
      const acc = setup.accessoryId
        ? (accessories.find((a) => a.id === setup.accessoryId) ?? null)
        : null;
      if (!cam) continue;

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
  /** Edit mode only: id of the setup being edited. Enables the plans-using list
   *  and the delete button. */
  setupId?: string;
  /** Edit mode only: called after the setup is deleted (caller refreshes). */
  onDeleted?: () => void;
}): void {
  const uiStore = useUiStore();
  let currentPrefs: GearSectionPrefs = {
    telescopeId: opts.initialPrefs?.telescopeId ?? '',
    cameraId: opts.initialPrefs?.cameraId ?? null,
    accessoryId: opts.initialPrefs?.accessoryId ?? null,
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const close = (): void => {
    backdrop.remove();
  };

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
  closeBtn.addEventListener('click', close);

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

  // Edit mode: a read-only list of plans that use this setup. Doubles as the
  // explanation for why the delete button is disabled. Filled async below.
  const plansSection = document.createElement('div');
  plansSection.className = 'flex flex-col gap-1 hidden';
  const plansLabel = document.createElement('label');
  plansLabel.style.fontSize = 'var(--font-size-small)';
  plansLabel.style.color = 'var(--text-label)';
  plansLabel.textContent = t('fovOverlay.usedByPlans');
  const plansList = document.createElement('ul');
  plansList.className = 'text-small text-primary';
  plansList.style.margin = '0';
  plansList.style.paddingLeft = 'var(--space-4)';
  plansSection.appendChild(plansLabel);
  plansSection.appendChild(plansList);
  body.appendChild(plansSection);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  // Edit mode: a delete button on the left, separated from cancel/save.
  let deleteBtn: HTMLButtonElement | null = null;
  if (opts.setupId) {
    deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger mr-auto';
    deleteBtn.textContent = t('photos.delete');
    deleteBtn.disabled = true; // re-enabled once we know no plan uses the setup
    footer.appendChild(deleteBtn);

    const setupId = opts.setupId;
    const plansStore = usePlansStore();
    plansStore
      .ensureLoaded()
      .then(() => {
        const using = plansStore.plansUsingSetup(setupId);
        if (using.length > 0) {
          plansSection.classList.remove('hidden');
          plansList.innerHTML = '';
          for (const p of using) {
            const li = document.createElement('li');
            li.textContent = p.name;
            plansList.appendChild(li);
          }
          deleteBtn!.disabled = true;
          deleteBtn!.title = t('fovOverlay.deleteSetupDisabledTooltip');
        } else {
          deleteBtn!.disabled = false;
          deleteBtn!.title = '';
        }
      })
      .catch((err) => reportUnknownRendererError('fov_setup_plans', err));

    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn!.disabled) return;
      if (!(await confirmSetupDelete(opts.initialName ?? ''))) return;
      deleteBtn!.disabled = true;
      try {
        await deleteGearSetupAPI(setupId);
        close();
        opts.onDeleted?.();
      } catch (err) {
        showToast({
          message: String((err as Error)?.message ?? err),
          type: 'error',
          duration: 3500,
        });
        deleteBtn!.disabled = false;
      }
    });
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('targets.gear.cancel');
  cancelBtn.addEventListener('click', close);

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
      close();
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
  Promise.all([getTelescopes(), getCameras()])
    .then(([telescopes, cameras]) => {
      if (!currentPrefs.telescopeId && telescopes.length > 0)
        currentPrefs.telescopeId = telescopes[0].id;
      // A smart telescope's sealed-in sensor always wins; only fall back to the first
      // catalog camera for scopes where the user actually gets to pick one.
      const tel = telescopes.find((t) => t.id === currentPrefs.telescopeId);
      const resolved = tel ? resolveSetupCamera(tel, cameras, currentPrefs.cameraId) : null;
      if (resolved) currentPrefs.cameraId = resolved.id;
      else if (!currentPrefs.cameraId && cameras.length > 0) currentPrefs.cameraId = cameras[0].id;
      const rebuild = (container: HTMLElement) => {
        buildGearSectionContent(container, currentPrefs, {
          onPrefsChange: (partial) => {
            Object.assign(currentPrefs, partial);
          },
          onRebuild: rebuild,
        });
      };
      rebuild(gearContainer);
    })
    .catch((err) => {
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

export function openEditSetupModal(
  setup: FovSetup,
  onSaved: (updated: FovSetup) => void,
  onDeleted?: () => void,
): void {
  buildSetupModal({
    titleKey: 'fovOverlay.editModalTitle',
    initialName: setup.name,
    initialPrefs: {
      telescopeId: setup.telescopeId,
      cameraId: setup.cameraId,
      accessoryId: setup.accessoryId,
    },
    setupId: setup.id,
    onDeleted,
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

/**
 * Gear-setup picker modal. Calls `onPick(setupId)` with the chosen setup. With no
 * eligible gear yet, jumps straight to setup creation, then picks the new setup.
 * When `excludeSmart` is set, smart-telescope setups are filtered out (they have
 * their own mosaic mode) — used by the "add mosaic" flow.
 */
export function openSetupPicker(
  onPick: (setupId: string) => void,
  opts: { excludeSmart?: boolean } = {},
): void {
  Promise.all([getGearSetups(), opts.excludeSmart ? getTelescopes() : Promise.resolve([])])
    .then(([setups, tels]) => {
      const smartIds = new Set(
        (tels as Array<{ id: string; is_smart_telescope?: boolean }>)
          .filter((t) => t.is_smart_telescope)
          .map((t) => t.id),
      );
      const list = opts.excludeSmart ? setups.filter((s) => !smartIds.has(s.telescopeId)) : setups;
      // After creating a fresh setup, resolve its spec before picking it (so the
      // new frame/mosaic can size immediately).
      const pickNew = (created: FovSetup) =>
        useFovFramesStore()
          .loadSpecs()
          .then(() => onPick(created.id));
      if (list.length === 0) {
        openAddSetupModal(pickNew);
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
      x.type = 'button';
      x.className = 'modal-close';
      x.textContent = '×';
      x.addEventListener('click', () => backdrop.remove());
      head.appendChild(h2);
      head.appendChild(x);
      const bodyM = document.createElement('div');
      bodyM.className = 'modal-body modal-form-body';
      for (const s of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-action';
        b.style.width = '100%';
        b.textContent = s.name;
        b.addEventListener('click', () => {
          backdrop.remove();
          onPick(s.id);
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
        openAddSetupModal(pickNew);
      });
      foot.appendChild(newSetupBtn);
      modal.appendChild(head);
      modal.appendChild(bodyM);
      modal.appendChild(foot);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
    })
    .catch((err) => reportUnknownRendererError('fov_pick_setup', err));
}

/**
 * Combined "create a frame/mosaic" picker shown from a DSO tooltip: lets the
 * user add directly into an existing (or brand-new) plan — sized by the plan's
 * own gear setup — or as a free-standing frame/mosaic sized by a picked (or
 * brand-new) gear setup. Unlike {@link openSetupPicker} (still used by the FOV
 * popup's own footer, which already knows whether it's in plan or free mode),
 * this always offers both destinations since the tooltip has no prior context.
 *
 * `onSetupPick(setupId)` fires for the free-frame branches — same contract as
 * `openSetupPicker`, the caller builds the ad-hoc frame/mosaic itself.
 * `onDone()` fires after either plan branch, since those are handled internally.
 */
export function openFramePicker(
  kind: 'frame' | 'mosaic',
  dso: { id: string; ra: number; dec: number },
  onSetupPick: (setupId: string) => void,
  onDone: () => void,
  // When the target is not a catalogued DSO (e.g. a star), plan entries are added as
  // custom-location entries (dsoId null) instead of DSO-anchored ones.
  custom = false,
): void {
  const fovStore = useFovFramesStore();
  const plansStore = usePlansStore();

  Promise.all([
    plansStore.ensureLoaded(),
    getGearSetups(),
    kind === 'mosaic' ? getTelescopes() : Promise.resolve([]),
  ])
    .then(([, setups, tels]) => {
      const smartTelIds = new Set(
        (tels as Array<{ id: string; is_smart_telescope?: boolean }>)
          .filter((t) => t.is_smart_telescope)
          .map((t) => t.id),
      );
      const setupIsSmart = (setupId: string | null): boolean =>
        !!setupId && smartTelIds.has(setups.find((s) => s.id === setupId)?.telescopeId ?? '');

      // Smart scopes have their own single-frame mosaic mode, so mosaics exclude
      // them from both sections; plans with no setup at all stay eligible either
      // way (the graceful single-tile fallback handles that case).
      const freeSetups =
        kind === 'mosaic' ? setups.filter((s) => !smartTelIds.has(s.telescopeId)) : setups;
      const eligiblePlans =
        kind === 'mosaic'
          ? plansStore.plans.filter((p) => !p.setupId || !setupIsSmart(p.setupId))
          : plansStore.plans;

      buildFramePickerModal(
        kind,
        dso,
        eligiblePlans,
        freeSetups,
        fovStore,
        plansStore,
        onSetupPick,
        onDone,
        custom,
      );
    })
    .catch((err) => reportUnknownRendererError('fov_pick_frame_target', err));
}

function buildFramePickerModal(
  kind: 'frame' | 'mosaic',
  dso: { id: string; ra: number; dec: number },
  eligiblePlans: ReturnType<typeof usePlansStore>['plans'],
  freeSetups: FovSetup[],
  fovStore: ReturnType<typeof useFovFramesStore>,
  plansStore: ReturnType<typeof usePlansStore>,
  onSetupPick: (setupId: string) => void,
  onDone: () => void,
  custom = false,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';
  const close = () => backdrop.remove();

  const head = document.createElement('div');
  head.className = 'modal-header';
  const h2 = document.createElement('h2');
  h2.textContent = t(
    kind === 'frame' ? 'fovOverlay.createFrameTitle' : 'fovOverlay.createMosaicTitle',
  );
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'modal-close';
  x.textContent = '×';
  x.addEventListener('click', close);
  head.appendChild(h2);
  head.appendChild(x);

  const bodyM = document.createElement('div');
  bodyM.className = 'modal-body modal-form-body';
  const gridClass = 'grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2';

  function defaultPlanName(): string {
    const nice = new Date().toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return t('targets.plan.defaultName', { date: nice });
  }

  async function doPlanAction(planId: string): Promise<void> {
    if (kind === 'frame') {
      // A star (custom target) has no catalogued DSO, so it becomes a custom-location
      // plan entry at its coords; the entry then displays as the nearest named star.
      if (custom) await plansStore.addCustomEntry(planId, dso.ra, dso.dec);
      else await plansStore.addEntry(planId, dso.id);
      fovStore.setSelection({ kind: 'plan', planId });
    } else {
      await fovStore.addAdhocMosaicToPlan(planId, dso.ra, dso.dec, custom ? null : dso.id);
    }
  }

  // ── "Add to a plan" section ────────────────────────────────────────────────
  const planSection = document.createElement('div');
  planSection.className = 'flex flex-col gap-2';
  const planLabel = document.createElement('div');
  planLabel.className = 'text-small text-label uppercase';
  planLabel.textContent = t('targets.plan.addToPlan');
  planSection.appendChild(planLabel);
  const planGridEl = document.createElement('div');
  planGridEl.className = gridClass;
  for (const plan of eligiblePlans) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-action';
    b.textContent = plan.name;
    b.addEventListener('click', () => {
      close();
      doPlanAction(plan.id).then(onDone);
    });
    planGridEl.appendChild(b);
  }
  planSection.appendChild(planGridEl);
  const newPlanBtn = document.createElement('button');
  newPlanBtn.type = 'button';
  newPlanBtn.className = 'btn-cancel self-start';
  newPlanBtn.textContent = '+ ' + t('targets.plan.newPlan');
  newPlanBtn.addEventListener('click', () => {
    close();
    plansStore.createPlan(defaultPlanName()).then((id) => {
      if (!id) return;
      doPlanAction(id).then(onDone);
    });
  });
  planSection.appendChild(newPlanBtn);
  bodyM.appendChild(planSection);

  // ── "Add as a free frame" section ──────────────────────────────────────────
  const freeSection = document.createElement('div');
  freeSection.className = 'flex flex-col gap-2 mt-4';
  const freeLabel = document.createElement('div');
  freeLabel.className = 'text-small text-label uppercase';
  freeLabel.textContent = t('fovOverlay.addFreeFrame');
  freeSection.appendChild(freeLabel);
  const freeGridEl = document.createElement('div');
  freeGridEl.className = gridClass;
  for (const setup of freeSetups) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-action';
    b.textContent = setup.name;
    b.addEventListener('click', () => {
      close();
      onSetupPick(setup.id);
    });
    freeGridEl.appendChild(b);
  }
  freeSection.appendChild(freeGridEl);
  const addSetupBtn = document.createElement('button');
  addSetupBtn.type = 'button';
  addSetupBtn.className = 'btn-cancel self-start';
  addSetupBtn.textContent = '+ ' + t('fovOverlay.newSetup');
  addSetupBtn.addEventListener('click', () => {
    close();
    openAddSetupModal((created) => {
      useFovFramesStore()
        .loadSpecs()
        .then(() => onSetupPick(created.id));
    });
  });
  freeSection.appendChild(addSetupBtn);
  bodyM.appendChild(freeSection);

  modal.appendChild(head);
  modal.appendChild(bodyM);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ─── Shared inline setup controls ([+] create, [edit]) ─────────────────────────

/**
 * Builds the `[+] [edit]` icon buttons placed next to every setup dropdown
 * (Recommend tab, plan details, sky-map FOV popup). `+` opens the create modal,
 * the pencil opens the edit modal (which now owns deletion). After any mutation
 * the caller's `onMutated` runs so it can reload setups/specs and re-select.
 *
 * Call `refresh()` whenever the dropdown selection changes to re-evaluate the
 * edit button's disabled state.
 */
export function buildSetupControls(opts: {
  getSelectedSetup: () => FovSetup | undefined;
  onMutated: () => void;
  /** Whether setups created via `+` are enabled by default (Recommend tab: false). */
  createEnabled?: boolean;
}): { addBtn: HTMLButtonElement; editBtn: HTMLButtonElement; refresh: () => void } {
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-icon';
  addBtn.innerHTML = plusSvg;
  addBtn.title = t('fovOverlay.addSetup');
  addBtn.setAttribute('aria-label', t('fovOverlay.addSetup'));
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAddSetupModal(() => opts.onMutated(), opts.createEnabled ?? true);
  });

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-icon';
  editBtn.innerHTML = penSvg;
  editBtn.title = t('fovOverlay.editModalTitle');
  editBtn.setAttribute('aria-label', t('fovOverlay.editModalTitle'));
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const setup = opts.getSelectedSetup();
    if (!setup) return;
    openEditSetupModal(
      setup,
      () => opts.onMutated(),
      () => opts.onMutated(),
    );
  });

  const refresh = (): void => {
    editBtn.disabled = !opts.getSelectedSetup();
  };
  refresh();

  return { addBtn, editBtn, refresh };
}

// ─── Rename plan modal ─────────────────────────────────────────────────────────

/**
 * Lightweight modal to rename a plan. Targets & Plans renames inline on the plan
 * name element; the sky-map popup has no such element (the plan lives in a
 * dropdown), so renaming happens through this dialog instead.
 */
export function openRenamePlanModal(
  planId: string,
  currentName: string,
  onSaved?: () => void,
): void {
  const uiStore = useUiStore();
  const plansStore = usePlansStore();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const close = (): void => {
    backdrop.remove();
  };

  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.textContent = t('targets.plan.rename');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body modal-form-body';
  const nameRow = document.createElement('div');
  nameRow.style.display = 'flex';
  nameRow.style.flexDirection = 'column';
  nameRow.style.gap = 'var(--space-1)';
  const nameLabelEl = document.createElement('label');
  nameLabelEl.style.fontSize = 'var(--font-size-small)';
  nameLabelEl.style.color = 'var(--text-label)';
  nameLabelEl.textContent = t('fovOverlay.mosaicName');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'dialog-input';
  nameInput.value = currentName;
  const nameError = document.createElement('span');
  nameError.className = 'input-error-msg hidden';
  nameError.textContent = t('fovOverlay.mosaicNameRequired');
  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('input-error');
    nameError.classList.add('hidden');
  });
  nameRow.appendChild(nameLabelEl);
  nameRow.appendChild(nameInput);
  nameRow.appendChild(nameError);
  body.appendChild(nameRow);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('targets.gear.cancel');
  cancelBtn.addEventListener('click', close);
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-confirm';
  saveBtn.textContent = t('targets.gear.save');

  const submit = async (): Promise<void> => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('input-error');
      nameError.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      if (name !== currentName) await plansStore.renamePlan(planId, name);
      close();
      onSaved?.();
    } catch (err) {
      reportUnknownRendererError('fov_rename_plan', err);
      saveBtn.disabled = false;
    }
  };
  saveBtn.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    nameInput.focus();
    nameInput.select();
  });
}

// ─── FOV frame-manager popup ───────────────────────────────────────────────────

/**
 * Frame-manager popup: lists the interactive frame instances (plan-derived +
 * ad-hoc) with select / reset-rotation / delete actions, plus an "Add frame"
 * gear picker. Reactive to the fov-frames store; the returned element carries a
 * `__cleanup` hook the caller must invoke on close to stop the watcher.
 */
export function buildFovPopup(
  onClose: () => void,
  onReady?: () => void,
): HTMLElement & { __cleanup?: () => void } {
  const fovStore = useFovFramesStore();
  const plansStore = usePlansStore();
  const uiStore = useUiStore();

  // Populate the plan dropdown.
  plansStore.ensureLoaded();

  const popup = document.createElement('div') as HTMLElement & { __cleanup?: () => void };
  // The `.fov-popup` class is existence-detected by the ui store, so the sky
  // tooltip stays suppressed for the popup's whole lifetime (not just while the
  // cursor is over it).
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

  // Mode dropdown: Free frames or each plan. Creating a plan is the [+] icon to
  // the right; the pencil renames the selected plan (mirrors Targets & Plans).
  const FREE_VALUE = '__free__';
  const modeRow = document.createElement('div');
  modeRow.className = 'flex items-center gap-1';
  const select = document.createElement('select');
  select.className = 'input-base';
  alignControlSelect(select);
  select.style.flex = '1';
  select.style.width = 'auto';
  select.style.minWidth = '0';
  select.addEventListener('change', () => onSelectChange());

  const planAddBtn = document.createElement('button');
  planAddBtn.type = 'button';
  planAddBtn.className = 'btn-icon';
  planAddBtn.innerHTML = plusSvg;
  planAddBtn.title = t('targets.plan.newPlan');
  planAddBtn.setAttribute('aria-label', t('targets.plan.newPlan'));
  planAddBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = await plansStore.createPlan(defaultPlanName());
    if (id) fovStore.setSelection({ kind: 'plan', planId: id });
  });

  const planEditBtn = document.createElement('button');
  planEditBtn.type = 'button';
  planEditBtn.className = 'btn-icon';
  planEditBtn.innerHTML = penSvg;
  planEditBtn.title = t('targets.plan.rename');
  planEditBtn.setAttribute('aria-label', t('targets.plan.rename'));
  planEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = fovStore.selection;
    if (sel.kind !== 'plan') return;
    const plan = plansStore.plans.find((p) => p.id === sel.planId);
    if (plan) openRenamePlanModal(plan.id, plan.name);
  });

  modeRow.appendChild(select);
  modeRow.appendChild(planAddBtn);
  modeRow.appendChild(planEditBtn);
  controls.appendChild(modeRow);

  // Plan setup dropdown (plan mode only): choose the gear setup for the plan.
  // Persisted to the plan, so it reflects in the Targets & Plan tab. The unified
  // [+] create / [edit] controls sit inline to its right.
  const setupRow = document.createElement('div');
  setupRow.className = 'flex items-center gap-1';
  const setupSelect = document.createElement('select');
  setupSelect.className = 'input-base';
  alignControlSelect(setupSelect);
  setupSelect.style.flex = '1';
  setupSelect.style.width = 'auto';
  setupSelect.style.minWidth = '0';
  setupSelect.addEventListener('change', () => onSetupChange());

  // Gear setups for the setup dropdown (resolved async; labels include FOV).
  let gearSetups: GearSetupData[] = [];
  const setupControls = buildSetupControls({
    getSelectedSetup: () => gearSetups.find((s) => s.id === setupSelect.value),
    onMutated: () => {
      fovStore.loadSpecs();
      loadPopupSetups();
    },
  });

  setupRow.appendChild(setupSelect);
  setupRow.appendChild(setupControls.addBtn);
  setupRow.appendChild(setupControls.editBtn);
  controls.appendChild(setupRow);

  // setupId → true when the setup's telescope is a smart/integrated scope, which
  // has its own mosaic mode — so the mosaic action is hidden for those.
  const setupIsSmart = new Map<string, boolean>();
  function loadPopupSetups(): void {
    Promise.all([getGearSetups(), getTelescopes()])
      .then(([s, tels]) => {
        gearSetups = s;
        const smartTel = new Set(tels.filter((t) => t.is_smart_telescope).map((t) => t.id));
        setupIsSmart.clear();
        for (const setup of s) setupIsSmart.set(setup.id, smartTel.has(setup.telescopeId));
        renderAll();
      })
      .catch((err) => reportUnknownRendererError('fov_popup_load_setups', err));
  }
  loadPopupSetups();

  /** Whether the selected plan can build a mosaic (plan mode, has a setup, and
   * the setup's telescope is not a smart scope). */
  function canAddMosaic(): boolean {
    const sel = fovStore.selection;
    if (sel.kind !== 'plan') return false;
    const plan = plansStore.plans.find((p) => p.id === sel.planId);
    if (!plan?.setupId) return false;
    return !setupIsSmart.get(plan.setupId);
  }

  // Body (frame list)
  const body = document.createElement('div');
  body.className = 'fov-popup-body';
  popup.appendChild(body);

  // Footer: a single row of icon actions (add frame / add mosaic / open plan
  // details). Which buttons show depends on the selection (see renderSelect).
  const footer = document.createElement('div');
  footer.className = 'fov-popup-footer flex flex-row gap-2 justify-center';
  popup.appendChild(footer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-icon';
  addBtn.title = t('fovOverlay.addFrame');
  addBtn.setAttribute('aria-label', t('fovOverlay.addFrame'));
  addBtn.innerHTML = addFrameSvg;
  addBtn.addEventListener('click', () => {
    if (!fovStore.framesVisible) return; // disabled while frames are hidden
    const sel = fovStore.selection;
    if (sel.kind === 'plan') addPlanFrameToCenter(sel.planId);
    else
      openSetupPicker((setupId) => {
        useCanvasStore().skyMap?.pinActiveIfFloating();
        fovStore.addAdhocFrame(setupId);
      });
  });
  footer.appendChild(addBtn);

  // Plan mode (non-smart setup): build a multi-panel mosaic for the centred target.
  const addMosaicBtn = document.createElement('button');
  addMosaicBtn.type = 'button';
  addMosaicBtn.className = 'btn-icon';
  addMosaicBtn.title = t('fovOverlay.addMosaic');
  addMosaicBtn.setAttribute('aria-label', t('fovOverlay.addMosaic'));
  addMosaicBtn.innerHTML = addMosaicSvg;
  addMosaicBtn.addEventListener('click', () => {
    if (!fovStore.framesVisible) return; // disabled while frames are hidden
    const sel = fovStore.selection;
    if (sel.kind === 'plan') openMosaicModal(sel.planId);
    // Free mode: pick a (non-smart) setup, then build a free mosaic via the modal.
    else
      openSetupPicker((setupId) => buildMosaicModal({ kind: 'free', setupId }), {
        excludeSmart: true,
      });
  });
  footer.appendChild(addMosaicBtn);

  // Plan mode: jump to this plan's details in the Targets & Plans tab.
  const planDetailsBtn = document.createElement('button');
  planDetailsBtn.type = 'button';
  planDetailsBtn.className = 'btn-icon';
  planDetailsBtn.title = t('fovOverlay.openPlanDetails');
  planDetailsBtn.setAttribute('aria-label', t('fovOverlay.openPlanDetails'));
  planDetailsBtn.innerHTML = planListSvg;
  planDetailsBtn.addEventListener('click', () => {
    const sel = fovStore.selection;
    if (sel.kind !== 'plan') return;
    uiStore.pendingPlanFocusId = sel.planId;
    uiStore.switchView('plans');
    onClose();
  });
  footer.appendChild(planDetailsBtn);

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
    const nice = new Date().toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
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

    const sel = fovStore.selection;
    select.value = sel.kind === 'plan' ? `plan:${sel.planId}` : FREE_VALUE;
    // Renaming targets the selected plan, so it's only available in plan mode.
    planEditBtn.disabled = sel.kind !== 'plan';
    // The footer row is always present; individual actions show per selection.
    // "Add frame" is offered for free frames, and for a plan once it has a gear
    // setup (without one a plan can't size — and therefore can't render — frames).
    const plan =
      sel.kind === 'plan' ? plansStore.plans.find((p) => p.id === sel.planId) : undefined;
    const canAddFrame = sel.kind === 'free' || !!plan?.setupId;
    addBtn.classList.toggle('hidden', !canAddFrame);
    // Mosaic is offered in free mode (the picker asks for a non-smart setup) and
    // for a non-smart plan.
    addMosaicBtn.classList.toggle('hidden', !(sel.kind === 'free' || canAddMosaic()));
    // Plan details jump is plan-only (available even without a setup).
    planDetailsBtn.classList.toggle('hidden', sel.kind !== 'plan');
  }

  function onSelectChange() {
    const v = select.value;
    if (v === FREE_VALUE) {
      fovStore.setSelection({ kind: 'free' });
      return;
    }
    if (v.startsWith('plan:')) fovStore.setSelection({ kind: 'plan', planId: v.slice(5) });
  }

  function renderSetupSelect() {
    const sel = fovStore.selection;
    const plan =
      sel.kind === 'plan' ? plansStore.plans.find((p) => p.id === sel.planId) : undefined;
    // Setup dropdown + its controls are only meaningful for a plan.
    setupRow.style.display = plan ? '' : 'none';
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
    setupControls.refresh();
  }

  // Setup switching (with mosaic reconciliation) lives in ./setup-switch, shared
  // with the Plans list in the Targets tab. The popup just supplies how to revert
  // its own dropdown and how to re-render after the switch is applied.
  async function onSetupChange() {
    const sel = fovStore.selection;
    if (sel.kind !== 'plan') return;
    const plan = plansStore.plans.find((p) => p.id === sel.planId);
    if (!plan) return;
    await requestSetupSwitch(plan, setupSelect.value || null, {
      onRevert: () => {
        setupSelect.value = plan.setupId ?? '';
      },
      onApplied: () => renderAll(),
    });
  }

  // Modal listing every plan a free frame/mosaic could be moved into. Only plans
  // with the same gear setup are pickable; the rest are shown disabled with a
  // tooltip explaining the mismatch (different setup, or no setup at all).
  function openPlanPicker(
    header: { name: string; setupLabel: string },
    freeSetupId: string | null,
    onPick: (planId: string) => void,
  ): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal settings-modal';
    const head = document.createElement('div');
    head.className = 'modal-header';
    const h2 = document.createElement('h2');
    h2.textContent = t('fovOverlay.moveToPlan');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'modal-close';
    x.textContent = '×';
    x.addEventListener('click', () => backdrop.remove());
    head.appendChild(h2);
    head.appendChild(x);
    const bodyM = document.createElement('div');
    bodyM.className = 'modal-body modal-form-body';
    // Sub-header: what's being moved + the gear setup it uses.
    const sub = document.createElement('div');
    sub.className = 'mb-2';
    const subName = document.createElement('div');
    subName.className = 'text-small text-primary font-semibold';
    subName.textContent = header.name;
    sub.appendChild(subName);
    if (header.setupLabel) {
      const subSetup = document.createElement('div');
      subSetup.className = 'text-micro text-muted';
      subSetup.textContent = header.setupLabel;
      sub.appendChild(subSetup);
    }
    bodyM.appendChild(sub);
    for (const p of plansStore.plans) {
      const compatible = !!freeSetupId && p.setupId === freeSetupId;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-action';
      b.style.width = '100%';
      b.textContent = p.name;
      if (compatible) {
        b.addEventListener('click', () => {
          backdrop.remove();
          onPick(p.id);
        });
        bodyM.appendChild(b);
      } else {
        // Genuinely disabled: the button takes no hover/active/click. A disabled
        // button fires no events, so the explanatory tooltip lives on a wrapper and
        // the button ignores pointer events — hover falls through to the wrapper,
        // which shows the title.
        b.disabled = true;
        b.classList.add('opacity-50');
        b.style.pointerEvents = 'none';
        const wrap = document.createElement('div');
        wrap.className = 'cursor-not-allowed';
        wrap.style.width = '100%';
        wrap.title = p.setupId ? t('fovOverlay.planSetupMismatch') : t('fovOverlay.planNoSetup');
        wrap.appendChild(b);
        bodyM.appendChild(wrap);
      }
    }
    modal.appendChild(head);
    modal.appendChild(bodyM);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function renderBody() {
    body.innerHTML = '';
    const frames = fovStore.renderables;

    if (fovStore.selection.kind === 'plan' && frames.length === 0) {
      // A plan with no gear setup can't size its frames.
      const plan = plansStore.plans.find(
        (p) => fovStore.selection.kind === 'plan' && p.id === fovStore.selection.planId,
      );
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
      const anyHidden = frames.some((f) => f.visible === false);
      const anyVisible = frames.some((f) => f.visible !== false);
      const allVisible = !anyHidden;

      const selectAllRow = document.createElement('label');
      selectAllRow.className = 'fov-popup-select-all-row';
      const selectAllBox = document.createElement('input');
      selectAllBox.type = 'checkbox';
      selectAllBox.className = 'shrink-0';
      selectAllBox.checked = allVisible;
      selectAllBox.indeterminate = anyVisible && anyHidden;
      selectAllBox.addEventListener('change', () =>
        fovStore.setAllAdhocVisible(selectAllBox.checked),
      );
      const selectAllLabel = document.createElement('span');
      selectAllLabel.textContent = t('display.selectAll');
      selectAllRow.appendChild(selectAllBox);
      selectAllRow.appendChild(selectAllLabel);
      body.appendChild(selectAllRow);
    }

    for (const f of frames) {
      if (f.mosaicId && !f.isMosaicOutline) continue; // tiles: the mosaic's outline row stands in for them

      const row = document.createElement('div');
      row.className = 'fov-popup-setup-row';

      const isPlan = f.id.startsWith('plan:');
      const isMosaic = !!f.isMosaicOutline;
      // A free mosaic is `mosaic:free:<id>`; a plan mosaic is `mosaic:<planId>:<id>`.
      const isFreeMosaic = isMosaic && f.id.split(':')[1] === 'free';
      const isPlanMosaic = isMosaic && !isFreeMosaic;
      const isFreeFrame = !isPlan && !isMosaic;
      // Resolve the underlying mosaic (for its grid size + the edit modal).
      const mosaicData = isPlanMosaic
        ? (() => {
            const [, mPlanId, mMosaicId] = f.id.split(':');
            return (
              plansStore.plans
                .find((p) => p.id === mPlanId)
                ?.mosaics.find((m) => m.id === mMosaicId) ?? null
            );
          })()
        : null;
      const freeMosaic = isFreeMosaic
        ? (fovStore.adhocMosaics.find((m) => m.id === f.id.split(':')[2]) ?? null)
        : null;
      // Gear setup of a free item — a plan is a compatible migration target only
      // if it uses the same setup (the picker shows the rest disabled).
      const freeSetupId = isFreeFrame
        ? (fovStore.adhoc.find((a) => a.id === f.id)?.setupId ?? null)
        : (freeMosaic?.setupId ?? null);

      // Free frames + free mosaics: a leading checkbox shows/hides them on the map.
      if (isFreeFrame || isFreeMosaic) {
        const visBox = document.createElement('input');
        visBox.type = 'checkbox';
        visBox.className = 'shrink-0';
        visBox.checked = f.visible !== false;
        visBox.title = t('fovOverlay.showOnMap');
        visBox.addEventListener('click', (e) => e.stopPropagation());
        visBox.addEventListener('change', () => {
          if (isFreeMosaic) fovStore.setAdhocMosaicVisible(f.id.split(':')[2], visBox.checked);
          else fovStore.setAdhocVisible(f.id, visBox.checked);
        });
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
      const baseName = isPlan || isMosaic ? (f.anchorLabel ?? customFrameLabel(f)) : f.label;
      // Mosaics carry a "Mosaic" suffix so they read distinctly from single frames.
      nameSpan.textContent = isMosaic ? `${baseName} · ${t('targets.plan.mosaicLabel')}` : baseName;
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
      } else if (isFreeFrame) {
        parts.push(
          f.anchorLabel ? `${t('fovOverlay.pinnedTo')} ${f.anchorLabel}` : t('fovOverlay.pinned'),
        );
      }
      // Show the mosaic grid size (cols×rows) alongside the angle readout.
      const gridData = mosaicData ?? freeMosaic;
      if (isMosaic && gridData) parts.push(`${gridData.cols}×${gridData.rows}`);
      if (f.anchorKind === 'sky' && f.paDeg != null) {
        parts.push(`${t('fovOverlay.angleLabel')} ${formatPaDeg(f.paDeg)}`);
        status.title = t('fovOverlay.angleHelp');
      }
      status.textContent = parts.join(' · ');
      if (status.textContent) labelEl.appendChild(status);

      // Actions: anchor toggle + delete — identical for plan and free frames.
      const actions = document.createElement('div');
      actions.className = 'fov-popup-setup-actions';

      // Mosaics get an edit button (re-opens the mosaic modal in edit mode).
      if (isMosaic && mosaicData) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-icon';
        editBtn.innerHTML = penSvg;
        editBtn.title = t('fovOverlay.editMosaicTitle');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const [, mPlanId, mMosaicId] = f.id.split(':');
          openEditMosaicModal(mPlanId, mMosaicId);
        });
        actions.appendChild(editBtn);
      }

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

      // Free items only: move this frame/mosaic into a plan. The picker lists every
      // plan, disabling those whose gear setup differs (see openPlanPicker). Hidden
      // only when there are no plans at all.
      if ((isFreeFrame || isFreeMosaic) && plansStore.plans.length > 0) {
        const toPlanBtn = document.createElement('button');
        toPlanBtn.type = 'button';
        toPlanBtn.className = 'btn-icon';
        toPlanBtn.innerHTML = listPlusSvg;
        toPlanBtn.title = t('fovOverlay.moveToPlan');
        toPlanBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const migrate = async (planId: string) => {
            // Pin a floating frame to the sky first so it has a position to migrate.
            if (f.anchorKind === 'screen') useCanvasStore().skyMap?.toggleFramePinById(f.id);
            if (isFreeMosaic) await fovStore.migrateFreeMosaicToPlan(f.id.split(':')[2], planId);
            else await fovStore.migrateFreeFrameToPlan(f.id, planId);
            renderAll();
          };
          // Header context: what's being moved + the gear setup it uses (so the
          // disabled, mismatched plans make sense).
          const base = f.anchorLabel ?? (isFreeMosaic ? customFrameLabel(f) : f.label);
          const itemName = isFreeMosaic ? `${base} · ${t('targets.plan.mosaicLabel')}` : base;
          const setupLabel =
            (freeSetupId && fovStore.specs.get(freeSetupId)?.label) ||
            gearSetups.find((s) => s.id === freeSetupId)?.name ||
            '';
          openPlanPicker({ name: itemName, setupLabel }, freeSetupId, migrate);
        });
        actions.appendChild(toPlanBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-icon--danger';
      deleteBtn.innerHTML = trashSvg;
      deleteBtn.title = t('fovOverlay.deleteFrame');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = f.anchorLabel ?? customFrameLabel(f);
        if (isFreeMosaic) {
          // Free mosaic: not part of a plan, so no "from this plan" wording —
          // still confirms since restoring a tile grid isn't undoable.
          if (await confirmMosaicDelete(name)) fovStore.removeAdhocMosaic(f.id.split(':')[2]);
        } else if (isMosaic) {
          // A whole mosaic still confirms (restoring a tile grid isn't undoable).
          const [, planId, mosaicId] = f.id.split(':');
          if (await confirmPlanEntryDelete(name)) await plansStore.deleteMosaic(planId, mosaicId);
        } else if (isPlan) {
          // Plan frames: confirm removal from the plan, then delete with an undo toast.
          const [, planId, entryId] = f.id.split(':');
          if (await confirmPlanEntryDelete(name)) {
            deleteFrameWithUndo({ kind: 'plan', planId, entryId, name });
          }
        } else {
          deleteFrameWithUndo({ kind: 'adhoc', id: f.id, name });
        }
      });
      actions.appendChild(deleteBtn);

      row.appendChild(labelEl);
      row.appendChild(actions);
      body.appendChild(row);
    }
  }

  // ── "Add mosaic" modal ────────────────────────────────────────────────────
  // The modal is self-contained: one or more targets are chosen inside it. If a
  // DSO happens to be highlighted on the map when it opens, seed it as a chip
  // for convenience (no longer required up front).
  function openMosaicModal(planId: string): void {
    const selId = useCanvasStore().skyMap?.getHighlightedDSOId() ?? null;
    const dso = selId ? getDSOById(selId) : null;
    buildMosaicModal({ kind: 'plan', planId }, undefined, dso ? [dso] : []);
  }

  // Destination of a created mosaic: an existing plan, or a free (ad-hoc) mosaic
  // sized by the given gear setup.
  type MosaicDest = { kind: 'plan'; planId: string } | { kind: 'free'; setupId: string };

  // Pre-filled defaults that switch the mosaic modal into "edit" mode.
  type MosaicEditDefaults = {
    mosaicId: string;
    name: string | null;
    dsoId: string | null;
    overlapPct: number;
    cols: number;
    rows: number;
    centerRa: number;
    centerDec: number;
    paDeg: number;
  };

  // ── "Edit mosaic" modal ───────────────────────────────────────────────────
  // Re-opens the same modal pre-filled with the mosaic's current settings.
  function openEditMosaicModal(planId: string, mosaicId: string): void {
    const plan = plansStore.plans.find((p) => p.id === planId);
    const mosaic = plan?.mosaics.find((m) => m.id === mosaicId);
    if (!plan?.setupId || !mosaic) return;
    // Seed the target chip from the single stored DSO (a multi-DSO mosaic has
    // dsoId null and so opens with no chips — clearing/keeping the centre).
    const dso = mosaic.dsoId ? getDSOById(mosaic.dsoId) : null;
    buildMosaicModal(
      { kind: 'plan', planId },
      {
        mosaicId,
        name: mosaic.name,
        dsoId: mosaic.dsoId,
        overlapPct: mosaic.overlapPct,
        cols: mosaic.cols,
        rows: mosaic.rows,
        centerRa: mosaic.centerRa,
        centerDec: mosaic.centerDec,
        paDeg: mosaic.paDeg,
      },
      dso ? [dso] : [],
    );
  }

  function buildMosaicModal(
    dest: MosaicDest,
    edit?: MosaicEditDefaults,
    seedDsos: DSO[] = [],
  ): void {
    // Plan destinations need a sized plan; free destinations carry the setup id.
    const plan = dest.kind === 'plan' ? plansStore.plans.find((p) => p.id === dest.planId) : null;
    const setupId = dest.kind === 'plan' ? plan?.setupId : dest.setupId;
    if (dest.kind === 'plan' && !plan?.setupId) return;
    if (!setupId) return;
    const spec = fovStore.specs.get(setupId);
    if (!spec) return;
    // Single-tile FOV — captured as plain numbers so nested closures keep them.
    const tileW = spec.wDeg;
    const tileH = spec.hDeg;

    const DEFAULT_OVERLAP = 20;
    const initialOverlap = edit?.overlapPct ?? DEFAULT_OVERLAP;

    // Chosen targets (mutable). The covering centre/PA/region are derived from
    // these: one DSO stays anchored to it; several un-anchor to the bounding box
    // between them. Editing with no chips keeps the mosaic's stored centre/PA.
    const selected: DSO[] = [...seedDsos];
    let center = edit ? { ra: edit.centerRa, dec: edit.centerDec } : { ra: 0, dec: 0 };
    let paDeg = edit ? edit.paDeg : 0;
    let region = { wDeg: 0, hDeg: 0, paDeg };
    if (selected.length > 0) {
      const res = autoRegionForDsos(selected, 20);
      center = res.center;
      region = res.region;
      paDeg = region.paDeg;
    }
    let auto = planGrid(tileW, tileH, region.wDeg, region.hDeg, initialOverlap);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal settings-modal';

    const close = (): void => {
      backdrop.remove();
    };

    const head = document.createElement('div');
    head.className = 'modal-header';
    const h2 = document.createElement('h2');
    h2.textContent = t(edit ? 'fovOverlay.editMosaicTitle' : 'fovOverlay.mosaicTitle');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'modal-close';
    x.textContent = '×';
    x.addEventListener('click', close);
    head.appendChild(h2);
    head.appendChild(x);

    const bodyM = document.createElement('div');
    bodyM.className = 'modal-body modal-form-body flex flex-col gap-3';

    // ── Name (required) ───────────────────────────────────────────────────────
    const nameField = document.createElement('div');
    nameField.className = 'flex flex-col gap-1';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'text-small text-label';
    nameLabel.textContent = t('fovOverlay.mosaicName');
    const nameStar = document.createElement('span');
    nameStar.className = 'required-star';
    nameStar.textContent = ' *';
    nameLabel.appendChild(nameStar);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'dialog-input';
    nameInput.placeholder = t('fovOverlay.mosaicNamePlaceholder');
    nameInput.value = edit?.name ?? '';
    const nameError = document.createElement('span');
    nameError.className = 'input-error-msg hidden';
    nameError.textContent = t('fovOverlay.mosaicNameRequired');
    nameInput.addEventListener('input', () => {
      nameInput.classList.remove('input-error');
      nameError.classList.add('hidden');
    });
    nameField.append(nameLabel, nameInput, nameError);
    bodyM.appendChild(nameField);

    // ── Target(s): a DSO search that accepts one or more objects ─────────────
    const targetField = document.createElement('div');
    targetField.className = 'flex flex-col gap-1';
    const targetLabel = document.createElement('label');
    targetLabel.className = 'text-small text-label';
    targetLabel.textContent = t('fovOverlay.mosaicTarget');
    const targetStar = document.createElement('span');
    targetStar.className = 'required-star';
    targetStar.textContent = ' *';
    targetLabel.appendChild(targetStar);

    // Reuse the right-panel DSO search look (.dso-search-wrapper / .star-search-input
    // / .search-dropdown / .search-item) so results match the usual search.
    const searchWrap = document.createElement('div');
    searchWrap.className = 'dso-search-wrapper';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'star-search-input';
    searchInput.placeholder = t('fovOverlay.mosaicTargetPlaceholder');
    const dropdown = document.createElement('div');
    dropdown.className = 'search-dropdown';
    searchWrap.append(searchInput, dropdown);

    // The search wrapper's margin-bottom already separates the chips from the
    // input, so they no longer touch it.
    const chips = document.createElement('div');
    chips.className = 'flex flex-wrap gap-1 empty:hidden';
    const targetError = document.createElement('span');
    targetError.className = 'input-error-msg hidden';
    targetError.textContent = t('fovOverlay.mosaicTargetRequired');
    const clearTargetError = (): void => {
      searchInput.classList.remove('input-error');
      targetError.classList.add('hidden');
    };
    targetField.append(targetLabel, searchWrap, chips, targetError);
    bodyM.appendChild(targetField);

    // Fields laid out as a 2-column grid: the label column is `max-content`, so
    // it sizes to the widest label (with the grid gap as padding) and every input
    // shares the same left edge — no hardcoded widths, language-agnostic.
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-[max-content_auto] items-center gap-x-4 gap-y-2 text-small';
    bodyM.appendChild(grid);

    /** A labelled number input as one grid row (label cell + input cell). The
     * `<label class="contents">` promotes its span + input into the grid so they
     * fall into the shared columns. */
    function numberField(
      labelKey: string,
      value: number,
      min: number,
      max?: number,
    ): { input: HTMLInputElement } {
      const lbl = document.createElement('label');
      lbl.className = 'contents';
      const span = document.createElement('span');
      span.className = 'whitespace-nowrap';
      span.textContent = t(labelKey);
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'dialog-input w-24';
      input.value = String(value);
      input.min = String(min);
      if (max != null) input.max = String(max);
      lbl.appendChild(span);
      lbl.appendChild(input);
      grid.appendChild(lbl);
      return { input };
    }

    const overlap = numberField('fovOverlay.mosaicOverlap', initialOverlap, 0, 90);
    const cols = numberField('fovOverlay.mosaicColumns', edit?.cols ?? auto.cols, 1);
    const rows = numberField('fovOverlay.mosaicRows', edit?.rows ?? auto.rows, 1);

    const summary = document.createElement('p');
    summary.className = 'text-small text-muted m-0';
    bodyM.appendChild(summary);

    const readInt = (el: HTMLInputElement, fallback: number): number => {
      const n = parseInt(el.value, 10);
      return Number.isFinite(n) && n >= 1 ? n : fallback;
    };
    const readOverlap = (): number => {
      const n = parseFloat(overlap.input.value);
      return Number.isFinite(n) ? Math.min(90, Math.max(0, n)) : DEFAULT_OVERLAP;
    };

    function recompute(): void {
      const ov = readOverlap();
      const c = readInt(cols.input, auto.cols);
      const r = readInt(rows.input, auto.rows);
      const f = 1 - ov / 100;
      const wDeg = (c - 1) * tileW * f + tileW;
      const hDeg = (r - 1) * tileH * f + tileH;
      summary.textContent = `${c}×${r} · ${c * r} ${t('fovOverlay.mosaicPanels')} · ${formatFov(wDeg, hDeg)}`;
    }

    // Re-derive centre/PA/region from the chosen targets (falling back to the
    // mosaic's stored centre when editing with no targets), refresh the auto grid
    // and the summary.
    function recomputePlacement(): void {
      if (selected.length > 0) {
        const res = autoRegionForDsos(selected, 20);
        center = res.center;
        region = res.region;
        paDeg = region.paDeg;
      } else if (edit) {
        center = { ra: edit.centerRa, dec: edit.centerDec };
        paDeg = edit.paDeg;
        region = { wDeg: 0, hDeg: 0, paDeg };
      }
      auto = planGrid(tileW, tileH, region.wDeg, region.hDeg, readOverlap());
    }
    // Targets (or overlap) drive the grid: overwrite cols/rows from the auto
    // layout. With no targets (editing a free mosaic) keep the user's values.
    function syncGridFromTargets(): void {
      recomputePlacement();
      if (selected.length > 0) {
        cols.input.value = String(auto.cols);
        rows.input.value = String(auto.rows);
      }
      recompute();
    }

    // ── Target search/chips wiring ────────────────────────────────────────────
    function renderChips(): void {
      chips.innerHTML = '';
      for (const d of selected) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        const label = document.createElement('span');
        label.textContent = d.displayName ?? d.id;
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'tag-chip-remove';
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          const i = selected.indexOf(d);
          if (i >= 0) selected.splice(i, 1);
          renderChips();
          syncGridFromTargets();
        });
        chip.append(label, rm);
        chips.appendChild(chip);
      }
    }
    function closeDropdown(): void {
      dropdown.classList.remove('!block');
      dropdown.innerHTML = '';
    }
    function addDso(d: DSO): void {
      if (selected.some((s) => s.id === d.id)) return;
      selected.push(d);
      searchInput.value = '';
      closeDropdown();
      clearTargetError();
      renderChips();
      syncGridFromTargets();
      searchInput.focus();
    }
    function runSearch(): void {
      const q = searchInput.value.trim();
      if (!q) {
        closeDropdown();
        return;
      }
      const results = searchDSOs(q, 8).filter((r) => !selected.some((s) => s.id === r.dso.id));
      if (results.length === 0) {
        closeDropdown();
        return;
      }
      dropdown.innerHTML = '';
      for (const r of results) {
        const item = document.createElement('div');
        item.className = 'search-item';
        const top = document.createElement('div');
        top.className = 'search-item-top';
        const type = document.createElement('span');
        type.className = 'search-item-type dso';
        type.textContent = t('search.typeDSO');
        const nameEl = document.createElement('span');
        nameEl.className = 'search-item-name';
        nameEl.textContent = r.label;
        top.append(type, nameEl);
        item.appendChild(top);
        if (r.dso.mag != null && r.dso.mag < 90) {
          const bottom = document.createElement('div');
          bottom.className = 'search-item-bottom';
          const mag = document.createElement('span');
          mag.className = 'search-item-mag';
          mag.textContent = `mag ${r.dso.mag.toFixed(1)}`;
          bottom.appendChild(mag);
          item.appendChild(bottom);
        }
        item.addEventListener('click', () => addDso(r.dso));
        dropdown.appendChild(item);
      }
      dropdown.classList.add('!block');
    }
    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (dropdown.querySelector('.search-item') as HTMLElement | null)?.click();
      } else if (e.key === 'Escape' && dropdown.classList.contains('!block')) {
        e.stopPropagation();
        closeDropdown();
      }
    });
    // Clicking outside the search closes the dropdown.
    searchInput.addEventListener('blur', () => setTimeout(closeDropdown, 120));
    renderChips();

    // Changing overlap re-derives the auto grid; editing cols/rows directly just
    // refreshes the summary.
    overlap.input.addEventListener('input', syncGridFromTargets);
    cols.input.addEventListener('input', recompute);
    rows.input.addEventListener('input', recompute);
    recompute();

    const foot = document.createElement('div');
    foot.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-cancel';
    cancel.textContent = t('targets.gear.cancel');
    cancel.addEventListener('click', close);
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn-confirm';
    create.textContent = edit ? t('targets.gear.save') : t('fovOverlay.mosaicCreate');
    create.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      // A target is required to create; when editing a free/multi mosaic the user
      // may leave it empty to keep the stored centre.
      const targetMissing = selected.length === 0 && !edit;
      let invalid = false;
      if (!name) {
        nameInput.classList.add('input-error');
        nameError.classList.remove('hidden');
        invalid = true;
      }
      if (targetMissing) {
        searchInput.classList.add('input-error');
        targetError.classList.remove('hidden');
        invalid = true;
      }
      if (invalid) return;

      recomputePlacement();
      const overlapPct = readOverlap();
      const c = readInt(cols.input, auto.cols);
      const r = readInt(rows.input, auto.rows);
      // One DSO stays anchored to it; several (or none) un-anchor to the centre.
      const dsoId = selected.length === 1 ? selected[0].id : null;
      const tiles = tileCenters(center, paDeg, c, r, tileW, tileH, overlapPct).map((tl) => ({
        ra: tl.ra,
        dec: tl.dec,
        paDeg: tl.paDeg,
      }));
      create.disabled = true;

      // Free destination: create an ad-hoc mosaic (local, no plan) and select it.
      if (dest.kind === 'free') {
        fovStore.createAdhocMosaic({
          setupId: dest.setupId,
          dsoId,
          name,
          centerRa: center.ra,
          centerDec: center.dec,
          paDeg,
          overlapPct,
          cols: c,
          rows: r,
          tiles,
        });
        close();
        return;
      }

      const planId = dest.planId;
      if (fovStore.selection.kind !== 'plan' || fovStore.selection.planId !== planId) {
        fovStore.setSelection({ kind: 'plan', planId });
      }
      if (edit) {
        // Re-tile the existing mosaic around the (possibly retargeted) centre/PA.
        await plansStore.updateMosaic(planId, edit.mosaicId, {
          dsoId,
          name,
          centerRa: center.ra,
          centerDec: center.dec,
          paDeg,
          overlapPct,
          cols: c,
          rows: r,
          tiles,
        });
      } else {
        // Standalone frames this mosaic stands in for: the same target, or any
        // custom-location frame sitting within the mosaic footprint. They're
        // deleted with the mosaic creation so only the mosaic remains.
        const f2 = 1 - overlapPct / 100;
        const reach = Math.max((c - 1) * tileW * f2 + tileW, (r - 1) * tileH * f2 + tileH) / 2;
        const replaceEntryIds = plan!.entries
          .filter((e) => {
            if (e.mosaicId) return false;
            if (dsoId && e.dsoId === dsoId) return true;
            const ed = e.dsoId ? getDSOById(e.dsoId) : null;
            const era = e.ra ?? ed?.ra;
            const edec = e.dec ?? ed?.dec;
            if (era == null || edec == null) return false;
            return angularDistDeg(center.ra, center.dec, era, edec) <= reach;
          })
          .map((e) => e.id);
        const params: MosaicParams = {
          dsoId,
          name,
          centerRa: center.ra,
          centerDec: center.dec,
          paDeg,
          overlapPct,
          cols: c,
          rows: r,
          tiles,
          replaceEntryIds,
        };
        await plansStore.createMosaic(planId, params);
      }
      close();
    });
    foot.appendChild(cancel);
    foot.appendChild(create);

    modal.appendChild(head);
    modal.appendChild(bodyM);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    nameInput.focus();
  }

  function renderAll() {
    renderSelect();
    renderSetupSelect();
    renderBody();
    // Dim the frame list when the master toggle hides frames from the map.
    const framesHidden = !fovStore.framesVisible;
    body.classList.toggle('opacity-50', framesHidden);
    body.classList.toggle('pointer-events-none', framesHidden);
    // Hidden frames can't be added to / extended — disable the footer actions and
    // explain (via tooltip) that frames must be shown again to re-enable them.
    // Pointer events stay on so the native title tooltip surfaces on hover.
    for (const [btn, label] of [
      [addBtn, t('fovOverlay.addFrame')],
      [addMosaicBtn, t('fovOverlay.addMosaic')],
    ] as const) {
      btn.classList.toggle('opacity-50', framesHidden);
      btn.classList.toggle('cursor-not-allowed', framesHidden);
      btn.title = framesHidden ? t('fovOverlay.framesHiddenHint') : label;
    }
  }

  // React to store changes; clean up on close. The dropdowns depend on the plan
  // list + selection + each plan's setup; the body depends on the resolved frames.
  const stopFrames = watch(
    () => fovStore.renderables,
    () => renderBody(),
    { deep: true },
  );
  const stopSelect = watch(
    () => [
      fovStore.selection,
      plansStore.plans.map((p) => `${p.id}:${p.name}:${p.setupId}`).join(','),
    ],
    () => renderAll(),
    { deep: true },
  );
  const stopVisible = watch(
    () => fovStore.framesVisible,
    () => renderAll(),
  );
  renderAll();

  popup.__cleanup = () => {
    stopFrames();
    stopSelect();
    stopVisible();
  };

  // Defer onReady so the popup is in the DOM and can be positioned.
  requestAnimationFrame(() => onReady?.());

  return popup;
}
