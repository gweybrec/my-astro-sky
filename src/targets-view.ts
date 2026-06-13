/**
 * Targets view — "Propose targets for tonight" feature.
 * A full-screen panel with gear/location/date inputs and a ranked result grid.
 */

import { t } from './i18n';
import { getDSOs, getDSOCatalog, DSO_CATALOGS_ALL } from './dso-catalog';
import { getConstellationInfos } from './star-catalog';
import {
  getTelescopes, getCameras, getAccessories, buildGearPreset, invalidateGearCache,
  telescopeLabel, cameraLabel, accessoryLabel,
} from './gear-catalog';
import type { TelescopeData, CameraData, AccessoryData } from './gear-catalog';
import { formatGearFovLabel, fovDeg, formatFov, pixelScaleArcsec } from './gear-presets';
import { recommendTargets, type ObserverLocation } from './target-recommender';
import { recommendRecipe } from './imaging-recipe';
import { createCustomGear, deleteCustomGear, getPhotos, getGearSetups, deleteGearSetupAPI, type GearSetupData } from './api';
import { showKeyValueTooltip, showTextTooltip } from './tooltip-utils';
import { showToast } from './toast';
import type { SkyMap } from './sky-map';
import type { TargetSuggestion } from './target-recommender';
import type { DSO } from './types';
import { createTargetsChip, createFilterBadge } from './chip-utils';
import trashSvg from './icons/trash.svg?raw';
import penSvg from './icons/pen.svg?raw';
import { openAddSetupModal, openEditSetupModal, buildFovFrameSpecs } from './fov-overlay';

// ─── Persistence key ─────────────────────────────────────────────────────────

const PREFS_KEY = 'targets-prefs-v3';

type SortKey = 'score' | 'altitude' | 'transit' | 'magnitude' | 'size' | 'fov-fit' | 'name' | 'rating' | 'difficulty';

interface TargetsPrefs {
  setupId: string | null;
  lat: number | null;
  lon: number | null;
  lastDateISO: string | null;
  coordFormat?: 'decimal' | 'dms';
  enabledTypes?: string[];
  resultLimit?: number;
  sortBy?: SortKey;
  horizonDirs?: string[];
  enabledRatings?: number[];
  enabledDifficulties?: number[];
  enabledCatalogs?: string[];
  includeOversized?: boolean;
  excludePhotographed?: boolean;
  pageSize?: number;
  enabledConstellations?: string[];
  minAltDeg?: number;
  maxAltDeg?: number;
}

function loadPrefs(): TargetsPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TargetsPrefs;
      if ('setupId' in parsed) return parsed;
    }
    // Migrate from v2 (had telescopeId/cameraId/accessoryId) — copy non-gear fields
    const legacy = localStorage.getItem('targets-prefs-v2');
    if (legacy) {
      const old = JSON.parse(legacy) as any;
      return {
        setupId: null,
        lat: old.lat ?? null,
        lon: old.lon ?? null,
        lastDateISO: old.lastDateISO ?? null,
        coordFormat: old.coordFormat,
        enabledTypes: old.enabledTypes,
        sortBy: old.sortBy,
        horizonDirs: old.horizonDirs,
        enabledRatings: old.enabledRatings,
        enabledDifficulties: old.enabledDifficulties,
        enabledCatalogs: old.enabledCatalogs,
        includeOversized: old.includeOversized,
        pageSize: old.pageSize,
      };
    }
  } catch {
    // ignore
  }
  return { setupId: null, lat: null, lon: null, lastDateISO: null };
}

function savePrefs(p: TargetsPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export function sortCustomFirst<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ac = a.id.startsWith('custom-');
    const bc = b.id.startsWith('custom-');
    return ac && !bc ? -1 : !ac && bc ? 1 : 0;
  });
}

// ─── DSO type labels ──────────────────────────────────────────────────────────

const ALL_DSO_TYPES = ['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN'] as const;

export interface DSOFilterOptions {
  enabledTypes: Set<string>;
  enabledRatings: Set<number>;
  enabledDifficulties: Set<number>;
  enabledCatalogs: Set<string>;
  photographedIds: Set<string> | null;
  enabledConstellations: Set<string> | null;
}

export function filterTargetDSOs(dsos: DSO[], opts: DSOFilterOptions): DSO[] {
  return dsos.filter(d => {
    if (!opts.enabledTypes.has(d.type as string)) return false;
    if (d.rating !== null && !opts.enabledRatings.has(d.rating)) return false;
    if (d.difficulty !== null && !opts.enabledDifficulties.has(d.difficulty)) return false;
    const cat = getDSOCatalog(d.id);
    if (cat !== null && !opts.enabledCatalogs.has(cat)) return false;
    if (opts.photographedIds !== null && opts.photographedIds.has(d.id)) return false;
    if (opts.enabledConstellations !== null && d.constellation !== null && !opts.enabledConstellations.has(d.constellation)) return false;
    return true;
  });
}

function dsoTypeLabel(type: string): string {
  return t(`dso.types.${type}`) || type;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatArcmin(arcmin: number | null): string {
  if (arcmin === null) return '—';
  if (arcmin >= 60) return `${(arcmin / 60).toFixed(1)}°`;
  return `${arcmin.toFixed(1)}'`;
}

function formatAlt(deg: number): string {
  return `${deg.toFixed(0)}°`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Sort/pagination helpers ──────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPageList(current: number, total: number): (number | null)[] {
  if (total <= 1) return [0];
  const pages = new Set<number>([0, total - 1]);
  for (let i = Math.max(0, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(null);
    result.push(sorted[i]);
  }
  return result;
}

function sortSuggestions(suggestions: TargetSuggestion[], sortBy: SortKey): TargetSuggestion[] {
  const arr = [...suggestions];
  switch (sortBy) {
    case 'altitude':   return arr.sort((a, b) => b.maxAltDeg - a.maxAltDeg);
    case 'transit':    return arr.sort((a, b) => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime());
    case 'magnitude':  return arr.sort((a, b) => (a.dso.mag ?? 99) - (b.dso.mag ?? 99));
    case 'size':       return arr.sort((a, b) => (b.dso.majAxis ?? 0) - (a.dso.majAxis ?? 0));
    case 'fov-fit':    return arr.sort((a, b) => b.fovFitScore - a.fovFitScore);
    case 'name':       return arr.sort((a, b) => (a.dso.catalogs[0] ?? a.dso.id).localeCompare(b.dso.catalogs[0] ?? b.dso.id, undefined, { numeric: true }));
    case 'rating':     return arr.sort((a, b) => (b.dso.rating ?? 0) - (a.dso.rating ?? 0));
    case 'difficulty': return arr.sort((a, b) => (b.dso.difficulty ?? 0) - (a.dso.difficulty ?? 0));
    default:           return arr.sort((a, b) => b.score - a.score);
  }
}

// ─── Custom gear modal ────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
  step?: string;
  helpKey?: string;
  placeholder?: string;
}

export function openAddGearModal(
  gearType: 'telescope' | 'camera' | 'accessory',
  onSaved: () => void,
): void {
  const titles: Record<string, string> = {
    telescope: t('targets.gear.addTelescopeTitle'),
    camera:    t('targets.gear.addCameraTitle'),
    accessory: t('targets.gear.addAccessoryTitle'),
  };

  const fieldsByType: Record<string, FieldDef[]> = {
    telescope: [
      { key: 'brand',           label: t('targets.gear.fields.brand'),          type: 'text',   required: true,  helpKey: 'brand',           placeholder: 'e.g. Celestron' },
      { key: 'model',           label: t('targets.gear.fields.model'),          type: 'text',   required: true,  helpKey: 'model',           placeholder: 'e.g. C8 SCT' },
      { key: 'aperture_mm',     label: t('targets.gear.fields.apertureMm'),     type: 'number', required: true,  helpKey: 'apertureMm',     step: '0.1',  placeholder: 'e.g. 203' },
      { key: 'focal_length_mm', label: t('targets.gear.fields.focalLengthMm'),  type: 'number', required: true,  helpKey: 'focalLengthMm',  step: '0.1',  placeholder: 'e.g. 2032' },
      { key: 'optical_design',  label: t('targets.gear.fields.opticalDesign'),  type: 'text',   required: false, helpKey: 'opticalDesign',  placeholder: 'e.g. Schmidt-Cassegrain' },
      { key: 'mount_interface', label: t('targets.gear.fields.mountInterface'), type: 'text',   required: false, helpKey: 'mountInterface', placeholder: 'e.g. M48, 2"' },
      { key: 'optical_notes',   label: t('targets.gear.fields.opticalNotes'),   type: 'text',   required: false, helpKey: 'opticalNotes' },
    ],
    camera: [
      { key: 'brand',            label: t('targets.gear.fields.brand'),          type: 'text',   required: true,  helpKey: 'brand',          placeholder: 'e.g. Atik' },
      { key: 'model',            label: t('targets.gear.fields.model'),          type: 'text',   required: true,  helpKey: 'model',          placeholder: 'e.g. 314L+' },
      {
        key: 'color_type', label: t('targets.gear.fields.colorType'), type: 'select', required: true, helpKey: 'colorType',
        options: [
          { value: 'OSC',  label: t('targets.gear.colorTypeOSC') },
          { value: 'Mono', label: t('targets.gear.colorTypeMono') },
        ],
      },
      { key: 'sensor_width_mm',  label: t('targets.gear.fields.sensorWidthMm'),  type: 'number', required: true,  helpKey: 'sensorWidthMm',  step: '0.01', placeholder: 'e.g. 8.98' },
      { key: 'sensor_height_mm', label: t('targets.gear.fields.sensorHeightMm'), type: 'number', required: true,  helpKey: 'sensorHeightMm', step: '0.01', placeholder: 'e.g. 6.71' },
      { key: 'pixel_size_um',    label: t('targets.gear.fields.pixelSizeUm'),    type: 'number', required: true,  helpKey: 'pixelSizeUm',    step: '0.01', placeholder: 'e.g. 6.45' },
      { key: 'sensor',           label: t('targets.gear.fields.sensor'),          type: 'text',   required: false, helpKey: 'sensor',         placeholder: 'e.g. Sony ICX285AL' },
    ],
    accessory: [
      { key: 'brand',                label: t('targets.gear.fields.brand'),               type: 'text',   required: true,  helpKey: 'brand',               placeholder: 'e.g. Celestron' },
      { key: 'model',                label: t('targets.gear.fields.model'),               type: 'text',   required: true,  helpKey: 'model',               placeholder: 'e.g. Focal Reducer 0.63×' },
      { key: 'magnification_factor', label: t('targets.gear.fields.magnificationFactor'), type: 'number', required: true,  helpKey: 'magnificationFactor', step: '0.01', placeholder: 'e.g. 0.63' },
      { key: 'type',                 label: t('targets.gear.fields.accessoryType'),       type: 'text',   required: false, helpKey: 'accessoryType',       placeholder: 'e.g. focal reducer' },
      { key: 'notes',                label: t('targets.gear.fields.accessoryNotes'),      type: 'text',   required: false, helpKey: 'accessoryNotes' },
      { key: 'thread_input',         label: t('targets.gear.fields.threadInput'),         type: 'text',   required: false, helpKey: 'threadInput',         placeholder: 'e.g. M48' },
      { key: 'thread_output',        label: t('targets.gear.fields.threadOutput'),        type: 'text',   required: false, helpKey: 'threadOutput',        placeholder: 'e.g. M42' },
    ],
  };

  const fields = fieldsByType[gearType];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal gear-custom-modal';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('h2');
  titleEl.textContent = titles[gearType];
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => backdrop.remove());
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body gear-custom-modal-body';

  const inputMap = new Map<string, HTMLInputElement | HTMLSelectElement>();

  for (const field of fields) {
    const wrapper = document.createElement('div');
    wrapper.className = 'gear-form-field';

    const label = document.createElement('label');
    label.className = 'targets-label gear-form-label';
    const labelText = document.createElement('span');
    labelText.textContent = field.required ? `${field.label} *` : field.label;
    label.appendChild(labelText);
    if (field.helpKey) {
      const helpIcon = document.createElement('span');
      helpIcon.className = 'hints-info-icon';
      helpIcon.textContent = 'ℹ';
      const hk = field.helpKey;
      helpIcon.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        showTextTooltip(helpIcon, t(`targets.gear.fields.help.${hk}`));
      });
      label.appendChild(helpIcon);
    }

    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === 'select' && field.options) {
      const sel = document.createElement('select');
      sel.className = 'targets-select';
      for (const opt of field.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      input = sel;
    } else {
      const inp = document.createElement('input');
      const isNum = field.type === 'number';
      inp.type = isNum ? 'number' : 'text';
      inp.className = isNum ? 'targets-coord-input gear-modal-number-input' : 'targets-coord-input';
      if (field.step) inp.step = field.step;
      if (field.placeholder) inp.placeholder = field.placeholder;
      input = inp;
    }
    input.id = `custom-gear-${field.key}`;
    label.htmlFor = input.id;

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    body.appendChild(wrapper);
    inputMap.set(field.key, input);
  }

  const footer = document.createElement('div');
  footer.className = 'gear-custom-modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('targets.gear.cancel');
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const saveBtn = document.createElement('button');
  saveBtn.className = 'targets-generate-btn';
  saveBtn.textContent = t('targets.gear.save');
  saveBtn.addEventListener('click', async () => {
    // Validate required fields
    let firstError: HTMLElement | null = null;
    for (const field of fields) {
      if (!field.required) continue;
      const input = inputMap.get(field.key);
      if (!input) continue;
      const val = input.value.trim();
      const wrapper = input.closest('.gear-form-field') as HTMLElement;
      // Remove previous error
      wrapper.querySelector('.gear-required-msg')?.remove();
      (input as HTMLElement).style.border = '';
      if (!val) {
        (input as HTMLElement).style.border = '2px solid #e55';
        const errMsg = document.createElement('span');
        errMsg.className = 'gear-required-msg';
        errMsg.textContent = t('targets.gear.requiredField');
        wrapper.appendChild(errMsg);
        if (!firstError) firstError = input as HTMLElement;
      }
    }
    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Collect data
    const data: Record<string, string | number> = {};
    for (const field of fields) {
      const input = inputMap.get(field.key);
      if (!input) continue;
      const val = input.value.trim();
      if (!val) continue;
      data[field.key] = field.type === 'number' ? parseFloat(val) : val;
    }
    // Fill required defaults for type-specific fields
    if (gearType === 'telescope') {
      data.is_smart_telescope = 0 as any;
      data.integrated_camera = 0 as any;
      data.integrated_camera_id = null as any;
      data.status = 'active';
    } else if (gearType === 'camera') {
      data.sensor_generation = 'CMOS';
      data.status = 'active';
    } else if (gearType === 'accessory') {
      data.status = 'active';
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '…';
    try {
      await createCustomGear(gearType, data);
      invalidateGearCache(gearType);
      backdrop.remove();
      onSaved();
    } catch (err: any) {
      saveBtn.disabled = false;
      saveBtn.textContent = t('targets.gear.save');
      alert(err.message);
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ─── Manage gear modal ────────────────────────────────────────────────────────

export function openManageGearModal(
  gearType: 'telescope' | 'camera' | 'accessory',
  allGear: Array<{ id: string; label: string }>,
  hiddenIds: Set<string>,
  onClose: (newHiddenIds: Set<string>, deletedIds: Set<string>) => void,
): void {
  const titles: Record<string, string> = {
    telescope: t('targets.gear.manageTelescopeTitle'),
    camera:    t('targets.gear.manageCameraTitle'),
    accessory: t('targets.gear.manageAccessoryTitle'),
  };
  const addLabels: Record<string, string> = {
    telescope: t('targets.gear.addTelescope'),
    camera:    t('targets.gear.addCamera'),
    accessory: t('targets.gear.addAccessory'),
  };
  const selectedCountKeys: Record<string, string> = {
    telescope: 'targets.gear.telescopesSelected',
    camera:    'targets.gear.camerasSelected',
    accessory: 'targets.gear.accessoriesSelected',
  };

  const requireOne = gearType !== 'accessory';
  const currentHidden = new Set(hiddenIds);
  const pendingDeletes = new Map<string, { label: string; dismissFn: () => void }>();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal gear-custom-modal';

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('h2');
  titleEl.textContent = titles[gearType];
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // ── Body ─────────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'modal-body gear-manage-modal-body';

  const countEl = document.createElement('div');
  countEl.className = 'gear-manage-count';

  const list = document.createElement('div');
  list.className = 'gear-manage-list';

  function updateCount(): void {
    const total = allGear.filter(g => !pendingDeletes.has(g.id)).length;
    const selected = allGear.filter(g => !currentHidden.has(g.id) && !pendingDeletes.has(g.id)).length;
    const base = t(selectedCountKeys[gearType], { selected: String(selected), total: String(total) });
    if (requireOne && selected === 0) {
      countEl.className = 'gear-manage-count gear-manage-count--error';
      countEl.textContent = `${base}. ${t('targets.gear.atLeastOneRequired')}`;
      closeBtn.disabled = true;
    } else {
      countEl.className = 'gear-manage-count';
      countEl.textContent = base;
      closeBtn.disabled = false;
    }
  }

  function buildRow(gear: { id: string; label: string }): HTMLElement {
    const isCustom = gear.id.startsWith('custom-');

    const row = document.createElement('div');
    row.className = 'gear-manage-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gear-manage-checkbox';
    checkbox.checked = !currentHidden.has(gear.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        currentHidden.delete(gear.id);
      } else {
        currentHidden.add(gear.id);
      }
      updateCount();
    });

    const nameEl = document.createElement('span');
    nameEl.className = 'gear-manage-name';
    nameEl.textContent = gear.label;

    row.appendChild(checkbox);
    row.appendChild(nameEl);

    if (isCustom) {
      const trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.className = 'integration-row-trash';
      trashBtn.innerHTML = trashSvg;
      trashBtn.addEventListener('click', () => {
        row.remove();
        currentHidden.delete(gear.id);

        const dismissFn = showToast({
          message: t('targets.gear.deleted', { name: gear.label }),
          type: 'undo',
          actionLabel: t('targets.gear.undo'),
          duration: 5000,
          onAction: () => {
            pendingDeletes.delete(gear.id);
            list.insertBefore(buildRow(gear), list.firstChild);
            updateCount();
          },
          onExpire: () => {
            pendingDeletes.delete(gear.id);
            deleteCustomGear(gear.id).then(() => invalidateGearCache(gearType)).catch(() => {});
          },
        });

        pendingDeletes.set(gear.id, { label: gear.label, dismissFn });
        updateCount();
      });
      row.appendChild(trashBtn);
    }

    return row;
  }

  for (const gear of allGear) {
    list.appendChild(buildRow(gear));
  }

  body.appendChild(countEl);
  body.appendChild(list);

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'gear-manage-modal-footer';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'targets-generate-btn';
  addBtn.textContent = addLabels[gearType];
  addBtn.addEventListener('click', () => {
    backdrop.remove();
    openAddGearModal(gearType, () => {
      const getList = gearType === 'telescope' ? getTelescopes : gearType === 'camera' ? getCameras : getAccessories;
      const labelFn = gearType === 'telescope' ? telescopeLabel : gearType === 'camera' ? cameraLabel : accessoryLabel;
      getList().then(newAll => {
        const sorted = sortCustomFirst(newAll as Array<{ id: string }>);
        const gearWithLabels = sorted.map(g => ({ id: g.id, label: (labelFn as (g: any) => string)(g) }));
        openManageGearModal(gearType, gearWithLabels, currentHidden, onClose);
      });
    });
  });

  footer.appendChild(addBtn);

  // ── Close handler ─────────────────────────────────────────────────────────────
  closeBtn.addEventListener('click', () => {
    for (const [id, item] of pendingDeletes) {
      item.dismissFn();
      deleteCustomGear(id).then(() => invalidateGearCache(gearType)).catch(() => {});
    }
    backdrop.remove();
    onClose(currentHidden, new Set(pendingDeletes.keys()));
  });

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  updateCount();
}

// ─── Gear section helpers (exported for reuse) ───────────────────────────────

export interface GearSectionPrefs {
  telescopeId: string;
  cameraId: string | null;
  accessoryId: string | null;
  hiddenGearIds?: string[];
}

export interface GearSectionCallbacks {
  onPrefsChange: (partial: Partial<GearSectionPrefs>) => void;
  onRebuild: (container: HTMLElement) => void;
}

export function buildGearRow(
  label: string,
  options: { value: string; label: string }[],
  selectedValue: string,
  disabledTooltip?: string,
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'targets-form-row targets-gear-row';

  const lbl = document.createElement('label');
  lbl.className = 'targets-label';
  lbl.textContent = label;

  const select = document.createElement('select');
  select.className = 'targets-select';
  select.style.flex = '1';
  if (disabledTooltip) {
    select.disabled = true;
    select.title = disabledTooltip;
  }
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selectedValue) o.selected = true;
    select.appendChild(o);
  }

  row.appendChild(lbl);
  row.appendChild(select);
  return { row, select };
}

export function buildInfoButton(onClick: () => void): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.className = 'hints-info-icon';
  btn.textContent = 'ℹ';
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

export function buildAddButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'targets-add-gear-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function buildGearSectionContent(
  container: HTMLElement,
  prefs: GearSectionPrefs,
  callbacks: GearSectionCallbacks,
): void {
  container.innerHTML = `<div class="targets-form-row"><span class="targets-label" style="color:#888">…</span></div>`;

  Promise.all([getTelescopes(), getCameras(), getAccessories()]).then(([telescopes, cameras, accessories]) => {
    container.innerHTML = '';

    const hiddenSet = new Set(prefs.hiddenGearIds ?? []);

    const fovHintEl = document.createElement('div');
    fovHintEl.className = 'targets-fov-hint';

    const updateFovHint = (tel: TelescopeData | undefined, cam: CameraData | undefined, acc: AccessoryData | null): void => {
      if (!tel || !cam) { fovHintEl.textContent = ''; return; }
      const preset = buildGearPreset(tel, cam, acc);
      fovHintEl.textContent = `${t('targets.gear.effectiveFocalLength')}: ${formatGearFovLabel(preset)}`;
    };

    // ── Telescope row ────────────────────────────────────────────────────
    const visibleTelescopes = sortCustomFirst(telescopes).filter(tel => !hiddenSet.has(tel.id));
    if (!visibleTelescopes.find(tel => tel.id === prefs.telescopeId)) {
      callbacks.onPrefsChange({ telescopeId: visibleTelescopes[0]?.id ?? '' });
    }

    const { row: telRow, select: telSelect } = buildGearRow(
      t('targets.gear.telescope'),
      visibleTelescopes.map(tel => ({ value: tel.id, label: telescopeLabel(tel) })),
      prefs.telescopeId,
    );
    const telInfoBtn = buildInfoButton(() => {
      const tel = visibleTelescopes.find(t => t.id === telSelect.value);
      if (!tel) return;
      showKeyValueTooltip(telInfoBtn, [
        [t('targets.gear.info.brand'),         tel.brand],
        [t('targets.gear.info.model'),         tel.model],
        [t('targets.gear.info.opticalDesign'), tel.optical_design],
        [t('targets.gear.info.mountInterface'), tel.mount_interface],
        [t('targets.gear.info.opticalNotes'),  tel.optical_notes],
        [t('targets.gear.info.recommendedUse'), tel.recommended_use?.map(u => t(`targets.gear.info.useLabels.${u}`)).join(', ') ?? null],
      ]);
    });
    telRow.appendChild(telInfoBtn);
    container.appendChild(telRow);

    const telManageBtn = buildAddButton(t('targets.gear.manageTelescope'), () => {
      const all = sortCustomFirst(telescopes).map(tel => ({ id: tel.id, label: telescopeLabel(tel) }));
      openManageGearModal('telescope', all, new Set(prefs.hiddenGearIds ?? []),
        (newHidden, deleted) => {
          if (deleted.size > 0) invalidateGearCache('telescope');
          const visible = sortCustomFirst(telescopes).filter(t => !newHidden.has(t.id) && !deleted.has(t.id));
          const newTelId = visible.find(t => t.id === prefs.telescopeId)
            ? prefs.telescopeId
            : (visible[0]?.id ?? '');
          callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], telescopeId: newTelId });
          callbacks.onRebuild(container);
        });
    });
    container.appendChild(telManageBtn);

    // ── Camera row ───────────────────────────────────────────────────────
    const currentTel = visibleTelescopes.find(t => t.id === prefs.telescopeId);
    const isSmart = currentTel?.is_smart_telescope ?? false;

    const visibleCameras = sortCustomFirst(cameras).filter(cam => !hiddenSet.has(cam.id));
    if (prefs.cameraId && !visibleCameras.find(c => c.id === prefs.cameraId)) {
      callbacks.onPrefsChange({ cameraId: visibleCameras[0]?.id ?? null });
    }

    // Determine camera ID: for smart telescopes, use integrated camera
    let initialCamId = prefs.cameraId;
    if (isSmart && currentTel?.integrated_camera_id) {
      initialCamId = currentTel.integrated_camera_id;
    }

    const { row: camRow, select: camSelect } = buildGearRow(
      t('targets.gear.camera'),
      visibleCameras.map(cam => ({ value: cam.id, label: cameraLabel(cam) })),
      initialCamId ?? (visibleCameras[0]?.id ?? ''),
      isSmart ? t('targets.gear.smartTelescopeLocked') : undefined,
    );
    const camInfoBtn = buildInfoButton(() => {
      const cam = visibleCameras.find(c => c.id === camSelect.value);
      if (!cam) return;
      showKeyValueTooltip(camInfoBtn, [
        [t('targets.gear.info.brand'),      cam.brand],
        [t('targets.gear.info.model'),      cam.model],
        [t('targets.gear.info.sensor'),     cam.sensor],
        [t('targets.gear.info.sensorSize'), `${cam.sensor_width_mm} × ${cam.sensor_height_mm} mm`],
        [t('targets.gear.info.resolution'), `${cam.resolution_x} × ${cam.resolution_y} px`],
        [t('targets.gear.info.recommendedUse'), cam.recommended_use?.map(u => t(`targets.gear.info.useLabels.${u}`)).join(', ') ?? null],
      ]);
    });
    camRow.appendChild(camInfoBtn);
    container.appendChild(camRow);

    const camManageBtn = buildAddButton(t('targets.gear.manageCamera'), () => {
      const all = sortCustomFirst(cameras).map(cam => ({ id: cam.id, label: cameraLabel(cam) }));
      openManageGearModal('camera', all, new Set(prefs.hiddenGearIds ?? []),
        (newHidden, deleted) => {
          if (deleted.size > 0) invalidateGearCache('camera');
          const visible = sortCustomFirst(cameras).filter(c => !newHidden.has(c.id) && !deleted.has(c.id));
          const newCamId = prefs.cameraId && visible.find(c => c.id === prefs.cameraId)
            ? prefs.cameraId
            : (visible[0]?.id ?? null);
          callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], cameraId: newCamId });
          callbacks.onRebuild(container);
        });
    });
    if (isSmart) camManageBtn.classList.add('hidden');
    container.appendChild(camManageBtn);

    // ── Accessory row ────────────────────────────────────────────────────
    const visibleAccessories = sortCustomFirst(accessories).filter(acc => !hiddenSet.has(acc.id));
    if (prefs.accessoryId && !visibleAccessories.find(a => a.id === prefs.accessoryId)) {
      callbacks.onPrefsChange({ accessoryId: null });
    }

    const accOptions = [
      { value: '', label: t('targets.gear.noAccessory') },
      ...visibleAccessories.map(acc => ({ value: acc.id, label: accessoryLabel(acc) })),
    ];
    const { row: accRow, select: accSelect } = buildGearRow(
      t('targets.gear.accessory'),
      accOptions,
      isSmart ? '' : (prefs.accessoryId ?? ''),
      isSmart ? t('targets.gear.smartTelescopeLocked') : undefined,
    );
    const accInfoBtn = buildInfoButton(() => {
      const acc = visibleAccessories.find(a => a.id === accSelect.value);
      if (!acc) {
        showTextTooltip(accInfoBtn, t('targets.gear.noAccessorySelected'));
        return;
      }
      showKeyValueTooltip(accInfoBtn, [
        [t('targets.gear.info.brand'),          acc.brand],
        [t('targets.gear.info.model'),          acc.model],
        [t('targets.gear.info.accessoryNotes'), acc.notes],
        [t('targets.gear.info.threadInput'),    acc.thread_input],
        [t('targets.gear.info.threadOutput'),   acc.thread_output],
      ]);
    });
    accRow.appendChild(accInfoBtn);
    container.appendChild(accRow);

    const accManageBtn = buildAddButton(t('targets.gear.manageAccessory'), () => {
      const all = sortCustomFirst(accessories).map(acc => ({ id: acc.id, label: accessoryLabel(acc) }));
      openManageGearModal('accessory', all, new Set(prefs.hiddenGearIds ?? []),
        (newHidden, deleted) => {
          if (deleted.size > 0) invalidateGearCache('accessory');
          const visible = sortCustomFirst(accessories).filter(a => !newHidden.has(a.id) && !deleted.has(a.id));
          const newAccId = prefs.accessoryId && visible.find(a => a.id === prefs.accessoryId)
            ? prefs.accessoryId
            : null;
          callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], accessoryId: newAccId });
          callbacks.onRebuild(container);
        });
    });
    if (isSmart) accManageBtn.classList.add('hidden');
    container.appendChild(accManageBtn);

    // ── FOV hint ─────────────────────────────────────────────────────────
    container.appendChild(fovHintEl);

    // Initial hint
    const currentCam = visibleCameras.find(c => c.id === (
      isSmart && currentTel?.integrated_camera_id
        ? currentTel.integrated_camera_id
        : (prefs.cameraId ?? '')
    ));
    const currentAcc = isSmart ? null : (visibleAccessories.find(a => a.id === (prefs.accessoryId ?? '')) ?? null);
    updateFovHint(currentTel, currentCam, currentAcc);

    // ── Change handlers ──────────────────────────────────────────────────
    telSelect.addEventListener('change', () => {
      callbacks.onPrefsChange({ telescopeId: telSelect.value });
      callbacks.onRebuild(container);
    });

    camSelect.addEventListener('change', () => {
      if (!isSmart) {
        callbacks.onPrefsChange({ cameraId: camSelect.value });
        const tel = visibleTelescopes.find(t => t.id === telSelect.value);
        const cam = visibleCameras.find(c => c.id === camSelect.value);
        const acc = accSelect.value ? (visibleAccessories.find(a => a.id === accSelect.value) ?? null) : null;
        updateFovHint(tel, cam, acc);
      }
    });

    accSelect.addEventListener('change', () => {
      if (!isSmart) {
        callbacks.onPrefsChange({ accessoryId: accSelect.value || null });
        const tel = visibleTelescopes.find(t => t.id === telSelect.value);
        const cam = visibleCameras.find(c => c.id === camSelect.value);
        const acc = accSelect.value ? (visibleAccessories.find(a => a.id === accSelect.value) ?? null) : null;
        updateFovHint(tel, cam, acc);
      }
    });
  }).catch(() => {
    container.innerHTML = '<div class="targets-form-row" style="color:#e55">Failed to load gear catalog</div>';
  });
}

// ─── TargetsView class ────────────────────────────────────────────────────────

export class TargetsView {
  private container: HTMLElement;
  private skyMap: SkyMap;
  private onNavigate: (ra: number, dec: number, setupId: string | null) => void;

  public onEditDSO: ((dso: DSO) => void) | null = null;
  private prefs: TargetsPrefs;
  private lastPool: TargetSuggestion[] = [];
  private lastSuggestions: TargetSuggestion[] = [];
  private lastPreset: ReturnType<typeof buildGearPreset> | null = null;
  private lastMode: 'best' | 'random' = 'best';
  private currentPage = 0;
  private generateBtn: HTMLButtonElement | null = null;
  private randomBtn: HTMLButtonElement | null = null;
  private dateInput: HTMLInputElement | null = null;

  constructor(skyMap: SkyMap, onNavigate: (ra: number, dec: number, setupId: string | null) => void) {
    this.skyMap = skyMap;
    this.onNavigate = onNavigate;
    this.prefs = loadPrefs();
    this.container = document.getElementById('targets-container')!;
    this.render();
  }

  show(): void {
    this.container.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    this.container.innerHTML = '';
    this.container.className = 'targets-view';
    const inner = document.createElement('div');
    inner.className = 'targets-inner';
    this.container.appendChild(inner);
    inner.appendChild(this.buildForm());
    const resultsEl = document.createElement('div');
    resultsEl.className = 'targets-results';
    resultsEl.id = 'targets-results';
    inner.appendChild(resultsEl);
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  private buildForm(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'targets-form-details';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'targets-form-summary';
    summary.textContent = t('targets.formTitle');
    details.appendChild(summary);

    const form = document.createElement('div');
    form.className = 'targets-form';

    // ── Gear section (async: populated after catalogs load) ──────────────────
    const gearSection = document.createElement('div');
    form.appendChild(gearSection);
    this.buildGearSection(gearSection);

    // ── Location ─────────────────────────────────────────────────────────────
    const locSection = document.createElement('div');
    locSection.className = 'targets-form-row';
    const locLabel = document.createElement('div');
    locLabel.className = 'targets-label';
    locLabel.textContent = t('targets.location.label');

    const locControls = document.createElement('div');
    locControls.className = 'targets-loc-controls';
    const locBtn = document.createElement('button');
    locBtn.type = 'button';
    locBtn.className = 'targets-loc-btn';
    locBtn.textContent = t('targets.location.useBrowser');

    if ((window as any).electronAPI) {
      const ipHint = document.createElement('span');
      ipHint.className = 'targets-loc-hint';
      ipHint.textContent = t('targets.location.ipBased');
      locControls.appendChild(locBtn);
      locControls.appendChild(ipHint);
    } else {
      locControls.appendChild(locBtn);
    }

    const coordEntry = document.createElement('div');
    coordEntry.className = 'targets-coord-entry';
    const fmtToggle = document.createElement('button');
    fmtToggle.type = 'button';
    fmtToggle.className = 'targets-coord-fmt-toggle';
    let coordFmt: 'decimal' | 'dms' = this.prefs.coordFormat ?? 'decimal';

    const decimalToDMS = (dec: number): [number, number, number] => {
      const sign = dec < 0 ? -1 : 1;
      const abs = Math.abs(dec);
      let d = Math.floor(abs);
      const rm = (abs - d) * 60;
      let m = Math.floor(rm);
      let s = Math.round((rm - m) * 60);
      if (s >= 60) { s = 0; m++; }
      if (m >= 60) { m = 0; d++; }
      return [d * sign, m, s];
    };
    const dmsToDecimal = (d: number, m: number, s: number): number => {
      const sign = (d < 0 || Object.is(d, -0)) ? -1 : 1;
      return sign * (Math.abs(d) + m / 60 + s / 3600);
    };

    const geoLocate = (onDone: () => void): void => {
      locBtn.textContent = t('targets.location.locating');
      locBtn.disabled = true;
      const onSuccess = (latitude: number, longitude: number) => {
        this.prefs.lat = Math.round(latitude * 100) / 100;
        this.prefs.lon = Math.round(longitude * 100) / 100;
        savePrefs(this.prefs);
        onDone();
        locBtn.textContent = t('targets.location.useBrowser');
        locBtn.disabled = false;
      };
      const onError = () => {
        locBtn.textContent = t('targets.location.error');
        locBtn.disabled = false;
      };
      if ((window as any).electronAPI) {
        (window as any).electronAPI.getLocation()
          .then((c: { latitude: number; longitude: number }) => onSuccess(c.latitude, c.longitude))
          .catch(onError);
      } else {
        navigator.geolocation.getCurrentPosition(
          pos => onSuccess(pos.coords.latitude, pos.coords.longitude),
          onError,
        );
      }
    };

    const buildCoordEntry = (fmt: 'decimal' | 'dms'): void => {
      coordEntry.innerHTML = '';
      fmtToggle.textContent = fmt === 'decimal' ? 'DMS (° ′ ″)' : 'Decimal';
      fmtToggle.title = fmt === 'decimal' ? 'Switch to degrees/arcminutes/arcseconds' : 'Switch to decimal degrees';
      if (fmt === 'decimal') {
        const latIn = document.createElement('input');
        latIn.type = 'number'; latIn.className = 'targets-coord-input';
        latIn.placeholder = t('targets.location.lat'); latIn.step = '0.01'; latIn.min = '-90'; latIn.max = '90';
        if (this.prefs.lat !== null) latIn.value = String(this.prefs.lat);
        const lonIn = document.createElement('input');
        lonIn.type = 'number'; lonIn.className = 'targets-coord-input';
        lonIn.placeholder = t('targets.location.lon'); lonIn.step = '0.01'; lonIn.min = '-180'; lonIn.max = '180';
        if (this.prefs.lon !== null) lonIn.value = String(this.prefs.lon);
        const sync = (): void => {
          this.prefs.lat = isNaN(parseFloat(latIn.value)) ? null : parseFloat(latIn.value);
          this.prefs.lon = isNaN(parseFloat(lonIn.value)) ? null : parseFloat(lonIn.value);
          savePrefs(this.prefs);
        };
        latIn.addEventListener('change', sync);
        lonIn.addEventListener('change', sync);
        locBtn.onclick = () => geoLocate(() => {
          if (this.prefs.lat !== null) latIn.value = String(this.prefs.lat);
          if (this.prefs.lon !== null) lonIn.value = String(this.prefs.lon);
        });
        const makeDecimalGroup = (label: string, input: HTMLInputElement): HTMLElement => {
          const wrap = document.createElement('div'); wrap.className = 'targets-dms-group';
          const lbl = document.createElement('span'); lbl.className = 'targets-dms-label'; lbl.textContent = label;
          wrap.appendChild(lbl); wrap.appendChild(input); return wrap;
        };
        coordEntry.appendChild(makeDecimalGroup('Lat', latIn));
        coordEntry.appendChild(makeDecimalGroup('Lon', lonIn));
      } else {
        const makeDMSGroup = (isLat: boolean): { el: HTMLElement; getVal: () => number | null } => {
          const initial = isLat ? this.prefs.lat : this.prefs.lon;
          let dV = 0, mV = 0, sV = 0;
          if (initial !== null) [dV, mV, sV] = decimalToDMS(initial);
          const wrap = document.createElement('div'); wrap.className = 'targets-dms-group';
          const lbl = document.createElement('span'); lbl.className = 'targets-dms-label'; lbl.textContent = isLat ? 'Lat' : 'Lon';
          const dIn = document.createElement('input');
          dIn.type = 'number'; dIn.className = 'targets-dms-input';
          dIn.min = isLat ? '-90' : '-180'; dIn.max = isLat ? '90' : '180'; dIn.step = '1';
          if (initial !== null) dIn.value = String(dV);
          const sep1 = document.createElement('span'); sep1.className = 'targets-dms-sep'; sep1.textContent = '°';
          const mIn = document.createElement('input');
          mIn.type = 'number'; mIn.className = 'targets-dms-input targets-dms-sub';
          mIn.min = '0'; mIn.max = '59'; mIn.step = '1'; mIn.placeholder = '0';
          if (initial !== null) mIn.value = String(mV);
          const sep2 = document.createElement('span'); sep2.className = 'targets-dms-sep'; sep2.textContent = "'";
          const sIn = document.createElement('input');
          sIn.type = 'number'; sIn.className = 'targets-dms-input targets-dms-sub';
          sIn.min = '0'; sIn.max = '59'; sIn.step = '1'; sIn.placeholder = '0';
          if (initial !== null) sIn.value = String(sV);
          const sep3 = document.createElement('span'); sep3.className = 'targets-dms-sep'; sep3.textContent = '″';
          wrap.append(lbl, dIn, sep1, mIn, sep2, sIn, sep3);
          const getVal = (): number | null => {
            const d = parseFloat(dIn.value); const m = parseFloat(mIn.value) || 0; const s = parseFloat(sIn.value) || 0;
            if (isNaN(d)) return null;
            return dmsToDecimal(d, m, s);
          };
          return { el: wrap, getVal };
        };
        const latGroup = makeDMSGroup(true);
        const lonGroup = makeDMSGroup(false);
        const sync = (): void => { this.prefs.lat = latGroup.getVal(); this.prefs.lon = lonGroup.getVal(); savePrefs(this.prefs); };
        latGroup.el.querySelectorAll('input').forEach(i => i.addEventListener('change', sync));
        lonGroup.el.querySelectorAll('input').forEach(i => i.addEventListener('change', sync));
        locBtn.onclick = () => geoLocate(() => buildCoordEntry('dms'));
        coordEntry.appendChild(latGroup.el);
        coordEntry.appendChild(lonGroup.el);
      }
    };
    buildCoordEntry(coordFmt);
    fmtToggle.addEventListener('click', () => {
      coordFmt = coordFmt === 'decimal' ? 'dms' : 'decimal';
      this.prefs.coordFormat = coordFmt;
      savePrefs(this.prefs);
      buildCoordEntry(coordFmt);
    });
    locControls.appendChild(coordEntry);
    locControls.appendChild(fmtToggle);
    locSection.appendChild(locLabel);
    locSection.appendChild(locControls);
    form.appendChild(locSection);

    // ── Date ─────────────────────────────────────────────────────────────────
    const dateRow = document.createElement('div');
    dateRow.className = 'targets-form-row';
    const dateLabel = document.createElement('label');
    dateLabel.className = 'targets-label';
    dateLabel.textContent = t('targets.date.label');
    this.dateInput = document.createElement('input');
    const dateInput = this.dateInput;
    dateInput.type = 'date'; dateInput.className = 'targets-coord-input';
    dateInput.value = this.prefs.lastDateISO ?? todayISO();
    dateInput.addEventListener('change', () => { this.prefs.lastDateISO = dateInput.value; savePrefs(this.prefs); });
    dateRow.appendChild(dateLabel);
    dateRow.appendChild(dateInput);
    form.appendChild(dateRow);

    // ── DSO type filter ──────────────────────────────────────────────────────
    const typeRow = document.createElement('div');
    typeRow.className = 'targets-form-row targets-type-filter-row';
    const typeLabel = document.createElement('div');
    typeLabel.className = 'targets-label';
    typeLabel.textContent = t('targets.typeFilter');
    const typeFilters = document.createElement('div');
    typeFilters.className = 'targets-type-filters';
    const enabledTypeSet = new Set(this.prefs.enabledTypes ?? [...ALL_DSO_TYPES]);
    for (const type of ALL_DSO_TYPES) {
      const chip = createTargetsChip(dsoTypeLabel(type));
      const cb = chip.querySelector('input')!;
      cb.checked = enabledTypeSet.has(type);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledTypeSet.add(type); else enabledTypeSet.delete(type);
        this.prefs.enabledTypes = [...enabledTypeSet]; savePrefs(this.prefs);
      });
      typeFilters.appendChild(chip);
    }
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeFilters);
    form.appendChild(typeRow);

    // ── Horizon direction filter ─────────────────────────────────────────────
    const horizonRow = document.createElement('div');
    horizonRow.className = 'targets-form-row targets-type-filter-row';
    const horizonLabel = document.createElement('div');
    horizonLabel.className = 'targets-label';
    horizonLabel.textContent = t('targets.horizon.label');
    horizonLabel.title = t('targets.horizon.tooltip') ?? '';
    const compassEl = document.createElement('div');
    compassEl.className = 'targets-type-filters';
    const enabledDirSet = new Set(this.prefs.horizonDirs ?? ['N', 'S', 'E', 'W']);
    const DIR_DEFS: [string, 'north' | 'south' | 'east' | 'west', string][] = [
      ['N', 'north', '↑'], ['S', 'south', '↓'], ['E', 'east', '→'], ['W', 'west', '←'],
    ];
    for (const [key, i18nKey, arrow] of DIR_DEFS) {
      const chip = createTargetsChip(`${arrow} ${t(`targets.horizon.${i18nKey}`)}`, { title: t(`targets.horizon.${i18nKey}Tooltip`) ?? key });
      const cb = chip.querySelector('input')!;
      cb.checked = enabledDirSet.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledDirSet.add(key); else enabledDirSet.delete(key);
        this.prefs.horizonDirs = [...enabledDirSet]; savePrefs(this.prefs);
      });
      compassEl.appendChild(chip);
    }
    horizonRow.appendChild(horizonLabel);
    horizonRow.appendChild(compassEl);
    form.appendChild(horizonRow);

    // ── Altitude range filter ─────────────────────────────────────────────────
    const altRow = document.createElement('div');
    altRow.className = 'targets-form-row';
    const altLabel = document.createElement('div');
    altLabel.className = 'targets-label';
    altLabel.textContent = t('targets.altRangeLabel');
    altLabel.title = t('targets.altRangeTooltip') ?? '';

    const altEntry = document.createElement('div');
    altEntry.className = 'targets-coord-entry';

    const makeAltGroup = (labelKey: string, defaultVal: number, min: number, max: number): HTMLInputElement => {
      const group = document.createElement('div');
      group.className = 'targets-dms-group';
      const lbl = document.createElement('span');
      lbl.className = 'targets-dms-label';
      lbl.textContent = t(`targets.${labelKey}`);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'targets-dms-input';
      inp.setAttribute('aria-label', t(`targets.${labelKey}`) + ' °');
      inp.min = String(min); inp.max = String(max); inp.step = '1';
      inp.value = String(defaultVal);
      const unit = document.createElement('span');
      unit.className = 'targets-dms-sep';
      unit.textContent = '°';
      group.appendChild(lbl);
      group.appendChild(inp);
      group.appendChild(unit);
      altEntry.appendChild(group);
      return inp;
    };

    const minAltInput = makeAltGroup('minAlt', this.prefs.minAltDeg ?? 20, 0, 89);
    const maxAltInput = makeAltGroup('maxAlt', this.prefs.maxAltDeg ?? 80, 1, 90);

    minAltInput.addEventListener('change', () => {
      const v = parseInt(minAltInput.value, 10);
      if (!isNaN(v)) { this.prefs.minAltDeg = v; savePrefs(this.prefs); }
    });
    maxAltInput.addEventListener('change', () => {
      const v = parseInt(maxAltInput.value, 10);
      if (!isNaN(v)) { this.prefs.maxAltDeg = v; savePrefs(this.prefs); }
    });

    altRow.appendChild(altLabel);
    altRow.appendChild(altEntry);
    form.appendChild(altRow);

    // ── Constellation filter ─────────────────────────────────────────────────
    // Deduplicate by IAU id (Serpens appears twice in the data as Caput + Cauda)
    const seen = new Set<string>();
    const allConstInfos = getConstellationInfos()
      .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const totalConsts = allConstInfos.length;
    const constRow = document.createElement('div');
    constRow.className = 'targets-form-row';
    const constLabel = document.createElement('div');
    constLabel.className = 'targets-label';
    constLabel.textContent = t('targets.constellationFilter');
    const constSelectBtn = document.createElement('button');
    constSelectBtn.type = 'button';
    constSelectBtn.className = 'targets-loc-btn';
    constSelectBtn.textContent = t('targets.constellationSelect');
    const constCountEl = document.createElement('span');
    constCountEl.className = 'targets-const-count';
    const updateConstCount = () => {
      const n = this.prefs.enabledConstellations?.length ?? totalConsts;
      constCountEl.textContent = `${n} / ${totalConsts} ${t('targets.constellationCountLabel')}`;
    };
    updateConstCount();
    constSelectBtn.addEventListener('click', () => {
      const selectedSet = new Set<string>(this.prefs.enabledConstellations ?? allConstInfos.map(c => c.id));
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal targets-const-modal';
      const header = document.createElement('div');
      header.className = 'modal-header';
      const titleEl = document.createElement('h2');
      titleEl.textContent = t('targets.constellationModalTitle');
      const closeBtn = document.createElement('button');
      closeBtn.className = 'modal-close';
      closeBtn.textContent = '×';
      const save = () => {
        this.prefs.enabledConstellations = selectedSet.size === totalConsts ? undefined : [...selectedSet];
        savePrefs(this.prefs);
        updateConstCount();
        backdrop.remove();
      };
      closeBtn.addEventListener('click', save);
      header.appendChild(titleEl);
      header.appendChild(closeBtn);
      const body = document.createElement('div');
      body.className = 'targets-const-modal-body';
      // Select-all tristate checkbox (reuses fov-popup-select-all-row pattern)
      const selectAllRow = document.createElement('label');
      selectAllRow.className = 'fov-popup-select-all-row';
      const selectAllCb = document.createElement('input');
      selectAllCb.type = 'checkbox';
      selectAllCb.style.margin = '0';
      const selectAllLabel = document.createElement('span');
      selectAllLabel.textContent = t('targets.constellationSelectAll');
      selectAllRow.appendChild(selectAllCb);
      selectAllRow.appendChild(selectAllLabel);
      const grid = document.createElement('div');
      grid.className = 'targets-const-grid';
      const chipCbs: HTMLInputElement[] = [];
      const updateSelectAllCb = () => {
        const n = chipCbs.filter(cb => cb.checked).length;
        selectAllCb.indeterminate = n > 0 && n < totalConsts;
        selectAllCb.checked = n === totalConsts;
      };
      selectAllCb.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        chipCbs.forEach(cb => { cb.checked = checked; });
        allConstInfos.forEach(c => { if (checked) selectedSet.add(c.id); else selectedSet.delete(c.id); });
      });
      for (const c of allConstInfos) {
        const chip = createTargetsChip(c.displayName);
        const cb = chip.querySelector('input') as HTMLInputElement;
        cb.value = c.id;
        cb.checked = selectedSet.has(c.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSet.add(c.id); else selectedSet.delete(c.id);
          updateSelectAllCb();
        });
        chipCbs.push(cb);
        grid.appendChild(chip);
      }
      updateSelectAllCb();
      body.appendChild(selectAllRow);
      body.appendChild(grid);
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'targets-generate-btn';
      doneBtn.textContent = t('targets.constellationDone');
      doneBtn.addEventListener('click', save);
      footer.appendChild(doneBtn);
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
    });
    constRow.appendChild(constLabel);
    constRow.appendChild(constSelectBtn);
    constRow.appendChild(constCountEl);
    form.appendChild(constRow);

    // ── Rating filter ────────────────────────────────────────────────────────
    const ratingRow = document.createElement('div');
    ratingRow.className = 'targets-form-row targets-type-filter-row';
    const ratingLabel = document.createElement('div');
    ratingLabel.className = 'targets-label';
    ratingLabel.textContent = t('targets.ratingFilter');
    const ratingFilters = document.createElement('div');
    ratingFilters.className = 'targets-type-filters';
    const enabledRatingSet = new Set(this.prefs.enabledRatings ?? [1, 2, 3, 4, 5]);
    for (let r = 1; r <= 5; r++) {
      const chip = createTargetsChip('★'.repeat(r), { extraClass: 'targets-rating-chip' });
      const cb = chip.querySelector('input')!;
      cb.checked = enabledRatingSet.has(r);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledRatingSet.add(r); else enabledRatingSet.delete(r);
        this.prefs.enabledRatings = [...enabledRatingSet]; savePrefs(this.prefs);
      });
      ratingFilters.appendChild(chip);
    }
    ratingRow.appendChild(ratingLabel);
    ratingRow.appendChild(ratingFilters);
    form.appendChild(ratingRow);

    // ── Difficulty filter ────────────────────────────────────────────────────
    const diffRow = document.createElement('div');
    diffRow.className = 'targets-form-row targets-type-filter-row';
    const diffLabel = document.createElement('div');
    diffLabel.className = 'targets-label';
    diffLabel.textContent = t('targets.difficultyFilter');
    const diffFilters = document.createElement('div');
    diffFilters.className = 'targets-type-filters';
    const enabledDiffSet = new Set(this.prefs.enabledDifficulties ?? [1, 2, 3, 4, 5]);
    for (let d = 1; d <= 5; d++) {
      const chip = createTargetsChip('◆'.repeat(d), { extraClass: 'targets-difficulty-chip' });
      const cb = chip.querySelector('input')!;
      cb.checked = enabledDiffSet.has(d);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledDiffSet.add(d); else enabledDiffSet.delete(d);
        this.prefs.enabledDifficulties = [...enabledDiffSet]; savePrefs(this.prefs);
      });
      diffFilters.appendChild(chip);
    }
    diffRow.appendChild(diffLabel);
    diffRow.appendChild(diffFilters);
    form.appendChild(diffRow);

    // ── Catalog filter ───────────────────────────────────────────────────────
    const catRow = document.createElement('div');
    catRow.className = 'targets-form-row targets-type-filter-row';
    const catLabel = document.createElement('div');
    catLabel.className = 'targets-label';
    catLabel.textContent = t('targets.catalogFilter');
    const catFilters = document.createElement('div');
    catFilters.className = 'targets-type-filters';
    const enabledCatSet = new Set(this.prefs.enabledCatalogs ?? [...DSO_CATALOGS_ALL]);
    for (const cat of DSO_CATALOGS_ALL) {
      const chip = createTargetsChip(cat);
      const cb = chip.querySelector('input')!;
      cb.checked = enabledCatSet.has(cat);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledCatSet.add(cat); else enabledCatSet.delete(cat);
        this.prefs.enabledCatalogs = [...enabledCatSet]; savePrefs(this.prefs);
      });
      catFilters.appendChild(chip);
    }
    catRow.appendChild(catLabel);
    catRow.appendChild(catFilters);
    form.appendChild(catRow);

    // ── Include oversized / Exclude photographed ─────────────────────────────
    const oversizedRow = document.createElement('div');
    oversizedRow.className = 'targets-form-row';
    const oversizedChip = createTargetsChip(t('targets.includeOversized'), { extraClass: 'targets-oversized-chip', title: t('targets.includeOversizedTooltip') });
    const oversizedCb = oversizedChip.querySelector('input')!;
    oversizedCb.checked = this.prefs.includeOversized ?? false;
    oversizedCb.addEventListener('change', () => { this.prefs.includeOversized = oversizedCb.checked; savePrefs(this.prefs); });
    oversizedRow.appendChild(oversizedChip);

    const excludePhotographedChip = createTargetsChip(t('targets.excludePhotographed'), { extraClass: 'targets-oversized-chip', title: t('targets.excludePhotographedTooltip') });
    const excludePhotographedCb = excludePhotographedChip.querySelector('input')!;
    excludePhotographedCb.checked = this.prefs.excludePhotographed ?? false;
    excludePhotographedCb.addEventListener('change', () => { this.prefs.excludePhotographed = excludePhotographedCb.checked; savePrefs(this.prefs); });
    oversizedRow.appendChild(excludePhotographedChip);

    form.appendChild(oversizedRow);

    // ── Generate buttons ─────────────────────────────────────────────────────
    const btnRow = document.createElement('div');
    btnRow.className = 'targets-btn-row';
    this.generateBtn = document.createElement('button');
    this.generateBtn.className = 'targets-generate-btn';
    this.generateBtn.textContent = t('targets.generateBest');
    this.generateBtn.addEventListener('click', () => {
      this.runRecommendation(this.generateBtn!, this.dateInput!, 'best');
    });
    this.randomBtn = document.createElement('button');
    this.randomBtn.className = 'targets-generate-btn targets-generate-btn--random';
    this.randomBtn.textContent = t('targets.generateRandom');
    this.randomBtn.addEventListener('click', () => {
      this.runRecommendation(this.randomBtn!, this.dateInput!, 'random');
    });
    btnRow.appendChild(this.generateBtn);
    btnRow.appendChild(this.randomBtn);
    form.appendChild(btnRow);

    details.appendChild(form);
    return details;
  }

  // ─── Gear section (async, setup-based) ────────────────────────────────────

  private buildGearSection(container: HTMLElement): void {
    container.innerHTML = '';

    // ── Row: label (with info icon inside) + select + edit + delete ────────────
    const row = document.createElement('div');
    row.className = 'targets-form-row targets-gear-row';

    const label = document.createElement('label');
    label.className = 'targets-label';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = 'var(--space-2)';
    label.appendChild(document.createTextNode(t('targets.gear.setup')));

    // Info icon is inside the label so it sits flush after the label text
    const infoIcon = buildInfoButton(() => {});
    label.appendChild(infoIcon);

    const select = document.createElement('select');
    select.className = 'targets-select';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-icon';
    editBtn.innerHTML = penSvg;
    editBtn.title = t('fovOverlay.editModalTitle');
    editBtn.disabled = true;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-icon btn-icon--danger';
    deleteBtn.innerHTML = trashSvg;
    deleteBtn.title = t('photos.delete');
    deleteBtn.disabled = true;

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);
    container.appendChild(row);

    // ── "Add a setup" button on its own line (aligned with the select) ─────────
    const addSetupBtn = document.createElement('button');
    addSetupBtn.type = 'button';
    addSetupBtn.className = 'targets-add-gear-btn';
    addSetupBtn.textContent = t('fovOverlay.addSetup');
    container.appendChild(addSetupBtn);

    // ── FOV hint below ────────────────────────────────────────────────────────
    const fovHintEl = document.createElement('div');
    fovHintEl.className = 'targets-fov-hint';
    container.appendChild(fovHintEl);

    let allSetups: GearSetupData[] = [];

    const rebuildSection = () => {
      this.buildGearSection(container);
    };

    addSetupBtn.addEventListener('click', () => {
      openAddSetupModal(() => {
        getGearSetups()
          .then(setups => buildFovFrameSpecs(setups))
          .then(specs => this.skyMap.setFovFrames(specs))
          .catch(() => {});
        rebuildSection();
      }, false);
    });

    const updateGearInfo = (setup: GearSetupData | undefined) => {
      fovHintEl.textContent = '';
      infoIcon.onclick = null;
      if (!setup) return;
      Promise.all([getTelescopes(), getCameras(), getAccessories()]).then(([tels, cams, accs]) => {
        const tel = tels.find(t => t.id === setup.telescopeId);
        const effectiveCameraId = tel?.is_smart_telescope && tel.integrated_camera_id
          ? tel.integrated_camera_id
          : setup.cameraId;
        const cam = cams.find(c => c.id === effectiveCameraId);
        const acc = (tel?.is_smart_telescope || !setup.accessoryId)
          ? null
          : (accs.find(a => a.id === setup.accessoryId) ?? null);
        if (!tel || !cam) return;
        const preset = buildGearPreset(tel, cam, acc);
        fovHintEl.textContent = `${t('targets.gear.effectiveFocalLength')}: ${formatGearFovLabel(preset)}`;
        const { wDeg, hDeg } = fovDeg(preset);
        const scale = pixelScaleArcsec(preset);
        const tooltipRows: [string, string][] = [
          [t('targets.gear.telescope'), telescopeLabel(tel)],
          [t('targets.gear.camera'), cameraLabel(cam)],
          [t('targets.gear.info.resolution'), `${cam.resolution_x} × ${cam.resolution_y} px`],
        ];
        if (acc) tooltipRows.push([t('targets.gear.accessory'), accessoryLabel(acc)]);
        tooltipRows.push([t('targets.gear.effectiveFocalLength'), `${preset.focalLengthMm.toFixed(0)} mm`]);
        tooltipRows.push(['FOV', `${formatFov(wDeg, hDeg)} · ${scale.toFixed(1)}″/px`]);
        infoIcon.onclick = (e) => {
          e.stopPropagation();
          showKeyValueTooltip(infoIcon, tooltipRows);
        };
      }).catch(() => {});
    };

    getGearSetups().then(setups => {
      allSetups = setups;
      select.innerHTML = '';

      if (setups.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = t('targets.gear.noSetup');
        select.appendChild(opt);
        select.disabled = true;
        if (this.generateBtn) {
          this.generateBtn.disabled = true;
          this.generateBtn.title = t('targets.gear.noSetupTooltip');
        }
        if (this.randomBtn) {
          this.randomBtn.disabled = true;
          this.randomBtn.title = t('targets.gear.noSetupTooltip');
        }
        editBtn.disabled = true;
        deleteBtn.disabled = true;
        updateGearInfo(undefined);
        return;
      }

      select.disabled = false;
      if (this.generateBtn) { this.generateBtn.disabled = false; this.generateBtn.title = ''; }
      if (this.randomBtn) { this.randomBtn.disabled = false; this.randomBtn.title = ''; }

      for (const s of setups) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
      }

      // Restore or auto-select
      const savedId = this.prefs.setupId;
      const match = savedId ? setups.find(s => s.id === savedId) : null;
      select.value = match ? savedId! : setups[0].id;
      if (!match) {
        this.prefs.setupId = setups[0].id;
        savePrefs(this.prefs);
      }

      const selectedSetup = () => allSetups.find(s => s.id === select.value);
      editBtn.disabled = false;
      deleteBtn.disabled = false;
      updateGearInfo(selectedSetup());

      select.addEventListener('change', () => {
        this.prefs.setupId = select.value || null;
        savePrefs(this.prefs);
        updateGearInfo(selectedSetup());
        editBtn.disabled = !select.value;
        deleteBtn.disabled = !select.value;
      });

      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const setup = selectedSetup();
        if (!setup) return;
        openEditSetupModal(setup, () => {
          getGearSetups()
            .then(setups => buildFovFrameSpecs(setups))
            .then(specs => this.skyMap.setFovFrames(specs))
            .catch(() => {});
          rebuildSection();
        });
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const setup = selectedSetup();
        if (!setup) return;
        deleteGearSetupAPI(setup.id).then(() => {
          if (this.prefs.setupId === setup.id) {
            this.prefs.setupId = null;
            savePrefs(this.prefs);
          }
          getGearSetups()
            .then(setups => buildFovFrameSpecs(setups))
            .then(specs => this.skyMap.setFovFrames(specs))
            .catch(() => {});
          rebuildSection();
        }).catch(err => {
          showToast({ message: String(err?.message ?? err), type: 'error', duration: 3500 });
        });
      });
    }).catch(() => {
      select.innerHTML = '';
      const opt = document.createElement('option');
      opt.textContent = '…';
      select.appendChild(opt);
    });
  }

  // ─── Run recommendation ────────────────────────────────────────────────────

  private async runRecommendation(
    btn: HTMLButtonElement,
    dateInput: HTMLInputElement,
    mode: 'best' | 'random',
  ): Promise<void> {
    const resultsEl = document.getElementById('targets-results')!;

    const lat = this.prefs.lat ?? NaN;
    const lon = this.prefs.lon ?? NaN;
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      resultsEl.innerHTML = `<div class="targets-empty">${t('targets.location.notSet')}</div>`;
      return;
    }

    const allGenBtns = document.querySelectorAll<HTMLButtonElement>('.targets-generate-btn');
    allGenBtns.forEach(b => { b.disabled = true; });
    btn.textContent = t('targets.generating');
    const savedScroll = this.container.scrollTop;
    resultsEl.innerHTML = `<div class="targets-spinner"></div>`;

    await new Promise((r) => setTimeout(r, 10));

    try {
      const [setups, telescopes, cameras, accessories] = await Promise.all([
        getGearSetups(), getTelescopes(), getCameras(), getAccessories(),
      ]);

      const setup = setups.find(s => s.id === this.prefs.setupId);
      if (!setup) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach(b => { b.disabled = false; });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      const telescope = telescopes.find(t => t.id === setup.telescopeId);
      if (!telescope) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach(b => { b.disabled = false; });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      // For smart telescopes, use integrated camera ID
      const effectiveCameraId = telescope.is_smart_telescope && telescope.integrated_camera_id
        ? telescope.integrated_camera_id
        : setup.cameraId;

      const camera = cameras.find(c => c.id === effectiveCameraId);
      if (!camera) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach(b => { b.disabled = false; });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      const accessory = (telescope.is_smart_telescope || !setup.accessoryId)
        ? null
        : (accessories.find(a => a.id === setup.accessoryId) ?? null);

      const preset = buildGearPreset(telescope, camera, accessory);

      const dateStr = dateInput.value || todayISO();
      const dateNight = new Date(dateStr + 'T12:00:00Z');
      const dsos = getDSOs();
      const enabledTypes = new Set(this.prefs.enabledTypes ?? [...ALL_DSO_TYPES]);
      const enabledRatings = new Set(this.prefs.enabledRatings ?? [1, 2, 3, 4, 5]);
      const enabledDifficulties = new Set(this.prefs.enabledDifficulties ?? [1, 2, 3, 4, 5]);
      const enabledCatalogs = new Set(this.prefs.enabledCatalogs ?? [...DSO_CATALOGS_ALL]);
      const allConsts = getConstellationInfos();
      const enabledConstellations = (this.prefs.enabledConstellations && this.prefs.enabledConstellations.length < allConsts.length)
        ? new Set(this.prefs.enabledConstellations)
        : null;

      let photographedIds: Set<string> | null = null;
      if (this.prefs.excludePhotographed) {
        const photos = await getPhotos();
        photographedIds = new Set(photos.flatMap(p => p.dsoIds));
      }

      const filteredDSOs = filterTargetDSOs(dsos, {
        enabledTypes,
        enabledRatings,
        enabledDifficulties,
        enabledCatalogs,
        photographedIds,
        enabledConstellations,
      });
      const location: ObserverLocation = { latDeg: lat, lonDeg: lon };
      const enabledDirs = new Set(this.prefs.horizonDirs ?? ['N', 'S', 'E', 'W']);
      const dirFilterActive = enabledDirs.size < 4;

      const rawSuggestions = recommendTargets(
        filteredDSOs, preset, location, dateNight, 5000,
        {
          ignoreFovFit: this.prefs.includeOversized ?? false,
          minAltDeg: this.prefs.minAltDeg ?? 20,
          maxAltDeg: this.prefs.maxAltDeg ?? 80,
        },
      );

      let suggestions: TargetSuggestion[];
      if (!dirFilterActive) {
        suggestions = rawSuggestions;
      } else {
        const midnightUTC = dateNight.getTime() + (12 - lon / 15) * 3600 * 1000;
        suggestions = rawSuggestions.filter(s => {
          const isNorth = s.dso.dec > lat;
          if (!enabledDirs.has('N') && isNorth) return false;
          if (!enabledDirs.has('S') && !isNorth) return false;
          const isEast = s.bestTimeUtc.getTime() > midnightUTC;
          if (!enabledDirs.has('E') && isEast) return false;
          if (!enabledDirs.has('W') && !isEast) return false;
          return true;
        });
      }

      allGenBtns.forEach(b => { b.disabled = false; });
      btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');

      this.lastPool = mode === 'random' ? shuffleArray(suggestions) : suggestions;
      this.lastMode = mode;
      this.currentPage = 0;
      this.lastSuggestions = this.lastPool;
      this.lastPreset = preset;
      this.renderResults(resultsEl);
      this.container.scrollTop = savedScroll;
    } catch (err: any) {
      allGenBtns.forEach(b => { b.disabled = false; });
      btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
      resultsEl.innerHTML = `<div class="targets-empty">${err.message}</div>`;
    }
  }

  // ─── Render results ────────────────────────────────────────────────────────

  private renderResults(el: HTMLElement): void {
    el.innerHTML = '';
    if (this.lastPool.length === 0 || !this.lastPreset) {
      el.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
      return;
    }

    const sortKey  = this.prefs.sortBy ?? 'rating';
    const pageSize = this.prefs.pageSize ?? 15;
    const sorted   = sortSuggestions(this.lastPool, sortKey);
    const total    = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    this.currentPage = Math.max(0, Math.min(this.currentPage, totalPages - 1));
    const pageSlice = sorted.slice(this.currentPage * pageSize, (this.currentPage + 1) * pageSize);

    const navigate = (p: number): void => {
      this.currentPage = Math.max(0, Math.min(p, totalPages - 1));
      this.renderResults(el);
    };

    const toolbar = document.createElement('div');
    toolbar.className = 'targets-sort-bar';

    const sortLabel = document.createElement('span');
    sortLabel.className = 'targets-sort-label';
    sortLabel.textContent = t('targets.sort.label');
    const sortSelect = document.createElement('select');
    sortSelect.className = 'targets-sort-select';
    const sortOpts: [SortKey, () => string][] = [
      ['rating',     () => t('targets.sort.rating')],
      ['score',      () => t('targets.sort.score')],
      ['altitude',   () => t('targets.sort.altitude')],
      ['transit',    () => t('targets.sort.transit')],
      ['magnitude',  () => t('targets.sort.magnitude')],
      ['size',       () => t('targets.sort.size')],
      ['fov-fit',    () => t('targets.sort.fovFit')],
      ['name',       () => t('targets.sort.name')],
      ['difficulty', () => t('targets.sort.difficulty')],
    ];
    for (const [value, labelFn] of sortOpts) {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = labelFn(); opt.selected = value === sortKey;
      sortSelect.appendChild(opt);
    }
    sortSelect.addEventListener('change', () => {
      this.prefs.sortBy = sortSelect.value as SortKey;
      savePrefs(this.prefs);
      this.currentPage = 0;
      this.renderResults(el);
    });
    toolbar.appendChild(sortLabel);
    toolbar.appendChild(sortSelect);

    const pageSizeSelect = document.createElement('select');
    pageSizeSelect.className = 'targets-sort-select';
    pageSizeSelect.title = t('targets.perPage');
    for (const n of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
      const opt = document.createElement('option');
      opt.value = String(n); opt.textContent = `${n} ${t('targets.perPage')}`; opt.selected = n === pageSize;
      pageSizeSelect.appendChild(opt);
    }
    pageSizeSelect.addEventListener('change', () => {
      this.prefs.pageSize = parseInt(pageSizeSelect.value, 10);
      savePrefs(this.prefs);
      this.currentPage = 0;
      this.renderResults(el);
    });
    toolbar.appendChild(pageSizeSelect);

    const paginationEl = document.createElement('div');
    paginationEl.className = 'targets-pagination';
    const navBtn = (label: string, title: string, targetPage: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'targets-pagination-btn';
      b.textContent = label; b.title = title;
      b.addEventListener('click', () => navigate(targetPage));
      return b;
    };
    const cp = this.currentPage;
    paginationEl.appendChild(navBtn('«', t('targets.pagination.first'), 0));
    paginationEl.appendChild(navBtn('‹', t('targets.pagination.prev'), cp - 1));
    for (const p of buildPageList(cp, totalPages)) {
      if (p === null) {
        const dot = document.createElement('span');
        dot.className = 'targets-pagination-ellipsis'; dot.textContent = '…';
        paginationEl.appendChild(dot);
      } else {
        const b = document.createElement('button');
        b.className = 'targets-pagination-btn targets-pagination-btn--page' + (p === cp ? ' targets-pagination-btn--active' : '');
        b.textContent = String(p + 1);
        b.addEventListener('click', () => navigate(p));
        paginationEl.appendChild(b);
      }
    }
    paginationEl.appendChild(navBtn('›', t('targets.pagination.next'), cp + 1));
    paginationEl.appendChild(navBtn('»', t('targets.pagination.last'), totalPages - 1));
    const infoEl = document.createElement('span');
    infoEl.className = 'targets-pagination-info';
    infoEl.textContent = `${total} ${t('targets.pagination.results')}`;
    paginationEl.appendChild(infoEl);
    toolbar.appendChild(paginationEl);
    el.appendChild(toolbar);

    for (const s of pageSlice) {
      el.appendChild(this.buildTargetCard(s, this.lastPreset!));
    }
  }

  // ─── Target card ───────────────────────────────────────────────────────────

  private buildTargetCard(s: TargetSuggestion, preset: ReturnType<typeof buildGearPreset>): HTMLElement {
    const card = document.createElement('div');
    card.className = 'target-card';
    const { dso } = s;
    const recipe = recommendRecipe(dso, preset);

    const header = document.createElement('div');
    header.className = 'target-card-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'target-card-title-row';
    const titleEl = document.createElement('div');
    titleEl.className = 'target-card-title';
    const bestName = dso.displayName || dso.catalogs[0] || dso.id;
    if (dso.displayName) {
      titleEl.appendChild(Object.assign(document.createElement('span'), { textContent: dso.displayName }));
      const primaryId = dso.catalogs[0] || dso.id;
      const idSpan = document.createElement('span');
      idSpan.className = 'target-card-catalog-id';
      idSpan.textContent = ' ' + primaryId;
      titleEl.appendChild(idSpan);
    } else {
      titleEl.textContent = bestName;
    }
    const otherNames = dso.catalogs.slice(dso.displayName ? 1 : 1);
    if (otherNames.length > 0) titleEl.title = `${t('dso.alsoKnownAs')}: ${otherNames.join(' · ')}`;
    titleRow.appendChild(titleEl);
    if (dso.rating !== null) {
      const ratingEl = document.createElement('div');
      ratingEl.className = 'target-card-rating';
      ratingEl.title = t('targets.tooltips.rating');
      ratingEl.textContent = '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating);
      titleRow.appendChild(ratingEl);
    }
    header.appendChild(titleRow);

    const chipsRow = document.createElement('div');
    chipsRow.className = 'target-card-chips';
    const typeEl = document.createElement('div');
    typeEl.className = 'target-card-type';
    typeEl.textContent = dsoTypeLabel(dso.type);
    chipsRow.appendChild(typeEl);
    if (dso.constellation) {
      const constEl = document.createElement('div');
      constEl.className = 'target-card-const';
      constEl.textContent = dso.constellation.toUpperCase();
      const constInfo = getConstellationInfos().find(c => c.id === dso.constellation);
      if (constInfo) constEl.title = constInfo.name;
      chipsRow.appendChild(constEl);
    }
    header.appendChild(chipsRow);
    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'target-card-meta';
    meta.appendChild(this.metaItem(t('targets.results.maxAlt'), formatAlt(s.maxAltDeg), t('targets.tooltips.maxAlt')));
    meta.appendChild(this.metaItem(t('targets.results.bestTime'), formatTime(s.bestTimeUtc), t('targets.tooltips.bestTime')));
    if (dso.mag !== null) meta.appendChild(this.metaItem('Mag', dso.mag.toFixed(1), t('targets.tooltips.mag')));
    if (dso.majAxis) meta.appendChild(this.metaItem(t('targets.results.size'), formatArcmin(dso.majAxis), t('targets.tooltips.size')));
    card.appendChild(meta);

    const meta2 = document.createElement('div');
    meta2.className = 'target-card-meta';
    if (dso.difficulty !== null) {
      const diffEl = this.metaItem(t('targets.sort.difficulty'), '◆'.repeat(dso.difficulty) + '◇'.repeat(5 - dso.difficulty), t('targets.tooltips.difficulty'));
      diffEl.querySelector('.target-meta-value')!.className = 'target-meta-value target-card-difficulty';
      meta2.appendChild(diffEl);
    }
    meta2.appendChild(this.metaItem(t('targets.results.score'), `${Math.round(s.score * 100)}%`, t('targets.tooltips.score')));
    meta2.appendChild(this.metaItem(t('targets.results.fov'), `${Math.round(s.fovFitScore * 100)}%`, t('targets.tooltips.fov')));
    card.appendChild(meta2);

    const totalEl = document.createElement('div');
    totalEl.className = 'target-integration-total';
    totalEl.textContent = `${t('targets.results.integrationTotal')}: ${formatHours(recipe.totalHours)}`;
    card.appendChild(totalEl);

    const details = document.createElement('details');
    details.className = 'target-details';
    const summary = document.createElement('summary');
    summary.textContent = t('targets.results.filtersTitle');
    details.appendChild(summary);
    const filterList = document.createElement('div');
    filterList.className = 'target-filter-list';
    for (const f of recipe.filters) {
      const row = document.createElement('div');
      row.className = 'target-filter-row';
      const badge = createFilterBadge(f.name);
      const detail = document.createElement('span');
      detail.className = 'target-filter-detail';
      detail.textContent = `${f.count} × ${f.subSeconds}s = ${formatHours(f.hours)}`;
      row.appendChild(badge);
      row.appendChild(detail);
      filterList.appendChild(row);
    }
    details.appendChild(filterList);
    card.appendChild(details);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'target-actions-row';
    const navBtnEl = document.createElement('button');
    navBtnEl.className = 'target-nav-btn';
    navBtnEl.style.flex = '1';
    navBtnEl.textContent = t('targets.results.openOnMap');
    navBtnEl.addEventListener('click', () => { this.onNavigate(dso.ra, dso.dec, this.prefs.setupId); });
    const editBtn = document.createElement('button');
    editBtn.className = 'target-nav-btn';
    editBtn.style.flex = '1';
    editBtn.textContent = t('dso.edit');
    editBtn.addEventListener('click', () => { this.onEditDSO?.(dso); });
    actionsDiv.appendChild(navBtnEl);
    actionsDiv.appendChild(editBtn);
    card.appendChild(actionsDiv);

    return card;
  }

  private metaItem(label: string, value: string, tooltip?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'target-meta-item';
    if (tooltip) el.title = tooltip;
    const l = document.createElement('span');
    l.className = 'target-meta-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'target-meta-value';
    v.textContent = value;
    el.appendChild(l);
    el.appendChild(v);
    return el;
  }
}
