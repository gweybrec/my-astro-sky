/**
 * Targets view — "Propose targets for tonight" feature.
 * A full-screen panel with gear/location/date inputs and a ranked result grid.
 */

import { t } from './i18n';
import { getDSOs, getDSOCatalog, DSO_CATALOGS_ALL } from './dso-catalog';
import { getConstellationInfos, customLocationLabel, formatMultiplicity } from './star-catalog';
import {
  getTelescopes,
  getCameras,
  getAccessories,
  buildGearPreset,
  invalidateGearCache,
  telescopeLabel,
  cameraLabel,
  accessoryLabel,
} from './gear-catalog';
import type { TelescopeData, CameraData, AccessoryData } from './gear-catalog';
import { formatGearFovLabel, fovDeg, formatFov, computeFovTargetScale } from './gear-presets';
import { getHemisphere } from './projection';
import { buildSetupInfoRows } from './setup-info';
import { recommendTargets, scoreDso, type ObserverLocation } from './target-recommender';
import { buildMultipleStarTargets } from './multiple-stars';
import { formatPaDeg } from './frame-orientation';
import { formatRA, formatDec, formatAlt } from './format-utils';
import { attachAnchoredPanel } from './popup-utils';
import type { GearPreset } from './gear-presets';
import { recommendRecipe } from './imaging-recipe';
import {
  createCustomGear,
  deleteCustomGear,
  getPhotos,
  getGearSetups,
  type GearSetupData,
  type Plan,
  type PlanMosaic,
  type PlanSortKey,
} from './api';
import { requestSetupSwitch } from './setup-switch';
import { showKeyValueTooltip, showTextTooltip, showCustomTooltip } from './tooltip-utils';
import { showToast } from './toast';
import type { SkyMap } from './sky-map';
import type { TargetSuggestion } from './target-recommender';
import type { DSO } from './types';
import { createTargetsChip, createFilterBadge, buildIntegrationFilterField } from './chip-utils';
import {
  newObservationWindow,
  windowDurationMs,
  framesInWindow,
  windowTimeOptions,
  formatWindowDuration,
  fracToClock,
  clockToFrac,
  resolveWindowColor,
  toBandFill,
  cssColorToHex,
  MIN_WINDOW_FRAC,
} from './observation-windows';
import type { ObservationWindow } from './api';
import exportSvg from './icons/export.svg?raw';
import trashSvg from './icons/trash.svg?raw';
import penSvg from './icons/pen.svg?raw';
import mapPinSvg from './icons/map-pin.svg?raw';
import listPlusSvg from './icons/list-plus.svg?raw';
import targetSvg from './icons/target.svg?raw';
import trajectorySvg from './icons/trajectory.svg?raw';
import { buildSetupControls, buildFovFrameSpecs } from './fov-overlay';
import { pinia } from './pinia-instance';
import { usePlansStore } from './stores/plans';
import { useFovFramesStore } from './stores/fov-frames';
import { useUiStore } from './stores/ui';
import { useHorizonStore } from './stores/horizon';
import { deleteFrameWithUndo } from './frame-delete';
import { getDSOById } from './dso-catalog';
import { twilightWindow, dateToJD, moonRaDecDeg, moonPhase } from './astro-time';
import {
  maxAltDuringWindow,
  sampleAltCurve,
  sampleMoonAltCurve,
  angularSeparationDeg,
  moonDangerLevel,
  type AltSample,
} from './sky-geometry';
import { outlineFromGrid } from './mosaic';
import { sortPlanTargets, firstWindowFracByEntry } from './plan-sort';
import type { PlanPdfTarget } from './export-render';
import { downloadBlob } from './file-utils';
import { reportUnknownRendererError } from './error-reporter';
import { confirmPlanDelete, confirmPlanEntryDelete } from './photo-delete-confirm';

// ─── Persistence key ─────────────────────────────────────────────────────────

const PREFS_KEY = 'targets-prefs-v3';

type SortKey =
  | 'score'
  | 'altitude'
  | 'transit'
  | 'magnitude'
  | 'size'
  | 'fov-fit'
  | 'name'
  | 'rating'
  | 'difficulty';

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
  respectHorizon?: boolean;
  showMoon?: boolean;
  obsStartTime?: string | null;
  obsEndTime?: string | null;
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

/**
 * Tiny SVG of the Moon for one of the 8 standard phases (index 0 = new …
 * 4 = full … 7 = waning crescent). The illuminated portion is built from a
 * semicircle plus a terminator half-ellipse; waning phases mirror the waxing
 * geometry horizontally. Northern-hemisphere convention (waxing lit on the
 * right). The dark portion is left as the disk outline so it reads as the
 * unlit limb against the chart background.
 */
function moonPhaseIconSvg(phaseIndex: number): string {
  const r = 5,
    c = 6,
    size = 12;
  const f = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25][phaseIndex] ?? 0.5; // illuminated fraction
  const waning = phaseIndex >= 5;
  let lit = '';
  if (f >= 0.999) {
    lit = `<circle cx="${c}" cy="${c}" r="${r}" fill="var(--moon-lit)"/>`;
  } else if (f > 0.001) {
    const b = r * (1 - 2 * f); // terminator x-radius (signed: crescent vs gibbous)
    const innerSweep = b <= 0 ? 1 : 0;
    const d = `M${c},${c - r} A${r},${r} 0 0 1 ${c},${c + r} A${Math.abs(b).toFixed(2)},${r} 0 0 ${innerSweep} ${c},${c - r} Z`;
    lit = `<path d="${d}" fill="var(--moon-lit)"/>`;
  }
  const flip = waning ? ` transform="translate(${size},0) scale(-1,1)"` : '';
  return (
    `<svg width="14" height="14" viewBox="0 0 ${size} ${size}" class="block">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="var(--bg-card)" stroke="var(--moon-curve)" stroke-width="0.75"/>` +
    `<g${flip}>${lit}</g></svg>`
  );
}

export function sortCustomFirst<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ac = a.id.startsWith('custom-');
    const bc = b.id.startsWith('custom-');
    return ac && !bc ? -1 : !ac && bc ? 1 : 0;
  });
}

// ─── DSO type labels ──────────────────────────────────────────────────────────

const ALL_DSO_TYPES = [
  'GxS',
  'GxE',
  'GxI',
  'Gx',
  'OC',
  'GC',
  'EN',
  'RN',
  'PN',
  'SNR',
  'DN',
  'MS',
] as const;

export interface DSOFilterOptions {
  enabledTypes: Set<string>;
  enabledRatings: Set<number>;
  enabledDifficulties: Set<number>;
  enabledCatalogs: Set<string>;
  photographedIds: Set<string> | null;
  enabledConstellations: Set<string> | null;
}

export function filterTargetDSOs(dsos: DSO[], opts: DSOFilterOptions): DSO[] {
  return dsos.filter((d) => {
    if (!opts.enabledTypes.has(d.type as string)) return false;
    if (d.rating !== null && !opts.enabledRatings.has(d.rating)) return false;
    if (d.difficulty !== null && !opts.enabledDifficulties.has(d.difficulty)) return false;
    const cat = getDSOCatalog(d.id);
    if (cat !== null && !opts.enabledCatalogs.has(cat)) return false;
    if (opts.photographedIds !== null && opts.photographedIds.has(d.id)) return false;
    if (
      opts.enabledConstellations !== null &&
      d.constellation !== null &&
      !opts.enabledConstellations.has(d.constellation)
    )
      return false;
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

const DAY_START_MIN = 8 * 60; // 08:00 — start of excluded daytime range
const DAY_END_MIN = 18 * 60; // 18:00 — end of excluded daytime range

function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Snap a `HH:MM` time to the nearest 30-minute step, then push it out of
 * daytime hours (08:00–18:00, exclusive) to the nearer night boundary.
 *
 * Used only to self-heal a pre-existing persisted value (e.g. from an older
 * app version) on load — new selections always come from {@link NIGHT_TIME_OPTIONS}
 * via a custom dropdown, not a native `<input type="time">`, whose own
 * picker/step/min-max handling turned out to be unreliable across
 * interaction paths (its scroll-wheel popup ignores `step` entirely, and
 * opening it on an empty field can commit the literal current wall-clock
 * time unaligned to any step).
 */
export function snapToObservationTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let total = (((h * 60 + m) % 1440) + 1440) % 1440;
  total = (Math.round(total / 30) * 30) % 1440;
  if (total > DAY_START_MIN && total < DAY_END_MIN) {
    total = total - DAY_START_MIN <= DAY_END_MIN - total ? DAY_START_MIN : DAY_END_MIN;
  }
  return minutesToHHMM(total);
}

/** All valid observation-window times: 18:00–23:30, then 00:00–08:00, every 30 min. */
export const NIGHT_TIME_OPTIONS: string[] = [
  ...Array.from({ length: (1440 - DAY_END_MIN) / 30 }, (_, i) =>
    minutesToHHMM(DAY_END_MIN + i * 30),
  ),
  ...Array.from({ length: DAY_START_MIN / 30 + 1 }, (_, i) => minutesToHHMM(i * 30)),
];

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
    case 'altitude':
      return arr.sort((a, b) => b.maxAltDeg - a.maxAltDeg);
    case 'transit':
      return arr.sort((a, b) => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime());
    case 'magnitude':
      return arr.sort((a, b) => (a.dso.mag ?? 99) - (b.dso.mag ?? 99));
    case 'size':
      return arr.sort((a, b) => (b.dso.majAxis ?? 0) - (a.dso.majAxis ?? 0));
    case 'fov-fit':
      return arr.sort((a, b) => b.fovFitScore - a.fovFitScore);
    case 'name':
      return arr.sort((a, b) =>
        (a.dso.catalogs[0] ?? a.dso.id).localeCompare(b.dso.catalogs[0] ?? b.dso.id, undefined, {
          numeric: true,
        }),
      );
    case 'rating':
      return arr.sort((a, b) => (b.dso.rating ?? 0) - (a.dso.rating ?? 0));
    case 'difficulty':
      return arr.sort((a, b) => (b.dso.difficulty ?? 0) - (a.dso.difficulty ?? 0));
    default:
      return arr.sort((a, b) => b.score - a.score);
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
    camera: t('targets.gear.addCameraTitle'),
    accessory: t('targets.gear.addAccessoryTitle'),
  };

  const fieldsByType: Record<string, FieldDef[]> = {
    telescope: [
      {
        key: 'brand',
        label: t('targets.gear.fields.brand'),
        type: 'text',
        required: true,
        helpKey: 'brand',
        placeholder: 'e.g. Celestron',
      },
      {
        key: 'model',
        label: t('targets.gear.fields.model'),
        type: 'text',
        required: true,
        helpKey: 'model',
        placeholder: 'e.g. C8 SCT',
      },
      {
        key: 'aperture_mm',
        label: t('targets.gear.fields.apertureMm'),
        type: 'number',
        required: true,
        helpKey: 'apertureMm',
        step: '0.1',
        placeholder: 'e.g. 203',
      },
      {
        key: 'focal_length_mm',
        label: t('targets.gear.fields.focalLengthMm'),
        type: 'number',
        required: true,
        helpKey: 'focalLengthMm',
        step: '0.1',
        placeholder: 'e.g. 2032',
      },
      {
        key: 'optical_design',
        label: t('targets.gear.fields.opticalDesign'),
        type: 'text',
        required: false,
        helpKey: 'opticalDesign',
        placeholder: 'e.g. Schmidt-Cassegrain',
      },
      {
        key: 'mount_interface',
        label: t('targets.gear.fields.mountInterface'),
        type: 'text',
        required: false,
        helpKey: 'mountInterface',
        placeholder: 'e.g. M48, 2"',
      },
      {
        key: 'optical_notes',
        label: t('targets.gear.fields.opticalNotes'),
        type: 'text',
        required: false,
        helpKey: 'opticalNotes',
      },
    ],
    camera: [
      {
        key: 'brand',
        label: t('targets.gear.fields.brand'),
        type: 'text',
        required: true,
        helpKey: 'brand',
        placeholder: 'e.g. Atik',
      },
      {
        key: 'model',
        label: t('targets.gear.fields.model'),
        type: 'text',
        required: true,
        helpKey: 'model',
        placeholder: 'e.g. 314L+',
      },
      {
        key: 'color_type',
        label: t('targets.gear.fields.colorType'),
        type: 'select',
        required: true,
        helpKey: 'colorType',
        options: [
          { value: 'OSC', label: t('targets.gear.colorTypeOSC') },
          { value: 'Mono', label: t('targets.gear.colorTypeMono') },
        ],
      },
      {
        key: 'sensor_width_mm',
        label: t('targets.gear.fields.sensorWidthMm'),
        type: 'number',
        required: true,
        helpKey: 'sensorWidthMm',
        step: '0.01',
        placeholder: 'e.g. 8.98',
      },
      {
        key: 'sensor_height_mm',
        label: t('targets.gear.fields.sensorHeightMm'),
        type: 'number',
        required: true,
        helpKey: 'sensorHeightMm',
        step: '0.01',
        placeholder: 'e.g. 6.71',
      },
      {
        key: 'pixel_size_um',
        label: t('targets.gear.fields.pixelSizeUm'),
        type: 'number',
        required: true,
        helpKey: 'pixelSizeUm',
        step: '0.01',
        placeholder: 'e.g. 6.45',
      },
      {
        key: 'sensor',
        label: t('targets.gear.fields.sensor'),
        type: 'text',
        required: false,
        helpKey: 'sensor',
        placeholder: 'e.g. Sony ICX285AL',
      },
    ],
    accessory: [
      {
        key: 'brand',
        label: t('targets.gear.fields.brand'),
        type: 'text',
        required: true,
        helpKey: 'brand',
        placeholder: 'e.g. Celestron',
      },
      {
        key: 'model',
        label: t('targets.gear.fields.model'),
        type: 'text',
        required: true,
        helpKey: 'model',
        placeholder: 'e.g. Focal Reducer 0.63×',
      },
      {
        key: 'magnification_factor',
        label: t('targets.gear.fields.magnificationFactor'),
        type: 'number',
        required: true,
        helpKey: 'magnificationFactor',
        step: '0.01',
        placeholder: 'e.g. 0.63',
      },
      {
        key: 'type',
        label: t('targets.gear.fields.accessoryType'),
        type: 'text',
        required: false,
        helpKey: 'accessoryType',
        placeholder: 'e.g. focal reducer',
      },
      {
        key: 'notes',
        label: t('targets.gear.fields.accessoryNotes'),
        type: 'text',
        required: false,
        helpKey: 'accessoryNotes',
      },
      {
        key: 'thread_input',
        label: t('targets.gear.fields.threadInput'),
        type: 'text',
        required: false,
        helpKey: 'threadInput',
        placeholder: 'e.g. M48',
      },
      {
        key: 'thread_output',
        label: t('targets.gear.fields.threadOutput'),
        type: 'text',
        required: false,
        helpKey: 'threadOutput',
        placeholder: 'e.g. M42',
      },
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
      helpIcon.addEventListener('click', (e) => {
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
    camera: t('targets.gear.manageCameraTitle'),
    accessory: t('targets.gear.manageAccessoryTitle'),
  };
  const addLabels: Record<string, string> = {
    telescope: t('targets.gear.addTelescope'),
    camera: t('targets.gear.addCamera'),
    accessory: t('targets.gear.addAccessory'),
  };
  const selectedCountKeys: Record<string, string> = {
    telescope: 'targets.gear.telescopesSelected',
    camera: 'targets.gear.camerasSelected',
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
    const total = allGear.filter((g) => !pendingDeletes.has(g.id)).length;
    const selected = allGear.filter(
      (g) => !currentHidden.has(g.id) && !pendingDeletes.has(g.id),
    ).length;
    const base = t(selectedCountKeys[gearType], {
      selected: String(selected),
      total: String(total),
    });
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
            deleteCustomGear(gear.id)
              .then(() => invalidateGearCache(gearType))
              .catch(() => {});
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
      const getList =
        gearType === 'telescope'
          ? getTelescopes
          : gearType === 'camera'
            ? getCameras
            : getAccessories;
      const labelFn =
        gearType === 'telescope'
          ? telescopeLabel
          : gearType === 'camera'
            ? cameraLabel
            : accessoryLabel;
      getList().then((newAll) => {
        const sorted = sortCustomFirst(newAll as Array<{ id: string }>);
        const gearWithLabels = sorted.map((g) => ({
          id: g.id,
          label: (labelFn as (g: any) => string)(g),
        }));
        openManageGearModal(gearType, gearWithLabels, currentHidden, onClose);
      });
    });
  });

  footer.appendChild(addBtn);

  // ── Close handler ─────────────────────────────────────────────────────────────
  closeBtn.addEventListener('click', () => {
    for (const [id, item] of pendingDeletes) {
      item.dismissFn();
      deleteCustomGear(id)
        .then(() => invalidateGearCache(gearType))
        .catch(() => {});
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
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
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

  Promise.all([getTelescopes(), getCameras(), getAccessories()])
    .then(([telescopes, cameras, accessories]) => {
      container.innerHTML = '';

      const hiddenSet = new Set(prefs.hiddenGearIds ?? []);

      const fovHintEl = document.createElement('div');
      fovHintEl.className = 'targets-fov-hint';

      const updateFovHint = (
        tel: TelescopeData | undefined,
        cam: CameraData | undefined,
        acc: AccessoryData | null,
      ): void => {
        if (!tel || !cam) {
          fovHintEl.textContent = '';
          return;
        }
        const preset = buildGearPreset(tel, cam, acc);
        fovHintEl.textContent = `${t('targets.gear.effectiveFocalLength')}: ${formatGearFovLabel(preset)}`;
      };

      // ── Telescope row ────────────────────────────────────────────────────
      const visibleTelescopes = sortCustomFirst(telescopes).filter((tel) => !hiddenSet.has(tel.id));
      if (!visibleTelescopes.find((tel) => tel.id === prefs.telescopeId)) {
        callbacks.onPrefsChange({ telescopeId: visibleTelescopes[0]?.id ?? '' });
      }

      const { row: telRow, select: telSelect } = buildGearRow(
        t('targets.gear.telescope'),
        visibleTelescopes.map((tel) => ({ value: tel.id, label: telescopeLabel(tel) })),
        prefs.telescopeId,
      );
      const telInfoBtn = buildInfoButton(() => {
        const tel = visibleTelescopes.find((t) => t.id === telSelect.value);
        if (!tel) return;
        showKeyValueTooltip(telInfoBtn, [
          [t('targets.gear.info.brand'), tel.brand],
          [t('targets.gear.info.model'), tel.model],
          [t('targets.gear.info.opticalDesign'), tel.optical_design],
          [t('targets.gear.info.mountInterface'), tel.mount_interface],
          [t('targets.gear.info.opticalNotes'), tel.optical_notes],
          [
            t('targets.gear.info.recommendedUse'),
            tel.recommended_use?.map((u) => t(`targets.gear.info.useLabels.${u}`)).join(', ') ??
              null,
          ],
        ]);
      });
      telRow.appendChild(telInfoBtn);
      container.appendChild(telRow);

      const telManageBtn = buildAddButton(t('targets.gear.manageTelescope'), () => {
        const all = sortCustomFirst(telescopes).map((tel) => ({
          id: tel.id,
          label: telescopeLabel(tel),
        }));
        openManageGearModal(
          'telescope',
          all,
          new Set(prefs.hiddenGearIds ?? []),
          (newHidden, deleted) => {
            if (deleted.size > 0) invalidateGearCache('telescope');
            const visible = sortCustomFirst(telescopes).filter(
              (t) => !newHidden.has(t.id) && !deleted.has(t.id),
            );
            const newTelId = visible.find((t) => t.id === prefs.telescopeId)
              ? prefs.telescopeId
              : (visible[0]?.id ?? '');
            callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], telescopeId: newTelId });
            callbacks.onRebuild(container);
          },
        );
      });
      container.appendChild(telManageBtn);

      // ── Camera row ───────────────────────────────────────────────────────
      const currentTel = visibleTelescopes.find((t) => t.id === prefs.telescopeId);
      const isSmart = currentTel?.is_smart_telescope ?? false;

      const visibleCameras = sortCustomFirst(cameras).filter((cam) => !hiddenSet.has(cam.id));
      if (prefs.cameraId && !visibleCameras.find((c) => c.id === prefs.cameraId)) {
        callbacks.onPrefsChange({ cameraId: visibleCameras[0]?.id ?? null });
      }

      // Determine camera ID: for smart telescopes, use integrated camera
      let initialCamId = prefs.cameraId;
      if (isSmart && currentTel?.integrated_camera_id) {
        initialCamId = currentTel.integrated_camera_id;
      }

      const { row: camRow, select: camSelect } = buildGearRow(
        t('targets.gear.camera'),
        visibleCameras.map((cam) => ({ value: cam.id, label: cameraLabel(cam) })),
        initialCamId ?? visibleCameras[0]?.id ?? '',
        isSmart ? t('targets.gear.smartTelescopeLocked') : undefined,
      );
      const camInfoBtn = buildInfoButton(() => {
        const cam = visibleCameras.find((c) => c.id === camSelect.value);
        if (!cam) return;
        showKeyValueTooltip(camInfoBtn, [
          [t('targets.gear.info.brand'), cam.brand],
          [t('targets.gear.info.model'), cam.model],
          [t('targets.gear.info.sensor'), cam.sensor],
          [
            t('targets.gear.info.sensorSize'),
            `${cam.sensor_width_mm} × ${cam.sensor_height_mm} mm`,
          ],
          [t('targets.gear.info.resolution'), `${cam.resolution_x} × ${cam.resolution_y} px`],
          [
            t('targets.gear.info.recommendedUse'),
            cam.recommended_use?.map((u) => t(`targets.gear.info.useLabels.${u}`)).join(', ') ??
              null,
          ],
        ]);
      });
      camRow.appendChild(camInfoBtn);
      container.appendChild(camRow);

      const camManageBtn = buildAddButton(t('targets.gear.manageCamera'), () => {
        const all = sortCustomFirst(cameras).map((cam) => ({
          id: cam.id,
          label: cameraLabel(cam),
        }));
        openManageGearModal(
          'camera',
          all,
          new Set(prefs.hiddenGearIds ?? []),
          (newHidden, deleted) => {
            if (deleted.size > 0) invalidateGearCache('camera');
            const visible = sortCustomFirst(cameras).filter(
              (c) => !newHidden.has(c.id) && !deleted.has(c.id),
            );
            const newCamId =
              prefs.cameraId && visible.find((c) => c.id === prefs.cameraId)
                ? prefs.cameraId
                : (visible[0]?.id ?? null);
            callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], cameraId: newCamId });
            callbacks.onRebuild(container);
          },
        );
      });
      if (isSmart) camManageBtn.classList.add('hidden');
      container.appendChild(camManageBtn);

      // ── Accessory row ────────────────────────────────────────────────────
      const visibleAccessories = sortCustomFirst(accessories).filter(
        (acc) => !hiddenSet.has(acc.id),
      );
      if (prefs.accessoryId && !visibleAccessories.find((a) => a.id === prefs.accessoryId)) {
        callbacks.onPrefsChange({ accessoryId: null });
      }

      const accOptions = [
        { value: '', label: t('targets.gear.noAccessory') },
        ...visibleAccessories.map((acc) => ({ value: acc.id, label: accessoryLabel(acc) })),
      ];
      const { row: accRow, select: accSelect } = buildGearRow(
        t('targets.gear.accessory'),
        accOptions,
        isSmart ? '' : (prefs.accessoryId ?? ''),
        isSmart ? t('targets.gear.smartTelescopeLocked') : undefined,
      );
      const accInfoBtn = buildInfoButton(() => {
        const acc = visibleAccessories.find((a) => a.id === accSelect.value);
        if (!acc) {
          showTextTooltip(accInfoBtn, t('targets.gear.noAccessorySelected'));
          return;
        }
        showKeyValueTooltip(accInfoBtn, [
          [t('targets.gear.info.brand'), acc.brand],
          [t('targets.gear.info.model'), acc.model],
          [t('targets.gear.info.accessoryNotes'), acc.notes],
          [t('targets.gear.info.threadInput'), acc.thread_input],
          [t('targets.gear.info.threadOutput'), acc.thread_output],
        ]);
      });
      accRow.appendChild(accInfoBtn);
      container.appendChild(accRow);

      const accManageBtn = buildAddButton(t('targets.gear.manageAccessory'), () => {
        const all = sortCustomFirst(accessories).map((acc) => ({
          id: acc.id,
          label: accessoryLabel(acc),
        }));
        openManageGearModal(
          'accessory',
          all,
          new Set(prefs.hiddenGearIds ?? []),
          (newHidden, deleted) => {
            if (deleted.size > 0) invalidateGearCache('accessory');
            const visible = sortCustomFirst(accessories).filter(
              (a) => !newHidden.has(a.id) && !deleted.has(a.id),
            );
            const newAccId =
              prefs.accessoryId && visible.find((a) => a.id === prefs.accessoryId)
                ? prefs.accessoryId
                : null;
            callbacks.onPrefsChange({ hiddenGearIds: [...newHidden], accessoryId: newAccId });
            callbacks.onRebuild(container);
          },
        );
      });
      if (isSmart) accManageBtn.classList.add('hidden');
      container.appendChild(accManageBtn);

      // ── FOV hint ─────────────────────────────────────────────────────────
      container.appendChild(fovHintEl);

      // Initial hint
      const currentCam = visibleCameras.find(
        (c) =>
          c.id ===
          (isSmart && currentTel?.integrated_camera_id
            ? currentTel.integrated_camera_id
            : (prefs.cameraId ?? '')),
      );
      const currentAcc = isSmart
        ? null
        : (visibleAccessories.find((a) => a.id === (prefs.accessoryId ?? '')) ?? null);
      updateFovHint(currentTel, currentCam, currentAcc);

      // ── Change handlers ──────────────────────────────────────────────────
      telSelect.addEventListener('change', () => {
        callbacks.onPrefsChange({ telescopeId: telSelect.value });
        callbacks.onRebuild(container);
      });

      camSelect.addEventListener('change', () => {
        if (!isSmart) {
          callbacks.onPrefsChange({ cameraId: camSelect.value });
          const tel = visibleTelescopes.find((t) => t.id === telSelect.value);
          const cam = visibleCameras.find((c) => c.id === camSelect.value);
          const acc = accSelect.value
            ? (visibleAccessories.find((a) => a.id === accSelect.value) ?? null)
            : null;
          updateFovHint(tel, cam, acc);
        }
      });

      accSelect.addEventListener('change', () => {
        if (!isSmart) {
          callbacks.onPrefsChange({ accessoryId: accSelect.value || null });
          const tel = visibleTelescopes.find((t) => t.id === telSelect.value);
          const cam = visibleCameras.find((c) => c.id === camSelect.value);
          const acc = accSelect.value
            ? (visibleAccessories.find((a) => a.id === accSelect.value) ?? null)
            : null;
          updateFovHint(tel, cam, acc);
        }
      });
    })
    .catch(() => {
      container.innerHTML =
        '<div class="targets-form-row" style="color:#e55">Failed to load gear catalog</div>';
    });
}

// ─── TargetsView class ────────────────────────────────────────────────────────

/** A plan target resolved + scored for the current observer/night. */
interface PlanTargetInfo {
  entryId: string;
  dso: DSO;
  maxAltDeg: number;
  bestTimeUtc: Date;
  curve: AltSample[];
  /** Moon–target angular separation (°) at the imaging time, or null when the moon overlay is off / moon never rises. */
  moonSepDeg: number | null;
}

/**
 * Moon overlay for a plan render — identical for every row of a plan (same
 * night + location), so it is computed once and threaded into each chart.
 * Null when the toggle is off or the Moon never clears the horizon.
 */
interface MoonOverlay {
  curve: AltSample[];
  phaseIndex: number;
  illum: number;
}

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
  private lastLocation: ObserverLocation | null = null;
  private lastDateNight: Date | null = null;
  private generateBtn: HTMLButtonElement | null = null;
  private randomBtn: HTMLButtonElement | null = null;
  private dateInput: HTMLInputElement | null = null;

  /** Recommend surface (gear/location/date/filters + results), built once and
   * reparented into the "Find targets" overlay on first mount. Persists across
   * open/close so filters and results survive being hidden. */
  private recommendRoot: HTMLElement | null = null;
  private plansStore = usePlansStore(pinia);
  private fovFramesStore = useFovFramesStore(pinia);
  private uiStore = useUiStore(pinia);
  /** Live per-entry position-angle value spans, keyed by entryId (rebuilt each render). */
  private paSpans = new Map<string, HTMLElement>();
  private planBadgeEl: HTMLElement | null = null;
  private planPickerEl: HTMLElement | null = null;
  private planPickerOutside: ((ev: MouseEvent) => void) | null = null;
  private planPickerEsc: ((ev: KeyboardEvent) => void) | null = null;
  private planPickerCleanup: (() => void) | null = null;

  constructor(
    skyMap: SkyMap,
    onNavigate: (ra: number, dec: number, setupId: string | null) => void,
  ) {
    this.skyMap = skyMap;
    this.onNavigate = onNavigate;
    this.prefs = loadPrefs();
    this.container = document.getElementById('plans-container')!;
    this.render();
    // Keep plan-row PA readouts in sync when a frame is rotated on the map
    // (frame rotation writes paDeg back through the plans store).
    this.plansStore.$subscribe(() => this.refreshPaReadouts());
    // Load plans in the background; refresh the plans view when ready.
    this.plansStore.ensureLoaded().then(() => this.render());
  }

  /** Update the live position-angle spans from current plan-entry values. */
  private refreshPaReadouts(): void {
    if (this.paSpans.size === 0) return;
    for (const [entryId, span] of this.paSpans) {
      let paDeg: number | null = null;
      for (const p of this.plansStore.plans) {
        const e = p.entries.find((en) => en.id === entryId);
        if (e) {
          paDeg = e.paDeg;
          break;
        }
      }
      span.textContent = paDeg != null ? formatPaDeg(paDeg) : '—';
    }
  }

  show(): void {
    this.container.style.display = 'flex';
    // A focus request (jump from the FOV popup) must survive the async reload
    // re-render below, which would otherwise rebuild the plan collapsed: the first
    // render consumes (and clears) the signal, so re-apply it for the second.
    const focusPlanId = this.uiStore.pendingPlanFocusId;
    this.render();
    this.plansStore.ensureLoaded().then(() => {
      if (focusPlanId) this.uiStore.pendingPlanFocusId = focusPlanId;
      this.render();
    });
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  /**
   * Lazily build the "Find targets" recommend surface (gear/location/date/
   * filters + results) and return its root element. Built exactly once — the
   * caller (TargetsOverlay.vue) mounts this element into the overlay on first
   * open and never rebuilds it, so all filter/result state survives repeated
   * open/close within the session.
   */
  getRecommendElement(): HTMLElement {
    if (!this.recommendRoot) {
      const root = document.createElement('div');
      root.className = 'targets-recommend-root';
      root.appendChild(this.buildForm());
      const resultsEl = document.createElement('div');
      resultsEl.className = 'targets-results';
      resultsEl.id = 'targets-results';
      root.appendChild(resultsEl);
      this.recommendRoot = root;
    }
    return this.recommendRoot;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    this.container.innerHTML = '';
    this.paSpans.clear();
    this.container.className = 'targets-view';
    const inner = document.createElement('div');
    inner.className = 'targets-inner';
    this.container.appendChild(inner);
    inner.appendChild(this.buildPlansView());
  }

  private updatePlanBadge(): void {
    if (this.planBadgeEl) {
      const n = this.plansStore.planCount;
      this.planBadgeEl.textContent = n > 0 ? ` (${n})` : '';
    }
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  /**
   * Build the shared "Observing location" widget ("Use my location" button +
   * Lat/Lon inputs + decimal/DMS toggle). Used both by the recommend form (bound
   * to the global prefs) and by each plan section (bound to the plan's own
   * coords). The decimal/DMS format is a global display preference; only the
   * coordinate values flow through the provided getters/`onChange` callback.
   */
  private buildLocationWidget(opts: {
    getLat: () => number | null;
    getLon: () => number | null;
    onChange: (lat: number | null, lon: number | null) => void;
  }): HTMLElement {
    const { getLat, getLon, onChange } = opts;

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
      if (s >= 60) {
        s = 0;
        m++;
      }
      if (m >= 60) {
        m = 0;
        d++;
      }
      return [d * sign, m, s];
    };
    const dmsToDecimal = (d: number, m: number, s: number): number => {
      const sign = d < 0 || Object.is(d, -0) ? -1 : 1;
      return sign * (Math.abs(d) + m / 60 + s / 3600);
    };

    const geoLocate = (onDone: () => void): void => {
      locBtn.textContent = t('targets.location.locating');
      locBtn.disabled = true;
      const onSuccess = (latitude: number, longitude: number) => {
        onChange(Math.round(latitude * 100) / 100, Math.round(longitude * 100) / 100);
        onDone();
        locBtn.textContent = t('targets.location.useBrowser');
        locBtn.disabled = false;
      };
      const onError = () => {
        locBtn.textContent = t('targets.location.error');
        locBtn.disabled = false;
      };
      if ((window as any).electronAPI) {
        (window as any).electronAPI
          .getLocation()
          .then((c: { latitude: number; longitude: number }) => onSuccess(c.latitude, c.longitude))
          .catch(onError);
      } else {
        navigator.geolocation.getCurrentPosition(
          (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
          onError,
        );
      }
    };

    const buildCoordEntry = (fmt: 'decimal' | 'dms'): void => {
      coordEntry.innerHTML = '';
      fmtToggle.textContent = fmt === 'decimal' ? 'DMS (° ′ ″)' : 'Decimal';
      fmtToggle.title =
        fmt === 'decimal' ? 'Switch to degrees/arcminutes/arcseconds' : 'Switch to decimal degrees';
      if (fmt === 'decimal') {
        const latIn = document.createElement('input');
        latIn.type = 'number';
        latIn.className = 'targets-coord-input';
        latIn.placeholder = t('targets.location.lat');
        latIn.step = '0.01';
        latIn.min = '-90';
        latIn.max = '90';
        if (getLat() !== null) latIn.value = String(getLat());
        const lonIn = document.createElement('input');
        lonIn.type = 'number';
        lonIn.className = 'targets-coord-input';
        lonIn.placeholder = t('targets.location.lon');
        lonIn.step = '0.01';
        lonIn.min = '-180';
        lonIn.max = '180';
        if (getLon() !== null) lonIn.value = String(getLon());
        const sync = (): void => {
          const la = isNaN(parseFloat(latIn.value)) ? null : parseFloat(latIn.value);
          const lo = isNaN(parseFloat(lonIn.value)) ? null : parseFloat(lonIn.value);
          onChange(la, lo);
        };
        latIn.addEventListener('change', sync);
        lonIn.addEventListener('change', sync);
        locBtn.onclick = () =>
          geoLocate(() => {
            if (getLat() !== null) latIn.value = String(getLat());
            if (getLon() !== null) lonIn.value = String(getLon());
          });
        const makeDecimalGroup = (label: string, input: HTMLInputElement): HTMLElement => {
          const wrap = document.createElement('div');
          wrap.className = 'targets-dms-group';
          const lbl = document.createElement('span');
          lbl.className = 'targets-dms-label';
          lbl.textContent = label;
          wrap.appendChild(lbl);
          wrap.appendChild(input);
          return wrap;
        };
        coordEntry.appendChild(makeDecimalGroup('Lat', latIn));
        coordEntry.appendChild(makeDecimalGroup('Lon', lonIn));
      } else {
        const makeDMSGroup = (isLat: boolean): { el: HTMLElement; getVal: () => number | null } => {
          const initial = isLat ? getLat() : getLon();
          let dV = 0,
            mV = 0,
            sV = 0;
          if (initial !== null) [dV, mV, sV] = decimalToDMS(initial);
          const wrap = document.createElement('div');
          wrap.className = 'targets-dms-group';
          const lbl = document.createElement('span');
          lbl.className = 'targets-dms-label';
          lbl.textContent = isLat ? 'Lat' : 'Lon';
          const dIn = document.createElement('input');
          dIn.type = 'number';
          dIn.className = 'targets-dms-input';
          dIn.min = isLat ? '-90' : '-180';
          dIn.max = isLat ? '90' : '180';
          dIn.step = '1';
          if (initial !== null) dIn.value = String(dV);
          const sep1 = document.createElement('span');
          sep1.className = 'targets-dms-sep';
          sep1.textContent = '°';
          const mIn = document.createElement('input');
          mIn.type = 'number';
          mIn.className = 'targets-dms-input targets-dms-sub';
          mIn.min = '0';
          mIn.max = '59';
          mIn.step = '1';
          mIn.placeholder = '0';
          if (initial !== null) mIn.value = String(mV);
          const sep2 = document.createElement('span');
          sep2.className = 'targets-dms-sep';
          sep2.textContent = "'";
          const sIn = document.createElement('input');
          sIn.type = 'number';
          sIn.className = 'targets-dms-input targets-dms-sub';
          sIn.min = '0';
          sIn.max = '59';
          sIn.step = '1';
          sIn.placeholder = '0';
          if (initial !== null) sIn.value = String(sV);
          const sep3 = document.createElement('span');
          sep3.className = 'targets-dms-sep';
          sep3.textContent = '″';
          wrap.append(lbl, dIn, sep1, mIn, sep2, sIn, sep3);
          const getVal = (): number | null => {
            const d = parseFloat(dIn.value);
            const m = parseFloat(mIn.value) || 0;
            const s = parseFloat(sIn.value) || 0;
            if (isNaN(d)) return null;
            return dmsToDecimal(d, m, s);
          };
          return { el: wrap, getVal };
        };
        const latGroup = makeDMSGroup(true);
        const lonGroup = makeDMSGroup(false);
        const sync = (): void => {
          onChange(latGroup.getVal(), lonGroup.getVal());
        };
        latGroup.el.querySelectorAll('input').forEach((i) => i.addEventListener('change', sync));
        lonGroup.el.querySelectorAll('input').forEach((i) => i.addEventListener('change', sync));
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
    return locControls;
  }

  private buildForm(): HTMLElement {
    // One "search settings" area (old layout + label) holding everything — setup,
    // location, date and all filters — laid out in two columns:
    //   left  = observing context + what to look for (setup, location, date,
    //           object types, constellations)
    //   right = filter refinements (sky direction, altitude, rating, difficulty,
    //           catalogue, exclusions)
    // Primary actions sit on a full-width row at the bottom.
    const details = document.createElement('details');
    details.className = 'targets-form-details';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'targets-form-summary';
    summary.textContent = t('targets.formTitle');
    details.appendChild(summary);

    const form = document.createElement('div');
    form.className = 'targets-form';
    details.appendChild(form);

    const filterCols = document.createElement('div');
    filterCols.className = 'grid grid-cols-2 gap-x-10 gap-y-6 items-start';
    const filterColL = document.createElement('div');
    filterColL.className = 'flex flex-col gap-6 min-w-0';
    const filterColR = document.createElement('div');
    filterColR.className = 'flex flex-col gap-6 min-w-0';
    filterCols.appendChild(filterColL);
    filterCols.appendChild(filterColR);
    form.appendChild(filterCols);

    // Filter change-handlers call this; the section title is static, so it's a
    // no-op kept for call-site compatibility.
    const updateFiltersSummary = (): void => {};

    // Label-left form row helper (matches the filter rows).
    const formRow = (labelText: string, control: HTMLElement): HTMLElement => {
      const rowEl = document.createElement('div');
      rowEl.className = 'targets-form-row';
      const lbl = document.createElement('div');
      lbl.className = 'targets-label';
      lbl.textContent = labelText;
      rowEl.appendChild(lbl);
      rowEl.appendChild(control);
      return rowEl;
    };

    // ── Setup (gear) — the FOV summary hint renders directly beneath it. ──
    const gearField = document.createElement('div');
    this.buildGearSection(gearField);
    filterColL.appendChild(gearField);

    // ── Location ──
    const locControl = document.createElement('div');
    locControl.appendChild(
      this.buildLocationWidget({
        getLat: () => this.prefs.lat,
        getLon: () => this.prefs.lon,
        onChange: (la, lo) => {
          this.prefs.lat = la;
          this.prefs.lon = lo;
          savePrefs(this.prefs);
        },
      }),
    );
    filterColL.appendChild(formRow(t('targets.location.label'), locControl));

    // ── Date ──
    this.dateInput = document.createElement('input');
    const dateInput = this.dateInput;
    dateInput.type = 'date';
    dateInput.className = 'targets-coord-input !min-w-0 !max-w-none !flex-none w-auto';
    dateInput.value = this.prefs.lastDateISO ?? todayISO();
    dateInput.addEventListener('change', () => {
      this.prefs.lastDateISO = dateInput.value;
      savePrefs(this.prefs);
    });
    filterColL.appendChild(formRow(t('targets.date.label'), dateInput));

    // ── Observation time window ──────────────────────────────────────────────
    const timeWindowRow = document.createElement('div');
    timeWindowRow.className = 'targets-form-row';
    const timeWindowLabel = document.createElement('div');
    timeWindowLabel.className = 'targets-label';
    timeWindowLabel.textContent = t('targets.timeWindowLabel');
    timeWindowLabel.title = t('targets.timeWindowTooltip') ?? '';

    const timeWindowEntry = document.createElement('div');
    timeWindowEntry.className = 'targets-coord-entry';

    // A labelled version of the shared time-picker (see buildTimeDropdown): the
    // global observation window offers the full night grid (NIGHT_TIME_OPTIONS)
    // with a "not set" clear entry.
    const makeTimeDropdown = (
      labelKey: string,
      defaultVal: string,
      onChange: (value: string) => void,
    ): void => {
      const group = document.createElement('div');
      group.className = 'targets-dms-group';

      const lbl = document.createElement('span');
      lbl.className = 'targets-dms-label';
      lbl.textContent = t(`targets.${labelKey}`);

      // Self-heal a value from before this dropdown existed (e.g. a stray
      // unaligned/daytime value a native <input type="time"> once allowed).
      const initial = defaultVal ? snapToObservationTime(defaultVal) : '';
      if (initial && initial !== defaultVal) onChange(initial);

      const dd = this.buildTimeDropdown({
        value: initial,
        options: NIGHT_TIME_OPTIONS,
        ariaLabel: t(`targets.${labelKey}`),
        includeClear: true,
        clearLabel: t('targets.timeWindowNotSet'),
        onSelect: onChange,
      });

      group.appendChild(lbl);
      group.appendChild(dd.el);
      timeWindowEntry.appendChild(group);
    };

    makeTimeDropdown('timeWindowStart', this.prefs.obsStartTime ?? '', (value) => {
      this.prefs.obsStartTime = value || null;
      savePrefs(this.prefs);
    });
    makeTimeDropdown('timeWindowEnd', this.prefs.obsEndTime ?? '', (value) => {
      this.prefs.obsEndTime = value || null;
      savePrefs(this.prefs);
    });

    timeWindowRow.appendChild(timeWindowLabel);
    timeWindowRow.appendChild(timeWindowEntry);
    filterColL.appendChild(timeWindowRow);

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
        if (cb.checked) enabledTypeSet.add(type);
        else enabledTypeSet.delete(type);
        this.prefs.enabledTypes = [...enabledTypeSet];
        savePrefs(this.prefs);
        updateFiltersSummary();
      });
      typeFilters.appendChild(chip);
    }
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeFilters);
    filterColL.appendChild(typeRow);

    // ── Constellation filter ─────────────────────────────────────────────────
    // Deduplicate by IAU id (Serpens appears twice in the data as Caput + Cauda)
    const seen = new Set<string>();
    const allConstInfos = getConstellationInfos()
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
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
      const selectedSet = new Set<string>(
        this.prefs.enabledConstellations ?? allConstInfos.map((c) => c.id),
      );
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
        this.prefs.enabledConstellations =
          selectedSet.size === totalConsts ? undefined : [...selectedSet];
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
        const n = chipCbs.filter((cb) => cb.checked).length;
        selectAllCb.indeterminate = n > 0 && n < totalConsts;
        selectAllCb.checked = n === totalConsts;
      };
      selectAllCb.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        chipCbs.forEach((cb) => {
          cb.checked = checked;
        });
        allConstInfos.forEach((c) => {
          if (checked) selectedSet.add(c.id);
          else selectedSet.delete(c.id);
        });
      });
      for (const c of allConstInfos) {
        const chip = createTargetsChip(c.displayName);
        const cb = chip.querySelector('input') as HTMLInputElement;
        cb.value = c.id;
        cb.checked = selectedSet.has(c.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSet.add(c.id);
          else selectedSet.delete(c.id);
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
    filterColR.appendChild(constRow);

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
      ['N', 'north', '↑'],
      ['S', 'south', '↓'],
      ['E', 'east', '→'],
      ['W', 'west', '←'],
    ];
    for (const [key, i18nKey, arrow] of DIR_DEFS) {
      const chip = createTargetsChip(`${arrow} ${t(`targets.horizon.${i18nKey}`)}`, {
        title: t(`targets.horizon.${i18nKey}Tooltip`) ?? key,
      });
      const cb = chip.querySelector('input')!;
      cb.checked = enabledDirSet.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) enabledDirSet.add(key);
        else enabledDirSet.delete(key);
        this.prefs.horizonDirs = [...enabledDirSet];
        savePrefs(this.prefs);
      });
      compassEl.appendChild(chip);
    }
    horizonRow.appendChild(horizonLabel);
    horizonRow.appendChild(compassEl);
    filterColR.appendChild(horizonRow);

    // ── Altitude range filter ─────────────────────────────────────────────────
    const altRow = document.createElement('div');
    altRow.className = 'targets-form-row';
    const altLabel = document.createElement('div');
    altLabel.className = 'targets-label';
    altLabel.textContent = t('targets.altRangeLabel');
    altLabel.title = t('targets.altRangeTooltip') ?? '';

    const altEntry = document.createElement('div');
    altEntry.className = 'targets-coord-entry';

    const makeAltGroup = (
      labelKey: string,
      defaultVal: number,
      min: number,
      max: number,
    ): HTMLInputElement => {
      const group = document.createElement('div');
      group.className = 'targets-dms-group';
      const lbl = document.createElement('span');
      lbl.className = 'targets-dms-label';
      lbl.textContent = t(`targets.${labelKey}`);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'targets-dms-input';
      inp.setAttribute('aria-label', t(`targets.${labelKey}`) + ' °');
      inp.min = String(min);
      inp.max = String(max);
      inp.step = '1';
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
      if (!isNaN(v)) {
        this.prefs.minAltDeg = v;
        savePrefs(this.prefs);
        updateFiltersSummary();
      }
    });
    maxAltInput.addEventListener('change', () => {
      const v = parseInt(maxAltInput.value, 10);
      if (!isNaN(v)) {
        this.prefs.maxAltDeg = v;
        savePrefs(this.prefs);
        updateFiltersSummary();
      }
    });

    altRow.appendChild(altLabel);
    altRow.appendChild(altEntry);
    filterColR.appendChild(altRow);

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
        if (cb.checked) enabledRatingSet.add(r);
        else enabledRatingSet.delete(r);
        this.prefs.enabledRatings = [...enabledRatingSet];
        savePrefs(this.prefs);
        updateFiltersSummary();
      });
      ratingFilters.appendChild(chip);
    }
    ratingRow.appendChild(ratingLabel);
    ratingRow.appendChild(ratingFilters);
    filterColR.appendChild(ratingRow);

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
        if (cb.checked) enabledDiffSet.add(d);
        else enabledDiffSet.delete(d);
        this.prefs.enabledDifficulties = [...enabledDiffSet];
        savePrefs(this.prefs);
      });
      diffFilters.appendChild(chip);
    }
    diffRow.appendChild(diffLabel);
    diffRow.appendChild(diffFilters);
    filterColR.appendChild(diffRow);

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
        if (cb.checked) enabledCatSet.add(cat);
        else enabledCatSet.delete(cat);
        this.prefs.enabledCatalogs = [...enabledCatSet];
        savePrefs(this.prefs);
        updateFiltersSummary();
      });
      catFilters.appendChild(chip);
    }
    catRow.appendChild(catLabel);
    catRow.appendChild(catFilters);
    filterColR.appendChild(catRow);

    // ── Include oversized / Exclude photographed ─────────────────────────────
    const oversizedRow = document.createElement('div');
    oversizedRow.className = 'targets-form-row';
    const oversizedChip = createTargetsChip(t('targets.includeOversized'), {
      extraClass: 'targets-oversized-chip',
      title: t('targets.includeOversizedTooltip'),
    });
    const oversizedCb = oversizedChip.querySelector('input')!;
    oversizedCb.checked = this.prefs.includeOversized ?? false;
    oversizedCb.addEventListener('change', () => {
      this.prefs.includeOversized = oversizedCb.checked;
      savePrefs(this.prefs);
    });
    oversizedRow.appendChild(oversizedChip);

    const excludePhotographedChip = createTargetsChip(t('targets.excludePhotographed'), {
      extraClass: 'targets-oversized-chip',
      title: t('targets.excludePhotographedTooltip'),
    });
    const excludePhotographedCb = excludePhotographedChip.querySelector('input')!;
    excludePhotographedCb.checked = this.prefs.excludePhotographed ?? false;
    excludePhotographedCb.addEventListener('change', () => {
      this.prefs.excludePhotographed = excludePhotographedCb.checked;
      savePrefs(this.prefs);
    });
    oversizedRow.appendChild(excludePhotographedChip);

    const respectHorizonChip = createTargetsChip(t('horizon.respectHorizon'), {
      extraClass: 'targets-oversized-chip',
      title: t('horizon.respectHorizonHint'),
    });
    const respectHorizonCb = respectHorizonChip.querySelector('input')!;
    respectHorizonCb.checked = this.prefs.respectHorizon ?? false;
    respectHorizonCb.addEventListener('change', () => {
      this.prefs.respectHorizon = respectHorizonCb.checked;
      savePrefs(this.prefs);
    });
    oversizedRow.appendChild(respectHorizonChip);

    filterColR.appendChild(oversizedRow);

    // ── Primary actions — old placement + style: full-width row at the bottom. ─
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

    updateFiltersSummary();
    return details;
  }

  // ─── Gear section (async, setup-based) ────────────────────────────────────

  private buildGearSection(container: HTMLElement, hintContainer?: HTMLElement): void {
    container.innerHTML = '';
    if (hintContainer) hintContainer.innerHTML = '';

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
    // Cap the width so a short setup name doesn't stretch a giant dropdown
    // across the header column.
    select.className = 'targets-select !max-w-sm';

    let allSetups: GearSetupData[] = [];

    const rebuildSection = () => {
      this.buildGearSection(container, hintContainer);
    };

    // Unified [+] create / [edit] (edit owns deletion) controls, shared with the
    // plan-details and sky-map FOV popup dropdowns.
    const {
      addBtn,
      editBtn,
      refresh: refreshControls,
    } = buildSetupControls({
      getSelectedSetup: () => allSetups.find((s) => s.id === select.value),
      onMutated: () => {
        this.fovFramesStore.loadSpecs();
        rebuildSection();
      },
      createEnabled: false,
    });

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(addBtn);
    row.appendChild(editBtn);
    container.appendChild(row);

    // ── FOV summary caption. Routed to hintContainer (a full-width line below
    //    the header grid) so it never stretches the setup cell. ───────────────
    const fovHintEl = document.createElement('div');
    fovHintEl.className = 'targets-fov-hint';
    (hintContainer ?? container).appendChild(fovHintEl);

    const updateGearInfo = (setup: GearSetupData | undefined) => {
      fovHintEl.textContent = '';
      infoIcon.onclick = null;
      if (!setup) return;
      Promise.all([getTelescopes(), getCameras(), getAccessories()])
        .then(([tels, cams, accs]) => {
          const tel = tels.find((t) => t.id === setup.telescopeId);
          const effectiveCameraId =
            tel?.is_smart_telescope && tel.integrated_camera_id
              ? tel.integrated_camera_id
              : setup.cameraId;
          const cam = cams.find((c) => c.id === effectiveCameraId);
          const acc =
            tel?.is_smart_telescope || !setup.accessoryId
              ? null
              : (accs.find((a) => a.id === setup.accessoryId) ?? null);
          if (!tel || !cam) return;
          const preset = buildGearPreset(tel, cam, acc);
          fovHintEl.textContent = `${t('targets.gear.effectiveFocalLength')}: ${formatGearFovLabel(preset)}`;
          const tooltipRows = buildSetupInfoRows(tel, cam, acc);
          infoIcon.onclick = (e) => {
            e.stopPropagation();
            showKeyValueTooltip(infoIcon, tooltipRows);
          };
        })
        .catch(() => {});
    };

    getGearSetups()
      .then((setups) => {
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
          // The previously-selected setup no longer exists — clear the stale pref.
          if (this.prefs.setupId) {
            this.prefs.setupId = null;
            savePrefs(this.prefs);
          }
          refreshControls();
          updateGearInfo(undefined);
          return;
        }

        select.disabled = false;
        if (this.generateBtn) {
          this.generateBtn.disabled = false;
          this.generateBtn.title = '';
        }
        if (this.randomBtn) {
          this.randomBtn.disabled = false;
          this.randomBtn.title = '';
        }

        for (const s of setups) {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          select.appendChild(opt);
        }

        // Restore or auto-select
        const savedId = this.prefs.setupId;
        const match = savedId ? setups.find((s) => s.id === savedId) : null;
        select.value = match ? savedId! : setups[0].id;
        if (!match) {
          this.prefs.setupId = setups[0].id;
          savePrefs(this.prefs);
        }

        const selectedSetup = () => allSetups.find((s) => s.id === select.value);
        refreshControls();
        updateGearInfo(selectedSetup());

        select.addEventListener('change', () => {
          this.prefs.setupId = select.value || null;
          savePrefs(this.prefs);
          updateGearInfo(selectedSetup());
          refreshControls();
        });
      })
      .catch(() => {
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

    const allGenBtns = [this.generateBtn, this.randomBtn].filter(
      (b): b is HTMLButtonElement => !!b,
    );
    allGenBtns.forEach((b) => {
      b.disabled = true;
    });
    btn.textContent = t('targets.generating');
    const savedScroll = resultsEl.scrollTop;
    resultsEl.innerHTML = `<div class="targets-spinner"></div>`;

    await new Promise((r) => setTimeout(r, 10));

    try {
      const [setups, telescopes, cameras, accessories] = await Promise.all([
        getGearSetups(),
        getTelescopes(),
        getCameras(),
        getAccessories(),
      ]);

      const setup = setups.find((s) => s.id === this.prefs.setupId);
      if (!setup) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach((b) => {
          b.disabled = false;
        });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      const telescope = telescopes.find((t) => t.id === setup.telescopeId);
      if (!telescope) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach((b) => {
          b.disabled = false;
        });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      // For smart telescopes, use integrated camera ID
      const effectiveCameraId =
        telescope.is_smart_telescope && telescope.integrated_camera_id
          ? telescope.integrated_camera_id
          : setup.cameraId;

      const camera = cameras.find((c) => c.id === effectiveCameraId);
      if (!camera) {
        resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.empty')}</div>`;
        allGenBtns.forEach((b) => {
          b.disabled = false;
        });
        btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');
        return;
      }

      const accessory =
        telescope.is_smart_telescope || !setup.accessoryId
          ? null
          : (accessories.find((a) => a.id === setup.accessoryId) ?? null);

      const preset = buildGearPreset(telescope, camera, accessory);

      const dateStr = dateInput.value || todayISO();
      const dateNight = new Date(dateStr + 'T12:00:00Z');
      const dsos = getDSOs();
      const enabledTypes = new Set(this.prefs.enabledTypes ?? [...ALL_DSO_TYPES]);
      const enabledRatings = new Set(this.prefs.enabledRatings ?? [1, 2, 3, 4, 5]);
      const enabledDifficulties = new Set(this.prefs.enabledDifficulties ?? [1, 2, 3, 4, 5]);
      const enabledCatalogs = new Set(this.prefs.enabledCatalogs ?? [...DSO_CATALOGS_ALL]);
      const allConsts = getConstellationInfos();
      const enabledConstellations =
        this.prefs.enabledConstellations &&
        this.prefs.enabledConstellations.length < allConsts.length
          ? new Set(this.prefs.enabledConstellations)
          : null;

      let photographedIds: Set<string> | null = null;
      if (this.prefs.excludePhotographed) {
        const photos = await getPhotos();
        photographedIds = new Set(photos.flatMap((p) => p.dsoIds));
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

      const timeWindow = this.timeWindowFor(dateStr);
      if (timeWindow) {
        const dark = this.nightWindow(location, dateNight);
        const overlapStart = Math.max(dark.start.getTime(), timeWindow.start.getTime());
        const overlapEnd = Math.min(dark.end.getTime(), timeWindow.end.getTime());
        if (overlapEnd <= overlapStart) {
          resultsEl.innerHTML = `<div class="targets-empty">${t('targets.results.noWindowOverlap')}</div>`;
          allGenBtns.forEach((b) => {
            b.disabled = false;
          });
          btn.textContent = t(
            mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest',
          );
          return;
        }
      }

      // Multiple/double stars are synthetic point-like targets (not in the DSO catalog);
      // inject them into the pool when their type chip is enabled.
      const msTargets = enabledTypes.has('MS') ? buildMultipleStarTargets(preset) : [];
      const pool = msTargets.length ? [...filteredDSOs, ...msTargets] : filteredDSOs;

      const rawSuggestions = recommendTargets(pool, preset, location, dateNight, 5000, {
        ignoreFovFit: this.prefs.includeOversized ?? false,
        minAltDeg: this.prefs.minAltDeg ?? 20,
        maxAltDeg: this.prefs.maxAltDeg ?? 80,
        timeWindow: timeWindow ?? undefined,
        horizonProfile: this.prefs.respectHorizon ? useHorizonStore(pinia).profile : null,
      });

      let suggestions: TargetSuggestion[];
      if (!dirFilterActive) {
        suggestions = rawSuggestions;
      } else {
        const midnightUTC = dateNight.getTime() + (12 - lon / 15) * 3600 * 1000;
        suggestions = rawSuggestions.filter((s) => {
          const isNorth = s.dso.dec > lat;
          if (!enabledDirs.has('N') && isNorth) return false;
          if (!enabledDirs.has('S') && !isNorth) return false;
          const isEast = s.bestTimeUtc.getTime() > midnightUTC;
          if (!enabledDirs.has('E') && isEast) return false;
          if (!enabledDirs.has('W') && !isEast) return false;
          return true;
        });
      }

      allGenBtns.forEach((b) => {
        b.disabled = false;
      });
      btn.textContent = t(mode === 'random' ? 'targets.generateRandom' : 'targets.generateBest');

      this.lastPool = mode === 'random' ? shuffleArray(suggestions) : suggestions;
      this.lastMode = mode;
      this.currentPage = 0;
      this.lastSuggestions = this.lastPool;
      this.lastPreset = preset;
      this.lastLocation = location;
      this.lastDateNight = dateNight;
      this.renderResults(resultsEl);
      resultsEl.scrollTop = savedScroll;
    } catch (err: any) {
      allGenBtns.forEach((b) => {
        b.disabled = false;
      });
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

    const sortKey = this.prefs.sortBy ?? 'rating';
    const pageSize = this.prefs.pageSize ?? 15;
    const sorted = sortSuggestions(this.lastPool, sortKey);
    const total = sorted.length;
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
      ['rating', () => t('targets.sort.rating')],
      ['score', () => t('targets.sort.score')],
      ['altitude', () => t('targets.sort.altitude')],
      ['transit', () => t('targets.sort.transit')],
      ['magnitude', () => t('targets.sort.magnitude')],
      ['size', () => t('targets.sort.size')],
      ['fov-fit', () => t('targets.sort.fovFit')],
      ['name', () => t('targets.sort.name')],
      ['difficulty', () => t('targets.sort.difficulty')],
    ];
    for (const [value, labelFn] of sortOpts) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = labelFn();
      opt.selected = value === sortKey;
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
      opt.value = String(n);
      opt.textContent = `${n} ${t('targets.perPage')}`;
      opt.selected = n === pageSize;
      pageSizeSelect.appendChild(opt);
    }
    pageSizeSelect.addEventListener('change', () => {
      this.prefs.pageSize = parseInt(pageSizeSelect.value, 10);
      savePrefs(this.prefs);
      this.currentPage = 0;
      this.renderResults(el);
    });
    toolbar.appendChild(pageSizeSelect);

    const nightInfo = this.buildNightInfoBar();
    if (nightInfo) toolbar.appendChild(nightInfo);

    const paginationEl = document.createElement('div');
    paginationEl.className = 'targets-pagination';
    const navBtn = (label: string, title: string, targetPage: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'targets-pagination-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => navigate(targetPage));
      return b;
    };
    const cp = this.currentPage;
    paginationEl.appendChild(navBtn('«', t('targets.pagination.first'), 0));
    paginationEl.appendChild(navBtn('‹', t('targets.pagination.prev'), cp - 1));
    for (const p of buildPageList(cp, totalPages)) {
      if (p === null) {
        const dot = document.createElement('span');
        dot.className = 'targets-pagination-ellipsis';
        dot.textContent = '…';
        paginationEl.appendChild(dot);
      } else {
        const b = document.createElement('button');
        b.className =
          'targets-pagination-btn targets-pagination-btn--page' +
          (p === cp ? ' targets-pagination-btn--active' : '');
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

    pageSlice.forEach((s, i) => {
      const absoluteIndex = this.currentPage * pageSize + i;
      el.appendChild(
        this.buildTargetCard(s, this.lastPreset!, sorted, absoluteIndex, pageSize, navigate),
      );
    });
  }

  // ─── Target card ───────────────────────────────────────────────────────────

  /**
   * Title/chips/rating + meta stats + integration recipe for a target
   * suggestion — shared by the results-card (`moon: null`, unchanged look)
   * Used by the results card. The trajectory popup uses its own
   * `buildTrajectoryPopupMeta` instead — a wide one-line layout without the
   * title (already in the popup's header) or max-altitude/transit (already
   * shown on the chart), so the two intentionally diverge rather than share
   * a single over-flagged method.
   */
  private buildTargetInfoBlock(
    s: TargetSuggestion,
    preset: ReturnType<typeof buildGearPreset>,
  ): HTMLElement {
    const block = document.createElement('div');
    const { dso } = s;
    // Multiple/double stars are point-like visual targets: no imaging recipe, no FOV fit,
    // no difficulty — the type chip shows the multiplicity instead.
    const isMS = dso.type === 'MS';
    const recipe = isMS ? null : recommendRecipe(dso, preset);

    const header = document.createElement('div');
    header.className = 'target-card-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'target-card-title-row';
    const titleEl = document.createElement('div');
    titleEl.className = 'target-card-title';
    const bestName = dso.displayName || dso.catalogs[0] || dso.id;
    let fullVisibleName = bestName;
    if (dso.displayName) {
      titleEl.appendChild(
        Object.assign(document.createElement('span'), { textContent: dso.displayName }),
      );
      const primaryId = dso.catalogs[0] || dso.id;
      const idSpan = document.createElement('span');
      idSpan.className = 'target-card-catalog-id';
      idSpan.textContent = ' ' + primaryId;
      titleEl.appendChild(idSpan);
      fullVisibleName = `${dso.displayName} ${primaryId}`;
    } else {
      titleEl.textContent = bestName;
    }
    // Lead with the full (untruncated) visible name — the title/id can be cut
    // by the card's ellipsis — then the "also known as" cross-references.
    const otherNames = dso.catalogs.slice(dso.displayName ? 1 : 1);
    titleEl.title =
      otherNames.length > 0
        ? `${fullVisibleName}\n${t('dso.alsoKnownAs')}: ${otherNames.join(' · ')}`
        : fullVisibleName;
    titleRow.appendChild(titleEl);
    if (dso.rating !== null) {
      const ratingEl = document.createElement('div');
      ratingEl.className = 'target-card-rating';
      // A multiple star at 0★ is unresolvable with the current setup — explain why.
      ratingEl.title =
        isMS && dso.rating === 0
          ? t('targets.tooltips.multipleUnresolvable')
          : t('targets.tooltips.rating');
      ratingEl.textContent = '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating);
      titleRow.appendChild(ratingEl);
    }
    header.appendChild(titleRow);

    const chipsRow = document.createElement('div');
    chipsRow.className = 'target-card-chips';
    const typeEl = document.createElement('div');
    typeEl.className = 'target-card-type';
    // Multiple stars show their multiplicity (e.g. "Binary · 34.3″") in place of a type.
    typeEl.textContent =
      isMS && dso.multiplicity ? formatMultiplicity(dso.multiplicity) : dsoTypeLabel(dso.type);
    chipsRow.appendChild(typeEl);
    if (dso.constellation) {
      const constEl = document.createElement('div');
      constEl.className = 'target-card-const';
      constEl.textContent = dso.constellation.toUpperCase();
      const constInfo = getConstellationInfos().find((c) => c.id === dso.constellation);
      if (constInfo) constEl.title = constInfo.name;
      chipsRow.appendChild(constEl);
    }
    header.appendChild(chipsRow);
    block.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'target-card-meta';
    meta.appendChild(
      this.metaItem(
        t('targets.results.maxAlt'),
        formatAlt(s.maxAltDeg),
        t('targets.tooltips.maxAlt'),
      ),
    );
    meta.appendChild(
      this.metaItem(
        t('targets.results.bestTime'),
        formatTime(s.bestTimeUtc),
        t('targets.tooltips.bestTime'),
      ),
    );
    if (dso.mag !== null)
      meta.appendChild(this.metaItem('Mag', dso.mag.toFixed(1), t('targets.tooltips.mag')));
    if (dso.majAxis)
      meta.appendChild(
        this.metaItem(
          t('targets.results.size'),
          formatArcmin(dso.majAxis),
          t('targets.tooltips.size'),
        ),
      );
    block.appendChild(meta);

    const meta2 = document.createElement('div');
    meta2.className = 'target-card-meta';
    if (dso.difficulty !== null) {
      const diffEl = this.metaItem(
        t('targets.sort.difficulty'),
        '◆'.repeat(dso.difficulty) + '◇'.repeat(5 - dso.difficulty),
        t('targets.tooltips.difficulty'),
      );
      diffEl.querySelector('.target-meta-value')!.className =
        'target-meta-value target-card-difficulty';
      meta2.appendChild(diffEl);
    }
    meta2.appendChild(
      this.metaItem(
        t('targets.results.score'),
        `${Math.round(s.score * 100)}%`,
        t('targets.tooltips.score'),
      ),
    );
    // FOV fit is meaningless for a point-like star.
    if (!isMS)
      meta2.appendChild(
        this.metaItem(
          t('targets.results.fov'),
          `${Math.round(s.fovFitScore * 100)}%`,
          t('targets.tooltips.fov'),
        ),
      );
    block.appendChild(meta2);

    // Imaging recipe (total integration + per-filter breakdown) — omitted for visual
    // doubles, which have no recipe (`recipe` is null for multiple-star cards).
    block.appendChild(this.buildRecipeBlock(recipe));

    return block;
  }

  /**
   * Indicative total integration time + collapsible per-filter breakdown.
   * Returns an empty fragment when `recipe` is null (visual doubles have no
   * recipe). Shared by the results card and the trajectory popup so the two
   * don't duplicate this rendering.
   */
  private buildRecipeBlock(recipe: ReturnType<typeof recommendRecipe> | null): DocumentFragment {
    const frag = document.createDocumentFragment();
    if (!recipe) return frag;

    const totalEl = document.createElement('div');
    totalEl.className = 'target-integration-total';
    totalEl.textContent = `${t('targets.results.integrationTotal')}: ${formatHours(recipe.totalHours)}`;
    frag.appendChild(totalEl);

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
    frag.appendChild(details);
    return frag;
  }

  /**
   * The three per-target action buttons — open on map, edit (catalogued DSOs
   * only, null for multiple stars), add to/remove from plan — shared by the
   * results card and the trajectory popup. Callers that are themselves a
   * modal (the trajectory popup) should chain an extra close on `navBtn`'s
   * and `editBtn`'s click (both navigate away from the current view); the
   * results card isn't a modal, so it doesn't need to. `planBtn` never closes
   * anything here or on the card — it's a lightweight toggle with toast
   * feedback, not a navigation.
   */
  private buildTargetActionButtons(
    dso: DSO,
    isMS: boolean,
  ): {
    navBtn: HTMLButtonElement;
    editBtn: HTMLButtonElement | null;
    planBtn: HTMLButtonElement;
  } {
    const navBtn = this.iconActionBtn(mapPinSvg, t('targets.results.openOnMap'));
    navBtn.addEventListener('click', () => {
      this.onNavigate(dso.ra, dso.dec, this.prefs.setupId);
      this.uiStore.closeTargetsOverlay();
    });

    // Editing applies only to catalogued DSOs, not synthetic multiple-star targets.
    const editBtn = isMS ? null : this.iconActionBtn(penSvg, t('dso.edit'));
    editBtn?.addEventListener('click', () => {
      this.onEditDSO?.(dso);
    });

    const planBtn = this.iconActionBtn(listPlusSvg, t('targets.plan.addToPlan'));
    if (!isMS) {
      planBtn.setAttribute('data-plan-dso', dso.id);
      this.refreshPlanBtnState(planBtn, dso.id);
    }
    planBtn.addEventListener('click', () => {
      // Opened from a specific plan's "Find targets" button: add/remove straight
      // from that plan, no picker needed. Opened generically (e.g. from the Sky
      // map, no plan context) falls back to the full plan picker.
      const ctxPlanId = this.uiStore.targetsOverlayPlanId;
      const ctxPlan = ctxPlanId ? this.plansStore.plans.find((p) => p.id === ctxPlanId) : null;
      if (isMS) {
        // A multiple star isn't in the DSO catalog: add it as a custom-location entry at
        // its coords (it then lists as the star's name via the nearest-named-star rule).
        if (ctxPlan) {
          this.plansStore.addCustomEntry(ctxPlan.id, dso.ra, dso.dec).then(() => {
            showToast({
              message: t('targets.plan.addedToPlan', { name: ctxPlan.name }),
              type: 'info',
              duration: 2000,
            });
          });
        } else {
          this.openPlanPicker(planBtn, dso.id, { ra: dso.ra, dec: dso.dec });
        }
        return;
      }
      if (ctxPlan) {
        const wasIn = this.plansStore.isInPlan(dso.id, ctxPlan.id);
        this.plansStore.toggleEntry(ctxPlan.id, dso.id).then(() => {
          this.refreshPlanBtnState(planBtn, dso.id);
          showToast({
            message: t(wasIn ? 'targets.plan.removedFromPlan' : 'targets.plan.addedToPlan', {
              name: ctxPlan.name,
            }),
            type: 'info',
            duration: 2000,
          });
        });
      } else {
        this.openPlanPicker(planBtn, dso.id);
      }
    });

    return { navBtn, editBtn, planBtn };
  }

  private buildTargetCard(
    s: TargetSuggestion,
    preset: ReturnType<typeof buildGearPreset>,
    sorted: TargetSuggestion[],
    absoluteIndex: number,
    pageSize: number,
    navigate: (page: number) => void,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'target-card';
    const { dso } = s;
    const isMS = dso.type === 'MS';
    card.appendChild(this.buildTargetInfoBlock(s, preset));

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'target-actions-row';

    const trajBtn = this.iconActionBtn(trajectorySvg, t('targets.results.trajectory'));
    trajBtn.addEventListener('click', () => {
      this.openTrajectoryPopup(sorted, absoluteIndex, pageSize, navigate);
    });

    const { navBtn, editBtn, planBtn } = this.buildTargetActionButtons(dso, isMS);

    actionsDiv.appendChild(navBtn);
    if (editBtn) actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(planBtn);
    actionsDiv.appendChild(trajBtn);
    card.appendChild(actionsDiv);

    return card;
  }

  /**
   * Stats row for the trajectory popup (plus an optional actions group
   * pinned to the right — the popup passes its nav/edit/plan buttons here,
   * matching the results card), followed by the integration recipe.
   * Type/constellation chips and the rating now live in the popup's own
   * header (beside the title), and there's no max-altitude/transit (already
   * shown on the chart above/below this block) — this is deliberately not
   * `buildTargetInfoBlock`, which is a narrow stacked column built for the
   * results-card grid and doesn't fit a wide modal.
   */
  private buildTrajectoryPopupMeta(
    s: TargetSuggestion,
    preset: ReturnType<typeof buildGearPreset>,
    moon: MoonOverlay | null,
    actionsEl: HTMLElement | null,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-4';
    const { dso } = s;
    const isMS = dso.type === 'MS';
    const recipe = isMS ? null : recommendRecipe(dso, preset);

    // Stats can wrap onto a second line on their own; the actions group
    // stays pinned to the right on the row's first line either way.
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-6';
    const statsGroup = document.createElement('div');
    statsGroup.className = 'flex flex-wrap items-center gap-6 min-w-0';
    row.appendChild(statsGroup);

    if (dso.mag !== null)
      statsGroup.appendChild(this.metaItem('Mag', dso.mag.toFixed(1), t('targets.tooltips.mag')));
    if (dso.majAxis)
      statsGroup.appendChild(
        this.metaItem(
          t('targets.results.size'),
          formatArcmin(dso.majAxis),
          t('targets.tooltips.size'),
        ),
      );
    if (dso.difficulty !== null) {
      const diffEl = this.metaItem(
        t('targets.sort.difficulty'),
        '◆'.repeat(dso.difficulty) + '◇'.repeat(5 - dso.difficulty),
        t('targets.tooltips.difficulty'),
      );
      diffEl.querySelector('.target-meta-value')!.className =
        'target-meta-value target-card-difficulty';
      statsGroup.appendChild(diffEl);
    }
    statsGroup.appendChild(
      this.metaItem(
        t('targets.results.score'),
        `${Math.round(s.score * 100)}%`,
        t('targets.tooltips.score'),
      ),
    );
    if (!isMS)
      statsGroup.appendChild(
        this.metaItem(
          t('targets.results.fov'),
          `${Math.round(s.fovFitScore * 100)}%`,
          t('targets.tooltips.fov'),
        ),
      );
    if (moon) {
      const moonSep = this.moonSepMetaItem(
        this.moonSeparationAt(dso.ra, dso.dec, s.bestTimeUtc),
        moon.illum,
      );
      if (moonSep) statsGroup.appendChild(moonSep);
    }

    if (actionsEl) row.appendChild(actionsEl);

    wrap.appendChild(row);
    wrap.appendChild(this.buildRecipeBlock(recipe));
    return wrap;
  }

  /**
   * Trajectory popup for a results-list target: the same info block + chart
   * as a plan-details row (view-only, one at a time so the chart can be
   * taller), with prev/next stepping across the whole sorted result set
   * (crossing result-page boundaries). Closing the popup pages the results
   * list to whichever page the last-viewed result lives on.
   */
  private openTrajectoryPopup(
    sorted: TargetSuggestion[],
    absoluteIndex: number,
    pageSize: number,
    navigate: (page: number) => void,
  ): void {
    let idx = absoluteIndex;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    // Wider than the default `.modal` (960px): the header now carries the
    // title plus type/constellation chips and rating on one row, and the
    // stats row below needs room too. Inline style, not a `max-w-[…]`
    // utility class — `.modal`'s own `max-width` in the legacy style.css has
    // equal specificity and wins the cascade depending on stylesheet load
    // order, so a class-based override isn't reliable here (same reason the
    // chart height below uses an inline style instead of an arbitrary-value
    // class).
    modal.style.maxWidth = '1100px';

    const header = document.createElement('div');
    header.className = 'modal-header';
    // Title row (name + chips + rating, rebuilt each render) above the aka
    // line (rebuilt each render, only present when other catalog ids exist).
    const titleWrap = document.createElement('div');
    titleWrap.className = 'flex flex-col gap-1 flex-1 min-w-0';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body flex flex-col gap-4 p-7';

    const infoSlot = document.createElement('div');
    infoSlot.className = 'flex flex-col gap-4';

    // Arrows flank the chart specifically (not the whole info+chart stack) so
    // they stay vertically centered on the thing being paged through, the
    // same way the gallery carousel centers on its photo.
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'gallery-carousel-btn gallery-carousel-prev';
    prevBtn.innerHTML = '&#8249;';
    prevBtn.title = t('targets.results.prevResult');
    prevBtn.setAttribute('aria-label', t('targets.results.prevResult'));

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'gallery-carousel-btn gallery-carousel-next';
    nextBtn.innerHTML = '&#8250;';
    nextBtn.title = t('targets.results.nextResult');
    nextBtn.setAttribute('aria-label', t('targets.results.nextResult'));

    const chartBox = document.createElement('div');
    chartBox.className = 'relative';
    // The arrows are absolutely positioned at left:16/right:16 of this box
    // (the shared `.gallery-carousel-btn` rule — same as the gallery's own
    // arrows). At ~50px wide that reaches to ~66px from each edge, which
    // would sit on top of the chart's axis labels and curve if the chart
    // filled the box edge-to-edge. Reserving 80px of blank padding here
    // keeps the arrows over empty space instead of over plotted content.
    chartBox.style.paddingLeft = '80px';
    chartBox.style.paddingRight = '80px';
    // In-flow children (unlike the absolutely-positioned arrows) share the
    // 80px padding above, so the timeline row's start/end labels line up
    // with the chart's x-axis ends below without any extra spacer math.
    const timelineSlot = document.createElement('div');
    const chartSlot = document.createElement('div');
    chartBox.appendChild(prevBtn);
    chartBox.appendChild(timelineSlot);
    chartBox.appendChild(chartSlot);
    chartBox.appendChild(nextBtn);

    body.appendChild(infoSlot);
    body.appendChild(chartBox);
    modal.appendChild(header);
    modal.appendChild(body);
    backdrop.appendChild(modal);

    const render = (): void => {
      const s = sorted[idx];
      const { dso } = s;
      const isMS = dso.type === 'MS';

      // Title + type/constellation chips + rating on one row, aka-line
      // below — rebuilt fresh each render (same pattern as infoSlot/chartSlot
      // below). `buildTrajectoryPopupMeta` never renders any of this.
      titleWrap.innerHTML = '';
      const titleRow = document.createElement('div');
      titleRow.className = 'flex items-center gap-3 flex-wrap';

      const nameEl = document.createElement('h2');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = dso.displayName || dso.catalogs[0] || dso.id;
      nameEl.appendChild(nameSpan);
      if (dso.displayName) {
        const idSpan = document.createElement('span');
        idSpan.className = 'target-card-catalog-id';
        // Leading space: nameEl is a plain (non-flex) h2 now that it sits
        // beside the type/constellation chips in a flex row of its own, so
        // there's no flex `gap` to space these two inline spans apart.
        idSpan.textContent = ' ' + (dso.catalogs[0] || dso.id);
        nameEl.appendChild(idSpan);
      }
      titleRow.appendChild(nameEl);

      const typeEl = document.createElement('div');
      typeEl.className = 'target-card-type';
      typeEl.textContent =
        isMS && dso.multiplicity ? formatMultiplicity(dso.multiplicity) : dsoTypeLabel(dso.type);
      titleRow.appendChild(typeEl);

      if (dso.constellation) {
        const constEl = document.createElement('div');
        constEl.className = 'target-card-const';
        constEl.textContent = dso.constellation.toUpperCase();
        const constInfo = getConstellationInfos().find((c) => c.id === dso.constellation);
        if (constInfo) constEl.title = constInfo.name;
        titleRow.appendChild(constEl);
      }

      if (dso.rating !== null) {
        const ratingEl = document.createElement('div');
        ratingEl.className = 'target-card-rating';
        ratingEl.title =
          isMS && dso.rating === 0
            ? t('targets.tooltips.multipleUnresolvable')
            : t('targets.tooltips.rating');
        ratingEl.textContent = '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating);
        titleRow.appendChild(ratingEl);
      }

      titleWrap.appendChild(titleRow);
      const otherNames = dso.catalogs.slice(1);
      if (otherNames.length > 0) {
        const akaLine = document.createElement('div');
        akaLine.className = 'text-small text-dim font-normal';
        akaLine.textContent = `${t('dso.alsoKnownAs')}: ${otherNames.join(' · ')}`;
        titleWrap.appendChild(akaLine);
      }

      const loc = this.lastLocation!;
      const win = this.nightWindow(loc, this.lastDateNight!);
      const curve = sampleAltCurve(dso.ra, dso.dec, loc.latDeg, loc.lonDeg, win.start, win.end, 10);
      const moon = this.buildMoonOverlay(loc, win);

      // Same three actions as the results card, on the right of the stats
      // row. Nav/edit both navigate away from this view, so — unlike the
      // card, which isn't a modal — they also close this popup; add-to-plan
      // is a lightweight toggle and stays open, same as the card.
      const {
        navBtn: popupNavBtn,
        editBtn: popupEditBtn,
        planBtn: popupPlanBtn,
      } = this.buildTargetActionButtons(dso, isMS);
      popupNavBtn.addEventListener('click', close);
      popupEditBtn?.addEventListener('click', close);
      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'flex items-center gap-2 shrink-0';
      actionsGroup.appendChild(popupNavBtn);
      if (popupEditBtn) actionsGroup.appendChild(popupEditBtn);
      actionsGroup.appendChild(popupPlanBtn);

      infoSlot.innerHTML = '';
      infoSlot.appendChild(this.buildTrajectoryPopupMeta(s, this.lastPreset!, moon, actionsGroup));
      infoSlot.appendChild(this.buildMoonToggle(render));

      // Night start/end + moon rise/set, aligned to the chart's x-axis —
      // same row (and overlap-prevention via `spaceMoonMarkers`) as plan
      // details, paired here with a gutter spacer instead of the plan row's
      // own spacers so it lines up with this popup's chart layout.
      timelineSlot.innerHTML = '';
      const timelineRow = document.createElement('div');
      timelineRow.className = 'flex items-end gap-3 pb-1';
      const gutterSpacer = document.createElement('span');
      gutterSpacer.className = `${TargetsView.axisGutterWidth(moon)} shrink-0`;
      timelineRow.append(gutterSpacer, this.buildTimelineChartArea(win, loc, moon));
      timelineSlot.appendChild(timelineRow);

      chartSlot.innerHTML = '';
      chartSlot.appendChild(this.buildPlanChart(curve, win, s.bestTimeUtc, moon, 340));

      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= sorted.length - 1;
    };

    const step = (delta: number): void => {
      const next = Math.max(0, Math.min(sorted.length - 1, idx + delta));
      if (next === idx) return;
      idx = next;
      render();
    };
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));

    const close = (): void => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      const finalPage = Math.floor(idx / pageSize);
      if (finalPage !== this.currentPage) navigate(finalPage);
    };
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const onKey = (e: KeyboardEvent): void => {
      // Stop here — the underlying Targets overlay is itself a BaseModal.vue
      // with its own window-level Escape handler; without this, closing the
      // popup on Escape also closes the overlay behind it.
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    };
    document.addEventListener('keydown', onKey);

    render();
    document.body.appendChild(backdrop);
  }

  /** A square icon-only action button (`btn-icon`) holding an inline SVG. */
  private iconActionBtn(svg: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon target-icon-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = svg;
    return btn;
  }

  /** Empty-target-list state for a plan: message + a "Find targets" CTA that
   * opens the overlay scoped to this plan. */
  private buildPlanEmptyState(plan: Plan): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'targets-empty flex flex-col items-center gap-3';
    const msg = document.createElement('div');
    msg.textContent = t('targets.plan.empty');
    wrap.appendChild(msg);
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn-action inline-flex items-center gap-2';
    cta.innerHTML = `<span class="w-4 h-4 inline-flex">${targetSvg}</span>`;
    cta.appendChild(document.createTextNode(t('targets.findTargets')));
    cta.addEventListener('click', () => this.uiStore.openTargetsOverlay(plan.id));
    wrap.appendChild(cta);
    return wrap;
  }

  /** Highlight the plan-list button when the DSO is already in at least one plan. */
  private refreshPlanBtnState(btn: HTMLButtonElement, dsoId: string): void {
    const inPlan = this.plansStore.plansContaining(dsoId).length > 0;
    btn.classList.toggle('bg-[var(--accent-fill-sm)]', inPlan);
  }

  private metaItem(label: string, value: string, tooltip?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'target-meta-item';
    if (tooltip) el.title = tooltip;
    const l = document.createElement('span');
    // Labels stay on a single line — a wrapped label misaligns the meta grid.
    l.className = 'target-meta-label whitespace-nowrap';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'target-meta-value';
    v.textContent = value;
    el.appendChild(l);
    el.appendChild(v);
    return el;
  }

  /**
   * Moon-distance meta item, coloured by `moonDangerLevel` (separation + phase).
   * Returns null when there is no separation to show (moon overlay off / never rises).
   */
  private moonSepMetaItem(sepDeg: number | null, illum: number): HTMLElement | null {
    if (sepDeg == null) return null;
    const level = moonDangerLevel(sepDeg, illum);
    // Lead with an adjective so the number reads as a distance from the target,
    // e.g. "Close (34°)" / "Far (109°)".
    const adj = t(
      {
        danger: 'targets.plan.moonClose',
        warn: 'targets.plan.moonModerate',
        ok: 'targets.plan.moonFar',
      }[level],
    );
    const item = this.metaItem(
      t('targets.plan.moonSeparation'),
      `${adj} (${formatAlt(sepDeg)})`,
      t('targets.plan.moonSeparationHelp'),
    );
    const token = {
      danger: '--color-danger',
      warn: '--status-warn-text',
      ok: '--status-success-text',
    }[level];
    const value = item.querySelector('.target-meta-value') as HTMLElement;
    // Inline style (not a utility class): `.target-meta-value` sets its own colour
    // and would win the cascade tie by source order, so set it directly here.
    value.style.color = `var(${token})`;
    // The "Moon distance" value ("Medium (67°)") is longer than most — keep it
    // on one line too (labels are already nowrap via metaItem).
    value.classList.add('whitespace-nowrap');
    return item;
  }

  // ─── My Plans (night plans) ─────────────────────────────────────────────────

  /** Observer for a given observation night ISO date (falls back to the global date / today). */
  private getPlanObserverFor(plan: Plan): { loc: ObserverLocation; dateNight: Date } | null {
    // Per-plan location, falling back to the global location when unset (mirrors
    // nightOf falling back to the global date).
    const lat = plan.lat ?? this.prefs.lat;
    const lon = plan.lon ?? this.prefs.lon;
    if (lat == null || lon == null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    const dateStr = plan.nightOf ?? this.prefs.lastDateISO ?? todayISO();
    return { loc: { latDeg: lat, lonDeg: lon }, dateNight: new Date(dateStr + 'T12:00:00Z') };
  }

  /**
   * Open the sky map zoomed to fit a whole mosaic: selects the mosaic's plan,
   * shows the frames, and zooms using the mosaic's overall envelope (cols × rows
   * tiles) as the frame for the scale calculation — so the entire mosaic fits.
   */
  private async navigateToMosaic(
    planId: string,
    mosaic: PlanMosaic,
    setupId: string | null,
  ): Promise<void> {
    this.fovFramesStore.setSelection({ kind: 'plan', planId });
    this.fovFramesStore.setFramesVisible(true);
    const preset = await this.planPreset(setupId);
    let scale: number;
    if (preset) {
      const { wDeg: tileW, hDeg: tileH } = fovDeg(preset);
      const env = outlineFromGrid(mosaic.cols, mosaic.rows, tileW, tileH, mosaic.overlapPct);
      const view = this.skyMap.getView();
      scale = computeFovTargetScale(
        env.wDeg,
        env.hDeg,
        mosaic.centerDec,
        getHemisphere(),
        Math.min(view.width, view.height),
      );
    } else {
      scale = Math.max(this.skyMap.getView().scale, 400);
    }
    this.uiStore.switchView('skymap');
    this.skyMap.navigateTo(mosaic.centerRa, mosaic.centerDec, scale);
    this.fovFramesStore.requestPopupOpen();
  }

  /** Resolve a gear setup id to a {@link GearPreset} (telescope+camera+accessory). */
  private async planPreset(setupId: string | null): Promise<GearPreset | null> {
    if (!setupId) return null;
    try {
      const [setups, telescopes, cameras, accessories] = await Promise.all([
        getGearSetups(),
        getTelescopes(),
        getCameras(),
        getAccessories(),
      ]);
      const setup = setups.find((s) => s.id === setupId);
      if (!setup) return null;
      const telescope = telescopes.find((tel) => tel.id === setup.telescopeId);
      if (!telescope) return null;
      const effectiveCameraId =
        telescope.is_smart_telescope && telescope.integrated_camera_id
          ? telescope.integrated_camera_id
          : setup.cameraId;
      const camera = cameras.find((c) => c.id === effectiveCameraId);
      if (!camera) return null;
      const accessory =
        telescope.is_smart_telescope || !setup.accessoryId
          ? null
          : (accessories.find((a) => a.id === setup.accessoryId) ?? null);
      return buildGearPreset(telescope, camera, accessory);
    } catch (err) {
      reportUnknownRendererError('plan_preset_failed', err, { setupId });
      return null;
    }
  }

  /** Resolve a gear setup id to its name + raw telescope/camera/accessory (for the PDF summary). */
  private async resolvePlanSetup(setupId: string | null): Promise<{
    name: string;
    tel: TelescopeData;
    cam: CameraData;
    acc: AccessoryData | null;
  } | null> {
    if (!setupId) return null;
    try {
      const [setups, telescopes, cameras, accessories] = await Promise.all([
        getGearSetups(),
        getTelescopes(),
        getCameras(),
        getAccessories(),
      ]);
      const setup = setups.find((s) => s.id === setupId);
      if (!setup) return null;
      const tel = telescopes.find((t) => t.id === setup.telescopeId);
      if (!tel) return null;
      const effectiveCameraId =
        tel.is_smart_telescope && tel.integrated_camera_id
          ? tel.integrated_camera_id
          : setup.cameraId;
      const cam = cameras.find((c) => c.id === effectiveCameraId);
      if (!cam) return null;
      const acc =
        tel.is_smart_telescope || !setup.accessoryId
          ? null
          : (accessories.find((a) => a.id === setup.accessoryId) ?? null);
      return { name: setup.name, tel, cam, acc };
    } catch (err) {
      reportUnknownRendererError('plan_setup_resolve_failed', err, { setupId });
      return null;
    }
  }

  /** Dark-sky window for the night (mirrors recommendTargets fallback). */
  private nightWindow(loc: ObserverLocation, dateNight: Date): { start: Date; end: Date } {
    const tw = twilightWindow(dateNight, loc.latDeg, loc.lonDeg);
    if (tw) return { start: tw.start, end: tw.end };
    return {
      start: new Date(
        Date.UTC(
          dateNight.getUTCFullYear(),
          dateNight.getUTCMonth(),
          dateNight.getUTCDate(),
          20,
          0,
          0,
        ),
      ),
      end: new Date(
        Date.UTC(
          dateNight.getUTCFullYear(),
          dateNight.getUTCMonth(),
          dateNight.getUTCDate() + 1,
          6,
          0,
          0,
        ),
      ),
    };
  }

  /**
   * User-configured observation window (`obsStartTime`/`obsEndTime`, HH:MM in the
   * browser's local time) for the given night, or null if not set — both fields
   * must be filled in for the window to be active.
   *
   * "Night of `dateStr`" spans that evening through the following morning, so a
   * pre-noon clock time (e.g. "01:00") is anchored to the calendar day *after*
   * `dateStr`, while a PM/noon time is anchored to `dateStr` itself — matching
   * dusk (evening of `dateStr`) / dawn (morning of `dateStr`+1) from
   * `twilightWindow`. Without this, "01:00" would resolve to the night before
   * the one actually being searched.
   */
  private timeWindowFor(dateStr: string): { start: Date; end: Date } | null {
    const startStr = this.prefs.obsStartTime;
    const endStr = this.prefs.obsEndTime;
    if (!startStr || !endStr) return null;
    const anchor = (hhmm: string): Date => {
      const d = new Date(`${dateStr}T${hhmm}:00`);
      if (parseInt(hhmm.slice(0, 2), 10) < 12) d.setDate(d.getDate() + 1);
      return d;
    };
    const start = anchor(startStr);
    let end = anchor(endStr);
    if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 3600 * 1000);
    return { start, end };
  }

  /** Moon–target angular separation (°) at a given UTC instant. */
  private moonSeparationAt(raDeg: number, decDeg: number, at: Date): number {
    const { raDeg: moonRa, decDeg: moonDec } = moonRaDecDeg(dateToJD(at));
    return angularSeparationDeg(raDeg, decDeg, moonRa, moonDec);
  }

  /**
   * Moon overlay for a plan night, computed once and shared by every row.
   * Returns null when the toggle is off or the Moon stays below the horizon for
   * the whole window (no curve, no separation badge).
   */
  private buildMoonOverlay(
    loc: ObserverLocation,
    win: { start: Date; end: Date },
  ): MoonOverlay | null {
    if (this.prefs.showMoon === false) return null;
    const curve = sampleMoonAltCurve(loc.latDeg, loc.lonDeg, win.start, win.end);
    if (!curve.some((s) => s.altDeg > 0)) return null; // moon never rises this night
    const midJd = dateToJD(new Date((win.start.getTime() + win.end.getTime()) / 2));
    const { phaseIndex, illum } = moonPhase(midJd);
    return { curve, phaseIndex, illum };
  }

  private computePlanTargets(
    plan: {
      entries: Array<{
        id: string;
        dsoId: string | null;
        ra: number | null;
        dec: number | null;
        mosaicId?: string | null;
      }>;
    },
    loc: ObserverLocation,
    win: { start: Date; end: Date },
    moonEnabled: boolean,
  ): PlanTargetInfo[] {
    const out: PlanTargetInfo[] = [];
    for (const e of plan.entries) {
      if (e.mosaicId) continue; // mosaic tiles are summarised as one mosaic, not per-tile rows
      const realDso = e.dsoId ? getDSOById(e.dsoId) : null;
      // Effective position: explicit frame-centre override, else the DSO centre.
      const ra = e.ra ?? realDso?.ra;
      const dec = e.dec ?? realDso?.dec;
      if (ra == null || dec == null) continue; // nothing to place
      // A frame on empty sky keeps a trajectory but has no catalogue metadata.
      const dso = realDso ?? this.customLocationDso(e.id, ra, dec);
      const { maxAltDeg, atDate } = maxAltDuringWindow(
        ra,
        dec,
        loc.latDeg,
        loc.lonDeg,
        win.start,
        win.end,
        10,
      );
      const curve = sampleAltCurve(ra, dec, loc.latDeg, loc.lonDeg, win.start, win.end, 10);
      const moonSepDeg = moonEnabled ? this.moonSeparationAt(ra, dec, atDate) : null;
      out.push({ entryId: e.id, dso, maxAltDeg, bestTimeUtc: atDate, curve, moonSepDeg });
    }
    // Transit-ordered: earliest culmination first.
    out.sort((a, b) => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime());
    return out;
  }

  /** Synthetic DSO for a custom-location plan entry (no catalogued object). */
  private customLocationDso(entryId: string, ra: number, dec: number): DSO {
    return {
      id: `custom:${entryId}`,
      ra,
      dec,
      type: '?',
      majAxis: null,
      minAxis: null,
      pa: 0,
      mag: null,
      displayName: customLocationLabel(ra, dec),
      catalogs: [`${ra.toFixed(1)}°, ${dec.toFixed(1)}°`],
      emissionLines: null,
      constellation: null,
      rating: null,
      difficulty: null,
      containerId: null,
      priority: Number.MAX_SAFE_INTEGER,
    };
  }

  private defaultPlanName(): string {
    const dateStr = this.prefs.lastDateISO ?? todayISO();
    const nice = new Date(dateStr + 'T12:00:00Z').toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return t('targets.plan.defaultName', { date: nice });
  }

  /**
   * Toggle a tooltip listing each mosaic panel's computable metadata (max
   * altitude, angle, centre RA/Dec). The table scrolls when a mosaic has many
   * panels so the popup never overflows the viewport.
   */
  private showMosaicPanelDetails(
    anchor: HTMLElement,
    plan: Plan,
    mosaic: PlanMosaic,
    loc: ObserverLocation,
    win: { start: Date; end: Date },
  ): void {
    const tiles = plan.entries
      .filter((e) => e.mosaicId === mosaic.id && e.ra != null && e.dec != null)
      .sort((a, b) => a.position - b.position);

    showCustomTooltip(anchor, (tip) => {
      const heading = document.createElement('h3');
      heading.textContent = t('targets.plan.panelDetailsTitle');
      tip.appendChild(heading);

      // Scroll wrapper — bounded to the viewport so long mosaics stay usable.
      const scroll = document.createElement('div');
      scroll.className = 'max-h-[50vh] overflow-y-auto';
      const table = document.createElement('table');
      table.className = 'dso-info-table';

      const headers = [
        t('targets.plan.panelColumn'),
        t('targets.results.maxAlt'),
        t('fovOverlay.angleLabel'),
        'RA',
        'Dec',
      ];
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      for (const h of headers) {
        const th = document.createElement('th');
        th.className = 'text-left text-dim font-medium pr-4 pb-1 whitespace-nowrap';
        th.textContent = h;
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      tiles.forEach((e, i) => {
        const { maxAltDeg } = maxAltDuringWindow(
          e.ra!,
          e.dec!,
          loc.latDeg,
          loc.lonDeg,
          win.start,
          win.end,
          10,
        );
        const cells = [
          String(i + 1),
          formatAlt(maxAltDeg),
          formatPaDeg(e.paDeg ?? mosaic.paDeg),
          formatRA(e.ra!),
          formatDec(e.dec!),
        ];
        const tr = document.createElement('tr');
        for (const c of cells) {
          const td = document.createElement('td');
          td.className = 'pr-4 text-secondary whitespace-nowrap';
          td.textContent = c;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      tip.appendChild(scroll);
    });
  }

  /** Inline-edit a plan name in place (swaps the header label for an input). */
  private startRenamePlan(plan: { id: string; name: string }, nameEl: HTMLElement): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = plan.name;
    input.className =
      'flex-1 min-w-0 bg-[var(--bg-input)] border border-subtle text-bright text-sub font-medium px-2 py-1 rounded-sm focus:outline-none focus:border-focus';
    input.addEventListener('click', (e) => e.stopPropagation());

    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== plan.name) {
        plan.name = v;
        nameEl.textContent = v;
        await this.plansStore.renamePlan(plan.id, v);
      }
      input.replaceWith(nameEl);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private buildPlansView(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'targets-plans flex flex-col gap-4 p-4';

    // Each plan carries its own observation night and gear setup (controls live
    // inside the plan section), so there are no shared controls at the top.
    const plans = this.plansStore.plans;

    if (plans.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'targets-empty flex flex-col items-center gap-3';
      const msg = document.createElement('div');
      msg.textContent = t('targets.plan.noPlans');
      empty.appendChild(msg);
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'btn-action inline-flex items-center gap-2';
      cta.innerHTML = `<span class="w-4 h-4 inline-flex">${targetSvg}</span>`;
      cta.appendChild(document.createTextNode(t('targets.findTargets')));
      cta.addEventListener('click', () => this.uiStore.openTargetsOverlay(null));
      empty.appendChild(cta);
      wrap.appendChild(empty);
    } else {
      const accordion = document.createElement('div');
      accordion.className = 'targets-plan-accordion flex flex-col gap-2';
      for (const plan of plans) accordion.appendChild(this.buildPlanSection(plan));
      wrap.appendChild(accordion);
    }

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn-action self-start';
    newBtn.textContent = '+ ' + t('targets.plan.newPlan');
    newBtn.addEventListener('click', async () => {
      await this.plansStore.createPlan(this.defaultPlanName());
      this.updatePlanBadge();
      this.render();
    });
    wrap.appendChild(newBtn);

    return wrap;
  }

  private buildPlanSection(plan: Plan): HTMLElement {
    const details = document.createElement('details');
    details.className =
      'targets-plan-section border border-solid border-[var(--border-accent)] rounded-md bg-card';

    const summary = document.createElement('summary');
    summary.className = 'flex items-center gap-2 px-4 py-3 cursor-pointer select-none';

    const nameWrap = document.createElement('span');
    nameWrap.className = 'flex-1 min-w-0 flex items-baseline gap-2';

    const nameEl = document.createElement('span');
    nameEl.className = 'min-w-0 text-bright text-sub font-medium truncate';
    nameEl.textContent = plan.name;

    const count = document.createElement('span');
    count.className = 'text-dim text-small shrink-0';
    const setCount = (n: number) => {
      count.textContent = `(${t('targets.plan.itemCount', { n })})`;
    };
    // A mosaic counts as one item (its tiles aren't listed individually).
    const itemCount = () =>
      plan.entries.filter((e) => !e.mosaicId).length + (plan.mosaics?.length ?? 0);
    setCount(itemCount());

    nameWrap.appendChild(nameEl);
    nameWrap.appendChild(count);

    // "Find targets" — summoned overlay, above the target list so it's reachable
    // without scrolling. Opened with this plan's id as context: picks made in the
    // overlay add straight into this plan.
    const findTargetsBtn = this.iconActionBtn(targetSvg, t('targets.findTargets'));
    findTargetsBtn.classList.add('shrink-0');
    findTargetsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.uiStore.openTargetsOverlay(plan.id);
    });

    const showOnMapBtn = this.iconActionBtn(mapPinSvg, t('targets.plan.showOnMap'));
    showOnMapBtn.classList.add('shrink-0');
    showOnMapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Select this plan in the FOV system, jump to the sky map, and open the
      // frame-manager popup on it.
      this.fovFramesStore.setSelection({ kind: 'plan', planId: plan.id });
      this.fovFramesStore.setFramesVisible(true);
      this.uiStore.switchView('skymap');
      this.fovFramesStore.requestPopupOpen();
    });

    const renameBtn = this.iconActionBtn(penSvg, t('targets.plan.rename'));
    renameBtn.classList.add('shrink-0');
    renameBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startRenamePlan(plan, nameEl);
    });
    const exportBtn = this.iconActionBtn(exportSvg, t('targets.plan.exportPdf'));
    exportBtn.classList.add('shrink-0');
    const deleteBtn = this.iconActionBtn(trashSvg, t('targets.plan.delete'));
    deleteBtn.classList.add('shrink-0', 'btn-icon--danger');

    summary.appendChild(nameWrap);
    summary.appendChild(findTargetsBtn);
    summary.appendChild(showOnMapBtn);
    summary.appendChild(renameBtn);
    summary.appendChild(exportBtn);
    summary.appendChild(deleteBtn);
    details.appendChild(summary);

    // Focus signal from the FOV popup's "open plan details": expand + scroll here.
    if (this.uiStore.pendingPlanFocusId === plan.id) {
      this.uiStore.pendingPlanFocusId = null;
      details.open = true;
      requestAnimationFrame(() => details.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }

    const body = document.createElement('div');
    body.className = 'targets-plan-body flex flex-col gap-3 px-4 pb-4';

    // ── Per-plan date + setup controls (each plan has its own night and gear) ──
    // Compact layout: each input hugs its label, with a wide gap between the two
    // groups for a clear separation (the shared form-row min-widths are dropped).
    const controls = document.createElement('div');
    controls.className = 'flex flex-wrap items-center gap-x-12 gap-y-2';

    const dateRow = document.createElement('div');
    dateRow.className = 'flex items-center gap-2';
    const dateLabel = document.createElement('label');
    dateLabel.className = 'text-base text-dim shrink-0';
    dateLabel.textContent = t('targets.date.label');
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'targets-coord-input !min-w-0 !max-w-none !flex-none w-auto';
    dateInput.value = plan.nightOf ?? this.prefs.lastDateISO ?? todayISO();
    dateRow.appendChild(dateLabel);
    dateRow.appendChild(dateInput);
    controls.appendChild(dateRow);

    const setupRow = document.createElement('div');
    setupRow.className = 'flex items-center gap-2';
    const setupLabel = document.createElement('label');
    setupLabel.className = 'text-base text-dim shrink-0';
    setupLabel.textContent = t('targets.gear.setup');
    const setupSelect = document.createElement('select');
    setupSelect.className = 'targets-select !min-w-0 !flex-none w-auto';
    setupSelect.disabled = true;
    let planSetups: GearSetupData[] = [];
    const setupControls = buildSetupControls({
      getSelectedSetup: () => planSetups.find((s) => s.id === setupSelect.value),
      onMutated: () => this.render(),
    });
    setupRow.appendChild(setupLabel);
    setupRow.appendChild(setupSelect);
    setupRow.appendChild(setupControls.addBtn);
    setupRow.appendChild(setupControls.editBtn);
    controls.appendChild(setupRow);

    // Per-plan observing location (falls back to the global location when unset),
    // using the same widget as the recommend form. The full widget is wide, so it
    // wraps onto its own line within the flex-wrap controls.
    const locRow = document.createElement('div');
    locRow.className = 'flex items-center gap-2';
    const locLabel = document.createElement('label');
    locLabel.className = 'text-base text-dim shrink-0';
    locLabel.textContent = t('targets.location.label');
    locRow.appendChild(locLabel);
    locRow.appendChild(
      this.buildLocationWidget({
        getLat: () => plan.lat,
        getLon: () => plan.lon,
        onChange: (la, lo) => {
          plan.lat = la;
          plan.lon = lo;
          this.plansStore.updatePlanSettings(
            plan.id,
            plan.nightOf,
            plan.setupId,
            plan.lat,
            plan.lon,
          );
          renderTrajectories();
        },
      }),
    );
    controls.appendChild(locRow);

    body.appendChild(controls);

    // Region rebuilt whenever the plan's night or setup changes (keeps the
    // <details> open and the controls focused — only the trajectories refresh).
    const trajWrap = document.createElement('div');
    trajWrap.className = 'flex flex-col gap-3';
    body.appendChild(trajWrap);
    details.appendChild(body);

    // The effective setup id (plan's own, else the global recommend default).
    const effectiveSetupId = (): string | null => plan.setupId ?? this.prefs.setupId ?? null;

    // Latest computed targets/window — read by the PDF export button.
    let currentInfos: PlanTargetInfo[] = [];
    let currentWin: { start: Date; end: Date } | null = null;

    const renderTrajectories = (): void => {
      trajWrap.innerHTML = '';
      currentInfos = [];
      currentWin = null;
      const observer = this.getPlanObserverFor(plan);
      if (!observer) {
        trajWrap.innerHTML = `<div class="targets-empty">${t('targets.location.notSet')}</div>`;
        return;
      }
      const hasStandalone = plan.entries.some((e) => !e.mosaicId);
      if (!hasStandalone && (plan.mosaics?.length ?? 0) === 0) {
        trajWrap.appendChild(this.buildPlanEmptyState(plan));
        return;
      }
      const win = this.nightWindow(observer.loc, observer.dateNight);
      const moon = this.buildMoonOverlay(observer.loc, win);
      // computePlanTargets returns a transit-ordered baseline; re-order by the
      // plan's chosen sort key (the exported PDF reads currentInfos, so both the
      // list and the PDF inherit this order).
      const sortKey = (plan.sortBy ?? 'transit') as PlanSortKey;
      const infos = sortPlanTargets(
        this.computePlanTargets(plan, observer.loc, win, this.prefs.showMoon !== false),
        sortKey,
        firstWindowFracByEntry(plan.entries),
      );
      currentInfos = infos;
      currentWin = win;

      // Sort dropdown (left) and Moon toggle (right) share one row to save space,
      // using the same wide inter-group gap as the date/setup/location row above.
      const controlsRow = document.createElement('div');
      controlsRow.className = 'flex flex-wrap items-center gap-x-12 gap-y-2 mb-[var(--space-6h)]';
      controlsRow.append(
        this.buildPlanSortBar(plan, renderTrajectories),
        this.buildMoonToggle(renderTrajectories),
      );
      trajWrap.appendChild(controlsRow);
      trajWrap.appendChild(this.buildTimelineHeader(win, observer.loc, moon));
      const list = document.createElement('div');
      list.className = 'flex flex-col divide-y divide-[var(--border-input)]';
      const fillers: Array<(p: GearPreset | null) => void> = [];
      const mosaicFillers: Array<(p: GearPreset | null) => void> = [];
      for (const info of infos) {
        const entryName = info.dso.displayName ?? info.dso.catalogs[0] ?? info.dso.id;
        const { row, applyPreset } = this.buildPlanRow(
          plan.id,
          info,
          win,
          effectiveSetupId(),
          moon,
          (rowEl) => {
            // Delete immediately with an undo toast (shared with the FOV popup).
            deleteFrameWithUndo(
              { kind: 'plan', planId: plan.id, entryId: info.entryId, name: entryName },
              {
                onRemoved: () => {
                  // In-place removal — must NOT collapse or rebuild the whole plan.
                  rowEl.remove();
                  plan.entries = plan.entries.filter((e) => e.id !== info.entryId);
                  currentInfos = currentInfos.filter((i) => i.entryId !== info.entryId);
                  setCount(itemCount());
                  this.updatePlanBadge();
                  if (!plan.entries.some((e) => !e.mosaicId) && (plan.mosaics?.length ?? 0) === 0) {
                    trajWrap.innerHTML = '';
                    trajWrap.appendChild(this.buildPlanEmptyState(plan));
                  }
                },
                // Restore re-creates the entry in the store (fresh objects), so re-render
                // the whole view, keeping this plan expanded.
                onRestored: () => {
                  this.uiStore.pendingPlanFocusId = plan.id;
                  this.render();
                },
              },
            );
          },
        );
        fillers.push(applyPreset);
        list.appendChild(row);
      }
      trajWrap.appendChild(list);

      // Mosaic summaries: one row per mosaic (target · scale · total integration).
      // A mosaic counts as N panels, each imaged like the target, so the total
      // integration is the single-object recipe × the tile count.
      for (const mosaic of plan.mosaics ?? []) {
        const tileCount = plan.entries.filter((e) => e.mosaicId === mosaic.id).length;
        const dso = mosaic.dsoId ? getDSOById(mosaic.dsoId) : null;
        const name = dso
          ? (dso.displayName ?? dso.id)
          : customLocationLabel(mosaic.centerRa, mosaic.centerDec);

        // Trajectory + altitude metadata are computed from the mosaic centre, so
        // they need no catalogue object (only computable values are shown).
        const { maxAltDeg, atDate } = maxAltDuringWindow(
          mosaic.centerRa,
          mosaic.centerDec,
          observer.loc.latDeg,
          observer.loc.lonDeg,
          win.start,
          win.end,
          10,
        );
        const curve = sampleAltCurve(
          mosaic.centerRa,
          mosaic.centerDec,
          observer.loc.latDeg,
          observer.loc.lonDeg,
          win.start,
          win.end,
          10,
        );

        // Same three-column layout as a standalone plan row (info · chart · delete).
        const row = document.createElement('div');
        row.className =
          'flex items-start gap-3 py-3 border-0 border-solid border-t border-[var(--border-input)]';

        // Grow the column to fit the (wider) panel summary on one line rather
        // than the fixed target-row width — the chart simply takes what's left.
        const left = document.createElement('div');
        left.className = `min-w-52 w-fit max-w-80 shrink-0 flex flex-col gap-1`;
        const title = document.createElement('div');
        title.className = 'text-sub text-bright truncate max-w-full';
        title.textContent = `${name} · ${t('targets.plan.mosaicLabel')}`;

        // Computable metadata only — no rating/difficulty/magnitude (catalogue fields).
        // Two rows (like a standalone target) for breathing room: altitude/angle on
        // the first, the mosaic centre coordinates on the second.
        const meta = document.createElement('div');
        meta.className = 'target-card-meta';
        meta.appendChild(
          this.metaItem(
            t('targets.results.maxAlt'),
            formatAlt(maxAltDeg),
            t('targets.tooltips.maxAlt'),
          ),
        );
        meta.appendChild(
          this.metaItem(
            t('fovOverlay.angleLabel'),
            formatPaDeg(mosaic.paDeg),
            t('fovOverlay.angleHelp'),
          ),
        );
        const mosaicSep = moon
          ? this.moonSepMetaItem(
              this.moonSeparationAt(mosaic.centerRa, mosaic.centerDec, atDate),
              moon.illum,
            )
          : null;
        if (mosaicSep) meta.appendChild(mosaicSep);

        // RA/Dec are the mosaic centre — keep each value on one line so the
        // seconds never wrap below their label (nowrap, not a fixed width).
        const meta2 = document.createElement('div');
        meta2.className = 'target-card-meta';
        const raItem = this.metaItem('RA', formatRA(mosaic.centerRa), t('dso.raDec'));
        const decItem = this.metaItem('Dec', formatDec(mosaic.centerDec), t('dso.raDec'));
        raItem.querySelector('.target-meta-value')!.classList.add('whitespace-nowrap');
        decItem.querySelector('.target-meta-value')!.classList.add('whitespace-nowrap');
        meta2.appendChild(raItem);
        meta2.appendChild(decItem);

        // Mosaic geometry summary: panels × panel size → resulting mosaic size
        // (filled once the gear preset resolves, as panel size depends on gear).
        // Sits directly under the name, with an info icon opening per-panel details.
        const summaryRow = document.createElement('div');
        summaryRow.className = 'flex items-center gap-2';
        const sub = document.createElement('div');
        sub.className = 'text-body text-secondary whitespace-nowrap';
        sub.textContent = `${tileCount} ${t('fovOverlay.mosaicPanels')}`;
        const infoIcon = document.createElement('span');
        infoIcon.className = 'hints-info-icon shrink-0';
        infoIcon.textContent = 'ℹ';
        infoIcon.title = t('targets.plan.panelDetails');
        infoIcon.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showMosaicPanelDetails(infoIcon, plan, mosaic, observer.loc, win);
        });
        summaryRow.append(sub, infoIcon);

        // Total integration, styled exactly like a standalone target row.
        const totalEl = document.createElement('div');
        totalEl.className = 'target-integration-total';
        totalEl.textContent = `${t('targets.results.integrationTotal')}: —`;

        left.appendChild(title);
        left.appendChild(summaryRow);
        left.appendChild(meta);
        left.appendChild(meta2);
        left.appendChild(totalEl);

        const chartWrap = this.buildPlanChart(curve, win, atDate, moon);

        // Show-on-map: zoom to fit the whole mosaic (its envelope is the frame
        // used for the zoom calculation).
        const navBtn = this.iconActionBtn(mapPinSvg, t('targets.plan.showOnMap'));
        navBtn.classList.add('shrink-0');
        navBtn.addEventListener('click', () => {
          void this.navigateToMosaic(plan.id, mosaic, effectiveSetupId());
        });

        const del = this.iconActionBtn(trashSvg, t('fovOverlay.deleteMosaic'));
        del.classList.add('shrink-0', 'btn-icon--danger');
        del.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!(await confirmPlanEntryDelete(name))) return;
          await this.plansStore.deleteMosaic(plan.id, mosaic.id);
          plan.mosaics = plan.mosaics.filter((m) => m.id !== mosaic.id);
          plan.entries = plan.entries.filter((en) => en.mosaicId !== mosaic.id);
          setCount(itemCount());
          renderTrajectories();
        });
        row.appendChild(left);
        row.appendChild(chartWrap);
        row.appendChild(navBtn);
        row.appendChild(del);
        trajWrap.appendChild(row);

        // Panel size + resulting mosaic size + total integration need the gear
        // preset (resolved async below).
        mosaicFillers.push((preset) => {
          if (!preset) return;
          const { wDeg, hDeg } = fovDeg(preset);
          const f = 1 - mosaic.overlapPct / 100;
          const scaleW = (mosaic.cols - 1) * wDeg * f + wDeg;
          const scaleH = (mosaic.rows - 1) * hDeg * f + hDeg;
          // "N panels × <panel size> → <mosaic size>": panel count times the
          // single-frame FOV, yielding the overall mosaic footprint.
          sub.textContent = `${tileCount} ${t('fovOverlay.mosaicPanels')} × ${formatFov(wDeg, hDeg)} → ${formatFov(scaleW, scaleH)}`;
          if (dso) {
            const recipe = recommendRecipe(dso, preset);
            totalEl.textContent = `${t('targets.results.integrationTotal')}: ${formatHours(recipe.totalHours * tileCount)}`;
          }
        });
      }

      // Score / FOV-fit / integration time need a gear preset (resolved async).
      this.planPreset(effectiveSetupId()).then((preset) => {
        for (const f of fillers) f(preset);
        for (const f of mosaicFillers) f(preset);
      });
    };

    renderTrajectories();

    dateInput.addEventListener('change', () => {
      plan.nightOf = dateInput.value || null;
      this.plansStore.updatePlanSettings(plan.id, plan.nightOf, plan.setupId, plan.lat, plan.lon);
      renderTrajectories();
    });

    getGearSetups()
      .then((setups) => {
        planSetups = setups;
        if (setups.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = t('targets.gear.noSetup') ?? '—';
          setupSelect.appendChild(opt);
          setupControls.refresh();
          return;
        }
        setupSelect.disabled = false;
        for (const s of setups) {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          setupSelect.appendChild(opt);
        }
        const eff = effectiveSetupId();
        setupSelect.value = eff && setups.some((s) => s.id === eff) ? eff : setups[0].id;
        setupControls.refresh();
        // Route through the shared setup-switch flow (same as the sky-view FOV
        // popup) so changing the setup with existing mosaics opens the Apply/Drop
        // confirmation modal instead of silently breaking them. The modal's apply
        // path reloads the plans store (replacing `plan`), so re-render the whole
        // Targets view rather than just the trajectories.
        setupSelect.addEventListener('change', () => {
          requestSetupSwitch(plan, setupSelect.value || null, {
            onRevert: () => {
              setupSelect.value = plan.setupId ?? '';
            },
            onApplied: () => this.render(),
          });
        });
      })
      .catch(() => {});

    deleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const confirmed = await confirmPlanDelete(plan.name);
      if (!confirmed) return;
      await this.plansStore.deletePlan(plan.id);
      this.updatePlanBadge();
      this.render();
    });

    exportBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hasMosaics = (plan.mosaics?.length ?? 0) > 0;
      if (!currentWin || (currentInfos.length === 0 && !hasMosaics)) {
        showToast({ message: t('targets.plan.empty'), type: 'info', duration: 2000 });
        return;
      }
      const win = currentWin;
      const infos = currentInfos;
      const observer = this.getPlanObserverFor(plan);
      showToast({ message: t('settings.exportView.rendering'), type: 'info', duration: 2000 });
      try {
        const setupId = effectiveSetupId();
        const [fovSpecs, setup, preset] = await Promise.all([
          this.getSelectedFovSpecs(setupId),
          this.resolvePlanSetup(setupId),
          this.planPreset(setupId),
        ]);

        // Moon overlay for the PDF charts (same night/location for every page).
        const moon = observer ? this.buildMoonOverlay(observer.loc, win) : null;
        const moonShared = moon
          ? { moonCurve: moon.curve, moonPhaseIndex: moon.phaseIndex, moonIllum: moon.illum }
          : {};

        const targets: PlanPdfTarget[] = infos.map((i) => ({
          dso: i.dso,
          bestTimeUtc: i.bestTimeUtc,
          maxAltDeg: i.maxAltDeg,
          curve: i.curve,
          nightWin: win,
          mosaic: null,
          observationWindows:
            plan.entries.find((e) => e.id === i.entryId)?.observationWindows ?? [],
          ...moonShared,
          moonSepDeg: moon ? i.moonSepDeg : null,
        }));

        // One page per mosaic: trajectory from the centre + framed tile grid.
        if (observer && preset) {
          const { wDeg: tileW, hDeg: tileH } = fovDeg(preset);
          for (const m of plan.mosaics ?? []) {
            const tiles = plan.entries
              .filter((en) => en.mosaicId === m.id && en.ra != null && en.dec != null)
              .map((en) => ({ ra: en.ra as number, dec: en.dec as number }));
            const { maxAltDeg, atDate } = maxAltDuringWindow(
              m.centerRa,
              m.centerDec,
              observer.loc.latDeg,
              observer.loc.lonDeg,
              win.start,
              win.end,
              10,
            );
            const curve = sampleAltCurve(
              m.centerRa,
              m.centerDec,
              observer.loc.latDeg,
              observer.loc.lonDeg,
              win.start,
              win.end,
              10,
            );
            const realDso = m.dsoId ? getDSOById(m.dsoId) : null;
            const dso =
              realDso ?? this.customLocationDso(`mosaic:${m.id}`, m.centerRa, m.centerDec);
            if (!realDso && m.name) dso.displayName = m.name;
            const env = outlineFromGrid(m.cols, m.rows, tileW, tileH, m.overlapPct);
            targets.push({
              dso,
              bestTimeUtc: atDate,
              maxAltDeg,
              curve,
              nightWin: win,
              mosaic: { wDeg: env.wDeg, hDeg: env.hDeg, paDeg: m.paDeg, tiles },
              ...moonShared,
              moonSepDeg: moon ? this.moonSeparationAt(m.centerRa, m.centerDec, atDate) : null,
            });
          }
        }
        // Order matches the on-screen list: standalone objects follow the plan's
        // chosen sort (inherited from currentInfos above), then mosaic pages are
        // appended after them.

        const { renderPlanPdf } = await import('./export-render');
        const blob = await renderPlanPdf(this.skyMap, {
          planName: plan.name,
          targets,
          fovSpecs,
          header: {
            nightOf: plan.nightOf,
            latDeg: plan.lat ?? this.prefs.lat ?? null,
            lonDeg: plan.lon ?? this.prefs.lon ?? null,
          },
          setup,
        });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        downloadBlob(blob, `myastrosky-plan-${ts}.pdf`);
        showToast({ message: t('settings.exportView.success'), type: 'info', duration: 2500 });
      } catch (err) {
        reportUnknownRendererError('plan_pdf_failed', err, { planId: plan.id });
        showToast({ message: t('settings.exportView.error'), type: 'error', duration: 4000 });
      }
    });

    return details;
  }

  /** Width of the plan-row left column (DSO name/chips/details), kept in sync with the header spacer. */
  private static readonly PLAN_INFO_COL = 'w-52';
  /** Width of the chart's left axis-label gutter, kept in sync with the header spacer. */
  private static readonly PLAN_AXIS_GUTTER = 'w-7';
  /** Axis gutter width — wider when the moon icon needs a reserved strip left of the axis. */
  private static axisGutterWidth(moon: MoonOverlay | null): string {
    return moon ? 'w-8' : 'w-7';
  }

  /** Show-moon toggle for the plan trajectory charts (persisted in prefs). */
  private buildMoonToggle(rerender: () => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'flex items-center gap-1.5 text-base text-dim cursor-pointer w-fit';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gear-manage-checkbox';
    cb.checked = this.prefs.showMoon !== false;
    cb.addEventListener('change', () => {
      this.prefs.showMoon = cb.checked;
      savePrefs(this.prefs);
      rerender();
    });
    const txt = document.createElement('span');
    txt.textContent = t('targets.plan.showMoon');
    wrap.append(cb, txt);
    return wrap;
  }

  /**
   * "Sort by" dropdown for a plan's objects list. Reuses the Targets-search
   * sort-bar styling and shared i18n labels; persists the choice per plan and
   * re-renders so the list (and the exported PDF, which reads the same order)
   * reflect it.
   */
  private buildPlanSortBar(plan: Plan, rerender: () => void): HTMLElement {
    const bar = document.createElement('div');
    // `!mb-0`: the shared .targets-sort-bar carries a bottom margin for the search
    // grid; here the wrapping controls row owns that spacing instead.
    bar.className = 'targets-sort-bar !mb-0';
    const label = document.createElement('span');
    label.className = 'targets-sort-label';
    label.textContent = t('targets.sort.label');
    const select = document.createElement('select');
    select.className = 'targets-sort-select';
    const opts: [PlanSortKey, () => string][] = [
      ['transit', () => t('targets.sort.transit')],
      ['altitude', () => t('targets.sort.altitude')],
      ['rating', () => t('targets.sort.rating')],
      ['magnitude', () => t('targets.sort.magnitude')],
      ['size', () => t('targets.sort.size')],
      ['name', () => t('targets.sort.name')],
      ['difficulty', () => t('targets.sort.difficulty')],
      ['window', () => t('targets.sort.window')],
    ];
    const current = (plan.sortBy ?? 'transit') as PlanSortKey;
    for (const [value, labelFn] of opts) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = labelFn();
      opt.selected = value === current;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this.plansStore.setPlanSort(plan.id, select.value as PlanSortKey);
      rerender();
    });
    bar.append(label, select);
    return bar;
  }

  /** Moonrise/moonset crossings (alt = 0) within the night window, interpolated. */
  private moonEventsInWindow(
    loc: ObserverLocation,
    win: { start: Date; end: Date },
  ): { type: 'rise' | 'set'; time: Date }[] {
    const curve = sampleMoonAltCurve(loc.latDeg, loc.lonDeg, win.start, win.end, 5);
    const events: { type: 'rise' | 'set'; time: Date }[] = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1],
        b = curve[i];
      if (a.altDeg < 0 === b.altDeg < 0) continue; // no horizon crossing
      const frac = a.altDeg / (a.altDeg - b.altDeg); // linear interp to alt = 0
      const tMs = a.time.getTime() + frac * (b.time.getTime() - a.time.getTime());
      events.push({ type: b.altDeg >= a.altDeg ? 'rise' : 'set', time: new Date(tMs) });
    }
    return events;
  }

  /**
   * Toolbar strip showing the night window (start/end) and, when the Moon rises
   * during that window, its rise time next to a phase icon matching the sky map's
   * Moon marker. Null before any search has run (no location/date to anchor on).
   */
  private buildNightInfoBar(): HTMLElement | null {
    if (!this.lastLocation || !this.lastDateNight) return null;
    const win = this.nightWindow(this.lastLocation, this.lastDateNight);

    const bar = document.createElement('div');
    bar.className = 'flex items-center gap-8 ml-8';
    bar.appendChild(this.inlineTimeStat(t('targets.plan.nightStart'), win.start));
    bar.appendChild(this.inlineTimeStat(t('targets.plan.nightEnd'), win.end));

    const riseEvent = this.moonEventsInWindow(this.lastLocation, win).find(
      (e) => e.type === 'rise',
    );
    if (riseEvent) {
      const midJd = dateToJD(new Date((win.start.getTime() + win.end.getTime()) / 2));
      const { phaseIndex } = moonPhase(midJd);
      const moonriseGroup = document.createElement('div');
      moonriseGroup.className = 'flex items-center gap-2';
      const icon = document.createElement('span');
      icon.className = 'block shrink-0';
      icon.innerHTML = moonPhaseIconSvg(phaseIndex);
      moonriseGroup.appendChild(icon);
      moonriseGroup.appendChild(this.inlineTimeStat(t('targets.plan.moonrise'), riseEvent.time));
      bar.appendChild(moonriseGroup);
    }

    return bar;
  }

  /**
   * A caption-then-time pair on one line (e.g. "Night start 22:14"), used in the
   * search toolbar. Caption font size and caption-to-value gap match the
   * "Sort by"/its dropdown (.targets-sort-label / .targets-sort-bar gap-4).
   */
  private inlineTimeStat(caption: string, time: Date): HTMLElement {
    const box = document.createElement('div');
    box.className = 'flex items-baseline gap-4';
    const cap = document.createElement('span');
    cap.className = 'text-base text-label';
    cap.textContent = caption;
    const tm = document.createElement('span');
    tm.className = 'text-sub text-bright font-medium';
    tm.textContent = formatTime(time);
    box.append(cap, tm);
    return box;
  }

  /** A caption-over-time stack (e.g. "Night start" / "22:14"), used in the header. */
  private timeStack(caption: string, time: Date, align: 'start' | 'center' | 'end'): HTMLElement {
    const alignCls =
      align === 'end'
        ? 'items-end text-right'
        : align === 'center'
          ? 'items-center text-center'
          : 'items-start text-left';
    const box = document.createElement('div');
    box.className = `flex flex-col leading-tight ${alignCls}`;
    const cap = document.createElement('span');
    cap.className = 'text-micro text-dim';
    cap.textContent = caption;
    const tm = document.createElement('span');
    tm.className = 'text-sub text-bright font-medium';
    tm.textContent = formatTime(time);
    box.append(cap, tm);
    return box;
  }

  /**
   * Keep the moon rise/set marker(s) on the same line as the night start/end
   * labels without overlapping them: after layout, clamp each marker's centre to
   * leave a margin from the start/end labels (and from each other). Re-runs on
   * resize / when the row becomes visible; self-disconnects once detached.
   */
  private spaceMoonMarkers(
    container: HTMLElement,
    startEl: HTMLElement,
    endEl: HTMLElement,
    markers: { el: HTMLElement; f: number }[],
  ): void {
    if (markers.length === 0) return;
    const MARGIN = 10; // px gap kept between labels
    const adjust = () => {
      const ca = container.getBoundingClientRect();
      if (ca.width <= 0) return; // still hidden/collapsed — wait for a resize
      const startRight = startEl.getBoundingClientRect().right - ca.left;
      const endLeft = endEl.getBoundingClientRect().left - ca.left;
      let prevRight = -Infinity;
      for (const m of markers) {
        const w = m.el.offsetWidth;
        let minC = startRight + MARGIN + w / 2;
        let maxC = endLeft - MARGIN - w / 2;
        if (minC > maxC) minC = maxC = (startRight + endLeft) / 2; // window too narrow
        let center = Math.min(Math.max(m.f * ca.width, minC), maxC);
        if (center - w / 2 < prevRight + MARGIN) center = prevRight + MARGIN + w / 2; // clear previous marker
        m.el.style.left = `${center.toFixed(1)}px`;
        prevRight = center + w / 2;
      }
    };
    const ro = new ResizeObserver(() => {
      if (!container.isConnected) {
        ro.disconnect();
        return;
      }
      adjust();
    });
    ro.observe(container);
  }

  /**
   * The night-start/night-end/moon-rise-set label row aligned to a
   * trajectory chart's x-axis: start (left), end (right), and moon markers
   * positioned at their horizon-crossing x, nudged via `spaceMoonMarkers` to
   * never overlap each other or the start/end labels. Returns the
   * flex-1 chart-area only — callers pair it with a gutter spacer matching
   * `axisGutterWidth(moon)` (and their own layout's other spacers) so it
   * lines up with the actual chart below. Shared by the plan-row timeline
   * header and the trajectory popup's timeline row.
   */
  private buildTimelineChartArea(
    win: { start: Date; end: Date },
    loc: ObserverLocation,
    moon: MoonOverlay | null,
  ): HTMLElement {
    const chartArea = document.createElement('div');
    chartArea.className = 'flex-1 min-w-0 relative h-8';

    const startEl = this.timeStack(t('targets.plan.nightStart'), win.start, 'start');
    startEl.classList.add('absolute', 'bottom-0', 'left-0');
    const endEl = this.timeStack(t('targets.plan.nightEnd'), win.end, 'end');
    endEl.classList.add('absolute', 'bottom-0', 'right-0');
    chartArea.append(startEl, endEl);

    // Moon marker(s) — only when the overlay is on (and the moon clears the horizon).
    if (moon) {
      const events = this.moonEventsInWindow(loc, win);
      // Same x-mapping as the chart (viewBox W=120 with a padX=2 left inset), so
      // a marker sits exactly above where the moon line meets the horizon.
      const W = 120,
        padX = 2;
      const span = win.end.getTime() - win.start.getTime() || 1;
      const xFrac = (d: Date) =>
        (padX + ((d.getTime() - win.start.getTime()) / span) * (W - padX)) / W;
      // Only when the moon actually rises/sets during the window — if it is up
      // (or down) the whole window there is no event time to show.
      const markers: { el: HTMLElement; f: number }[] = [];
      for (const ev of events.slice(0, 2)) {
        const f = Math.max(0, Math.min(1, xFrac(ev.time)));
        const caption = t(ev.type === 'rise' ? 'targets.plan.moonrise' : 'targets.plan.moonset');
        const marker = this.timeStack(caption, ev.time, 'center');
        marker.classList.add('absolute', 'bottom-0', 'whitespace-nowrap');
        marker.style.left = `${(f * 100).toFixed(1)}%`;
        marker.style.transform = 'translateX(-50%)';
        chartArea.appendChild(marker);
        markers.push({ el: marker, f });
      }
      // After layout, nudge each moon marker so it keeps a margin from the night
      // start/end labels (and from each other) instead of overlapping them.
      this.spaceMoonMarkers(chartArea, startEl, endEl, markers);
    }

    return chartArea;
  }

  private buildTimelineHeader(
    win: { start: Date; end: Date },
    loc: ObserverLocation,
    moon: MoonOverlay | null,
  ): HTMLElement {
    // Mirror the plan-row column layout so the night-start/end times sit exactly
    // over the start/end of the sparkline (the flex-1 chart column), accounting
    // for the axis-label gutter to the left of the plot.
    const header = document.createElement('div');
    header.className = 'flex items-end gap-3 pb-1';

    const infoSpacer = document.createElement('span');
    infoSpacer.className = `${TargetsView.PLAN_INFO_COL} shrink-0`;

    const gutterSpacer = document.createElement('span');
    gutterSpacer.className = `${TargetsView.axisGutterWidth(moon)} shrink-0`;

    const chartArea = this.buildTimelineChartArea(win, loc, moon);

    // Invisible clones of the row's trailing buttons (show-on-map + remove), to
    // reserve the same width so the start/end times line up with the chart ends.
    const navSpacer = document.createElement('span');
    navSpacer.className = 'btn-icon shrink-0 invisible';
    navSpacer.innerHTML = mapPinSvg;
    const removeSpacer = document.createElement('span');
    removeSpacer.className = 'btn-icon shrink-0 invisible';
    removeSpacer.innerHTML = trashSvg;

    header.appendChild(infoSpacer);
    header.appendChild(gutterSpacer);
    header.appendChild(chartArea);
    header.appendChild(navSpacer);
    header.appendChild(removeSpacer);
    return header;
  }

  /**
   * One plan target: a left column mirroring the recommend-target card (name,
   * type/constellation chips, and a collapsible meta section), the altitude
   * trajectory chart, a show-on-map button and a remove button. `applyPreset`
   * fills the gear-dependent fields (score, FOV-fit, integration time) once the
   * plan's setup resolves. `onDelete` is invoked when the remove button is
   * clicked (the caller owns the undo flow).
   */
  private buildPlanRow(
    planId: string,
    info: PlanTargetInfo,
    win: { start: Date; end: Date },
    effectiveSetupId: string | null,
    moon: MoonOverlay | null,
    onDelete: (rowEl: HTMLElement) => void,
  ): { row: HTMLElement; applyPreset: (preset: GearPreset | null) => void } {
    const { dso } = info;
    // border-0 zeroes every side (no preflight sets border-style/width), and
    // border-solid lets the list's divide-y add a 1px top divider on non-first
    // rows — without medium-width borders leaking onto the other sides.
    const row = document.createElement('div');
    row.className = 'flex items-start gap-3 py-3 border-0 border-solid';

    // ── Left column: name, chips, rating, meta (all shown), + collapsible filters ──
    const left = document.createElement('div');
    left.className = `${TargetsView.PLAN_INFO_COL} shrink-0 flex flex-col gap-1`;

    const titleEl = document.createElement('div');
    titleEl.className = 'target-card-title';
    if (dso.displayName) {
      titleEl.appendChild(
        Object.assign(document.createElement('span'), { textContent: dso.displayName }),
      );
      const idSpan = document.createElement('span');
      idSpan.className = 'target-card-catalog-id';
      idSpan.textContent = ' ' + (dso.catalogs[0] || dso.id);
      titleEl.appendChild(idSpan);
    } else {
      titleEl.textContent = dso.catalogs[0] || dso.id;
    }
    titleEl.title = dso.catalogs.join(' · ');
    left.appendChild(titleEl);

    const chips = document.createElement('div');
    chips.className = 'target-card-chips';
    const typeEl = document.createElement('div');
    typeEl.className = 'target-card-type';
    typeEl.textContent = dsoTypeLabel(dso.type);
    chips.appendChild(typeEl);
    if (dso.constellation) {
      const constEl = document.createElement('div');
      constEl.className = 'target-card-const';
      constEl.textContent = dso.constellation.toUpperCase();
      const constInfo = getConstellationInfos().find((c) => c.id === dso.constellation);
      if (constInfo) constEl.title = constInfo.name;
      chips.appendChild(constEl);
    }
    left.appendChild(chips);

    // Star rating below the chips, like the recommend card.
    if (dso.rating !== null) {
      const ratingEl = document.createElement('div');
      ratingEl.className = 'target-card-rating';
      ratingEl.title = t('targets.tooltips.rating');
      ratingEl.textContent = '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating);
      left.appendChild(ratingEl);
    }

    // Meta — always shown (no collapsible).
    const meta = document.createElement('div');
    meta.className = 'target-card-meta';
    meta.appendChild(
      this.metaItem(
        t('targets.results.maxAlt'),
        formatAlt(info.maxAltDeg),
        t('targets.tooltips.maxAlt'),
      ),
    );
    if (dso.mag !== null)
      meta.appendChild(this.metaItem('Mag', dso.mag.toFixed(1), t('targets.tooltips.mag')));
    if (dso.majAxis)
      meta.appendChild(
        this.metaItem(
          t('targets.results.size'),
          formatArcmin(dso.majAxis),
          t('targets.tooltips.size'),
        ),
      );
    const moonSep = moon ? this.moonSepMetaItem(info.moonSepDeg, moon.illum) : null;
    if (moonSep) meta.appendChild(moonSep);
    left.appendChild(meta);

    const meta2 = document.createElement('div');
    meta2.className = 'target-card-meta';
    if (dso.difficulty !== null) {
      const diffEl = this.metaItem(
        t('targets.sort.difficulty'),
        '◆'.repeat(dso.difficulty) + '◇'.repeat(5 - dso.difficulty),
        t('targets.tooltips.difficulty'),
      );
      diffEl.querySelector('.target-meta-value')!.className =
        'target-meta-value target-card-difficulty';
      meta2.appendChild(diffEl);
    }
    const scoreItem = this.metaItem(t('targets.results.score'), '—', t('targets.tooltips.score'));
    const fovItem = this.metaItem(t('targets.results.fov'), '—', t('targets.tooltips.fov'));
    meta2.appendChild(scoreItem);
    meta2.appendChild(fovItem);
    // Live framing angle (updated when the frame is rotated on the map).
    const entryPa =
      this.plansStore.plans.find((p) => p.id === planId)?.entries.find((e) => e.id === info.entryId)
        ?.paDeg ?? null;
    const paItem = this.metaItem(
      t('fovOverlay.angleLabel'),
      entryPa != null ? formatPaDeg(entryPa) : '—',
      t('fovOverlay.angleHelp'),
    );
    meta2.appendChild(paItem);
    this.paSpans.set(info.entryId, paItem.querySelector('.target-meta-value')!);
    left.appendChild(meta2);

    const totalEl = document.createElement('div');
    totalEl.className = 'target-integration-total';
    totalEl.textContent = `${t('targets.results.integrationTotal')}: —`;
    left.appendChild(totalEl);

    // Collapsible: suggested filters (populated once the gear preset resolves).
    const filtersDetails = document.createElement('details');
    filtersDetails.className = 'target-details';
    const filtersSummary = document.createElement('summary');
    filtersSummary.textContent = t('targets.results.filtersTitle');
    filtersDetails.appendChild(filtersSummary);
    const filterList = document.createElement('div');
    filterList.className = 'target-filter-list';
    filtersDetails.appendChild(filterList);
    left.appendChild(filtersDetails);

    // ── Trajectory chart + observation windows ──
    const chartWrap = this.buildPlanChart(info.curve, win, info.bestTimeUtc, moon);
    const chartBox = chartWrap.querySelector<HTMLElement>('.plan-chart-box');

    // Column wrapping the chart so the observation-window toolbar sits beneath it.
    const chartCol = document.createElement('div');
    chartCol.className = 'flex-1 min-w-0 flex flex-col';
    chartCol.appendChild(chartWrap);
    if (chartBox) {
      const windowUi = this.buildObservationWindowUi(planId, info.entryId, chartBox, win);
      chartCol.appendChild(windowUi.toolbar);
    }

    // Show-on-map: same behaviour as the recommend card (free frame on target).
    const navBtn = this.iconActionBtn(mapPinSvg, t('targets.plan.showOnMap'));
    navBtn.classList.add('shrink-0');
    navBtn.addEventListener('click', () => {
      this.onNavigate(dso.ra, dso.dec, effectiveSetupId);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-icon btn-icon--danger shrink-0';
    removeBtn.title = t('targets.plan.remove');
    removeBtn.innerHTML = trashSvg;
    removeBtn.addEventListener('click', () => {
      onDelete(row);
    });

    row.appendChild(left);
    row.appendChild(chartCol);
    row.appendChild(navBtn);
    row.appendChild(removeBtn);

    const applyPreset = (preset: GearPreset | null): void => {
      if (!preset) return;
      const { score, fovFitScore } = scoreDso(dso, preset, info.maxAltDeg, {
        ignoreFovFit: this.prefs.includeOversized ?? false,
        minAltDeg: this.prefs.minAltDeg ?? 20,
      });
      scoreItem.querySelector('.target-meta-value')!.textContent = `${Math.round(score * 100)}%`;
      fovItem.querySelector('.target-meta-value')!.textContent =
        `${Math.round(fovFitScore * 100)}%`;
      const recipe = recommendRecipe(dso, preset);
      totalEl.textContent = `${t('targets.results.integrationTotal')}: ${formatHours(recipe.totalHours)}`;
      filterList.innerHTML = '';
      for (const f of recipe.filters) {
        const fr = document.createElement('div');
        fr.className = 'target-filter-row';
        const badge = createFilterBadge(f.name);
        const detail = document.createElement('span');
        detail.className = 'target-filter-detail';
        detail.textContent = `${f.count} × ${f.subSeconds}s = ${formatHours(f.hours)}`;
        fr.appendChild(badge);
        fr.appendChild(detail);
        filterList.appendChild(fr);
      }
    };

    return { row, applyPreset };
  }

  /** Filters offered in the observation-window filter picker. */
  private static readonly OBS_WINDOW_FILTERS = [
    'L',
    'R',
    'G',
    'B',
    'RGB',
    'Ha',
    'OIII',
    'SII',
    'Dual-Band',
  ];

  /** Chain-link icon (like the width/height "link" constraint in photo editors),
   * used for the observation-window "snap dragging to whole frames" toggle. */
  private static readonly LINK_ICON_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6"/><path d="M10 7H7a5 5 0 0 0 0 10h3"/><path d="M14 7h3a5 5 0 0 1 0 10h-3"/></svg>';

  /** Whether the one-time document handlers that close open time menus are wired. */
  private timeMenusWired = false;

  /** Close every open time-picker menu in the document (except `except`). */
  private closeAllTimeMenus(except?: HTMLElement): void {
    document.querySelectorAll<HTMLElement>('.targets-time-menu.open').forEach((el) => {
      if (el !== except) el.classList.remove('open');
    });
  }

  /**
   * Reusable time picker: a styled button that opens a menu of valid HH:MM
   * options. Not a native `<input type="time">` — its scroll-wheel picker
   * ignores `step` and renders a wrapped night range unreliably. Shared by the
   * targets-search observation window and the per-object observation windows, so
   * the two never drift apart. `setValue` updates the shown time without firing
   * `onSelect` (e.g. while a window is dragged on the chart).
   */
  private buildTimeDropdown(opts: {
    value: string;
    options: string[];
    ariaLabel: string;
    includeClear?: boolean;
    clearLabel?: string;
    onSelect: (value: string) => void;
  }): { el: HTMLElement; setValue: (v: string) => void } {
    if (!this.timeMenusWired) {
      this.timeMenusWired = true;
      document.addEventListener('click', () => this.closeAllTimeMenus());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeAllTimeMenus();
      });
    }

    const group = document.createElement('div');
    group.className = 'targets-time-field';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'targets-time-input';
    toggle.setAttribute('aria-label', opts.ariaLabel);
    toggle.textContent = opts.value || '--:--';

    const menu = document.createElement('div');
    menu.className = 'targets-time-menu';

    const selectValue = (value: string): void => {
      toggle.textContent = value || '--:--';
      menu.classList.remove('open');
      opts.onSelect(value);
    };

    if (opts.includeClear) {
      const clearItem = document.createElement('button');
      clearItem.type = 'button';
      clearItem.className = 'targets-time-menu-item targets-time-menu-clear';
      clearItem.textContent = opts.clearLabel ?? '';
      clearItem.addEventListener('click', () => selectValue(''));
      menu.appendChild(clearItem);
    }

    for (const time of opts.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'targets-time-menu-item';
      item.textContent = time;
      item.addEventListener('click', () => selectValue(time));
      menu.appendChild(item);
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      this.closeAllTimeMenus();
      if (willOpen) menu.classList.add('open');
    });

    group.appendChild(toggle);
    group.appendChild(menu);
    return {
      el: group,
      setValue: (v: string) => {
        toggle.textContent = v || '--:--';
      },
    };
  }

  /**
   * Interactive observation-window layer for a standalone plan row. Renders
   * draggable shaded bands over the trajectory (inside `chartBox`) and a toolbar
   * beneath it — an "add" button plus one editor row per window: colour swatch,
   * filter picker, editable start/end clock times, read-only duration, editable
   * single-frame duration, a snap-to-frame toggle, and a remove button. Window
   * edges are stored as fractions of the night window; edits persist (debounced)
   * via the plans store.
   */
  private buildObservationWindowUi(
    planId: string,
    entryId: string,
    chartBox: HTMLElement,
    win: { start: Date; end: Date },
  ): { toolbar: HTMLElement } {
    // Geometry must match buildAltChart's SVG viewBox (W×H, padX/padY insets).
    const W = 120,
      H = 53,
      padX = 2,
      padY = 7;
    const nightSpanMs = win.end.getTime() - win.start.getTime() || 1;
    const fracToPct = (f: number) => ((padX + f * (W - padX)) / W) * 100;
    const readVar = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v);

    const entry = () =>
      this.plansStore.plans.find((p) => p.id === planId)?.entries.find((e) => e.id === entryId);
    // Working copy (source of truth is the store cache, snapshotted on build).
    const windows: ObservationWindow[] = (entry()?.observationWindows ?? []).map((w) => ({ ...w }));

    const knownFilterMap = new Map<string, string>();
    for (const name of TargetsView.OBS_WINDOW_FILTERS) knownFilterMap.set(name.toLowerCase(), name);

    const persist = () => {
      this.plansStore.setEntryObservationWindows(
        planId,
        entryId,
        windows.map((w) => ({ ...w })),
      );
    };

    // Snap step as a fraction of the night, or 0 when the window has no frame
    // duration / snap is off (→ free drag).
    const stepFrac = (w: ObservationWindow): number =>
      w.snap && w.frameSeconds ? (w.frameSeconds * 1000) / nightSpanMs : 0;

    const layer = document.createElement('div');
    layer.className = 'obs-window-layer';
    layer.style.top = `${(padY / H) * 100}%`;
    layer.style.bottom = `${(padY / H) * 100}%`;
    chartBox.appendChild(layer);

    // Layout: the "+ window" button on the left, at the top level with the first
    // row; the editor rows form a grid to its right so every field lines up in a
    // column across rows (each row is `display:contents`, its cells flow into the
    // shared grid columns).
    const toolbar = document.createElement('div');
    toolbar.className = 'obs-window-toolbar mt-2 flex items-start gap-2';
    const rowsCol = document.createElement('div');
    rowsCol.className = 'obs-window-rows';

    const timeOptions = windowTimeOptions(win, 15);
    const bandEls = new Map<string, HTMLElement>();
    // Per-window row field refs, so a drag / time edit updates its counterparts.
    const rowRefs = new Map<
      string,
      {
        setStart: (v: string) => void;
        setEnd: (v: string) => void;
        dur: HTMLElement;
        refreshFrames: () => void;
      }
    >();

    const positionBand = (band: HTMLElement, w: ObservationWindow): void => {
      band.style.left = `${fracToPct(w.startFrac)}%`;
      band.style.width = `${fracToPct(w.endFrac) - fracToPct(w.startFrac)}%`;
    };
    const paintBand = (w: ObservationWindow): void => {
      const band = bandEls.get(w.id);
      if (band) band.style.background = toBandFill(resolveWindowColor(w, readVar));
    };
    // Push the window's current fracs into its row's time pickers + duration + frame count.
    const syncRow = (w: ObservationWindow): void => {
      const refs = rowRefs.get(w.id);
      if (!refs) return;
      refs.setStart(fracToClock(w.startFrac, win));
      refs.setEnd(fracToClock(w.endFrac, win));
      refs.dur.textContent = formatWindowDuration(windowDurationMs(w, nightSpanMs));
      refs.refreshFrames();
    };

    // Pointer-drag on a band edge ('l'/'r') or the whole band ('move').
    const wireDrag = (el: HTMLElement, w: ObservationWindow, mode: 'l' | 'r' | 'move'): void => {
      el.addEventListener('pointerdown', (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = chartBox.getBoundingClientRect();
        if (rect.width === 0) return;
        // px → time-fraction: the box spans W svg units, of which (W-padX) is plot.
        const fracPerPx = W / ((W - padX) * rect.width);
        const startX = ev.clientX;
        const s0 = w.startFrac;
        const e0 = w.endFrac;
        const width = e0 - s0;
        const band = bandEls.get(w.id);
        el.setPointerCapture(ev.pointerId);
        const onMove = (m: PointerEvent) => {
          let dFrac = (m.clientX - startX) * fracPerPx;
          const step = stepFrac(w);
          if (step > 0) dFrac = Math.round(dFrac / step) * step; // snap to whole frames
          if (mode === 'l') {
            w.startFrac = Math.max(0, Math.min(e0 - MIN_WINDOW_FRAC, s0 + dFrac));
          } else if (mode === 'r') {
            w.endFrac = Math.min(1, Math.max(s0 + MIN_WINDOW_FRAC, e0 + dFrac));
          } else {
            const ns = Math.max(0, Math.min(1 - width, s0 + dFrac));
            w.startFrac = ns;
            w.endFrac = ns + width;
          }
          if (band) positionBand(band, w);
          syncRow(w);
        };
        const onUp = (u: PointerEvent) => {
          el.releasePointerCapture(u.pointerId);
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          persist();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });
    };

    const renderBands = (): void => {
      layer.innerHTML = '';
      bandEls.clear();
      for (const w of windows) {
        const band = document.createElement('div');
        band.className = 'obs-window-band';
        band.title = w.filter ? w.filter : t('targets.plan.obsWindowTitle');
        bandEls.set(w.id, band);
        positionBand(band, w);
        band.style.background = toBandFill(resolveWindowColor(w, readVar));
        const lh = document.createElement('div');
        lh.className = 'obs-window-handle obs-window-handle-l';
        const rh = document.createElement('div');
        rh.className = 'obs-window-handle obs-window-handle-r';
        band.append(lh, rh);
        wireDrag(band, w, 'move');
        wireDrag(lh, w, 'l');
        wireDrag(rh, w, 'r');
        layer.appendChild(band);
      }
    };

    // A small labelled time picker (reuses the shared targets-search widget).
    const timeGroup = (
      labelKey: string,
      value: string,
      onPick: (f: number) => void,
    ): { el: HTMLElement; setValue: (v: string) => void } => {
      const group = document.createElement('div');
      group.className = 'obs-window-time-group flex items-center gap-1 shrink-0';
      const lbl = document.createElement('span');
      lbl.className = 'obs-window-time-label text-micro text-dim';
      lbl.textContent = t(labelKey);
      const dd = this.buildTimeDropdown({
        value,
        options: timeOptions,
        ariaLabel: t(labelKey),
        onSelect: (v) => {
          const f = clockToFrac(v, win);
          if (f != null) onPick(f);
        },
      });
      group.append(lbl, dd.el);
      return { el: group, setValue: dd.setValue };
    };

    const renderRows = (): void => {
      rowsCol.innerHTML = '';
      rowRefs.clear();
      for (const w of windows) {
        // `contents` so the row's cells flow directly into the shared grid columns.
        const rowEl = document.createElement('div');
        rowEl.className = 'obs-window-row contents';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'obs-window-color';
        colorInput.title = t('targets.plan.obsWindowColor');
        colorInput.value = cssColorToHex(resolveWindowColor(w, readVar));
        colorInput.addEventListener('input', () => {
          w.color = colorInput.value;
          paintBand(w);
          persist();
        });

        const field = buildIntegrationFilterField({
          initialValue: w.filter ?? '',
          knownFilterMap,
          placeholder: t('targets.plan.obsWindowFilter'),
          tooltip: t('targets.plan.obsWindowFilter'),
          onSelect: (value: string) => {
            const v = value.trim();
            w.filter = v ? v : null;
            // If the colour still derives from the filter, follow the new filter.
            if (!w.color) {
              paintBand(w);
              colorInput.value = cssColorToHex(resolveWindowColor(w, readVar));
            }
            persist();
          },
        });
        field.el.classList.add('obs-window-filter');

        // Editable start / end clock times (shared time-picker widget), then the
        // read-only duration kept next to the times.
        const startG = timeGroup(
          'targets.plan.obsWindowFrom',
          fracToClock(w.startFrac, win),
          (f) => {
            w.startFrac = Math.min(f, w.endFrac - MIN_WINDOW_FRAC);
            const band = bandEls.get(w.id);
            if (band) positionBand(band, w);
            syncRow(w);
            persist();
          },
        );
        const endG = timeGroup('targets.plan.obsWindowTo', fracToClock(w.endFrac, win), (f) => {
          w.endFrac = Math.max(f, w.startFrac + MIN_WINDOW_FRAC);
          const band = bandEls.get(w.id);
          if (band) positionBand(band, w);
          syncRow(w);
          persist();
        });

        const dur = document.createElement('span');
        dur.className =
          'obs-window-duration text-micro text-dim justify-self-end whitespace-nowrap';
        dur.title = t('targets.plan.obsWindowDuration');
        dur.textContent = formatWindowDuration(windowDurationMs(w, nightSpanMs));

        // Frames read like the photo metadata: "N × [sub] s". Each part is its own
        // grid cell so the sub input (and the × and s) line up in columns across
        // rows. N is derived from duration ÷ sub; the N and × cells are blank
        // until a sub duration is entered.
        const framesN = document.createElement('span');
        framesN.className = 'text-micro text-dim justify-self-end whitespace-nowrap';
        const oper = document.createElement('span');
        oper.className = 'integration-operator justify-self-center';
        const subInput = document.createElement('input');
        subInput.type = 'number';
        subInput.min = '1';
        subInput.className = 'tag-input integration-input obs-window-frame';
        subInput.title = t('targets.plan.obsWindowFrame');
        subInput.value = w.frameSeconds != null ? String(w.frameSeconds) : '';
        const unit = document.createElement('span');
        unit.className = 'integration-unit';
        unit.textContent = t('targets.plan.obsWindowFrameUnit');
        const refreshFrames = (): void => {
          const has = w.frameSeconds != null && w.frameSeconds > 0;
          const n = framesInWindow(w, nightSpanMs);
          framesN.textContent = has && n != null ? String(n) : '';
          oper.textContent = has ? '×' : '';
        };
        subInput.addEventListener('change', () => {
          const n = Number(subInput.value);
          w.frameSeconds = Number.isFinite(n) && n > 0 ? n : null;
          if (!w.frameSeconds) subInput.value = '';
          refreshFrames();
          persist();
        });
        refreshFrames();

        rowRefs.set(w.id, {
          setStart: startG.setValue,
          setEnd: endG.setValue,
          dur,
          refreshFrames,
        });

        // Link/constraint toggle: when on, dragging snaps to whole single-frame steps.
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        const setLinkClass = (): void => {
          linkBtn.className = `${w.snap ? 'btn-icon--active' : 'btn-icon'} obs-window-iconbtn obs-window-link`;
        };
        setLinkClass();
        linkBtn.title = t('targets.plan.obsWindowSnap');
        linkBtn.innerHTML = TargetsView.LINK_ICON_SVG;
        linkBtn.addEventListener('click', () => {
          w.snap = !w.snap;
          setLinkClass();
          persist();
        });

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn-icon btn-icon--danger obs-window-iconbtn';
        rm.title = t('targets.plan.obsWindowRemove');
        rm.innerHTML = trashSvg;
        rm.addEventListener('click', () => {
          const idx = windows.findIndex((x) => x.id === w.id);
          if (idx >= 0) windows.splice(idx, 1);
          renderBands();
          renderRows();
          persist();
        });

        // Order must match the grid columns in the `obs-window-rows` shortcut.
        rowEl.append(
          colorInput,
          field.el,
          startG.el,
          endG.el,
          dur,
          framesN,
          oper,
          subInput,
          unit,
          linkBtn,
          rm,
        );
        rowsCol.appendChild(rowEl);
      }
    };

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-icon obs-window-add';
    addBtn.textContent = t('targets.plan.obsWindowAdd');
    addBtn.addEventListener('click', () => {
      windows.push(newObservationWindow());
      renderBands();
      renderRows();
      persist();
    });
    toolbar.append(addBtn, rowsCol);

    renderBands();
    renderRows();

    return { toolbar };
  }

  /**
   * Trajectory chart wrapper for a plan row: the SVG plot plus the gutter
   * graduations and the HTML overlay labels (max/min altitude, transit). Shared
   * by standalone-target rows and mosaic rows (the SVG is non-uniformly scaled,
   * so all text lives in HTML overlays positioned by the chart's fractions).
   */
  private buildPlanChart(
    curve: AltSample[],
    win: { start: Date; end: Date },
    bestTimeUtc: Date,
    moon: MoonOverlay | null,
    heightPx = 180,
  ): HTMLElement {
    // Layout: [axis-label gutter] [plot]. The graduations live in the gutter,
    // to the left of the axis, so they never overlap the trajectory.
    const chart = this.buildAltChart(curve, win, bestTimeUtc, moon, heightPx);
    const chartWrap = document.createElement('div');
    chartWrap.className = 'flex-1 min-w-0 flex';

    const gutter = document.createElement('div');
    // When the moon is shown the gutter widens and the graduations shift left to
    // clear the moon-phase icon, which is pinned just left of the axis.
    gutter.className = `relative ${TargetsView.axisGutterWidth(moon)} shrink-0`;
    const tickRight = moon ? 'right-3' : 'right-1';
    // Left vertical-axis graduations (20/40/60/80°), centered on their gridlines.
    for (const tick of chart.ticks) {
      const tickLab = document.createElement('span');
      tickLab.className = `absolute ${tickRight} text-micro text-dim leading-none -translate-y-1/2 pointer-events-none`;
      tickLab.style.top = `${(tick.frac * 100).toFixed(1)}%`;
      tickLab.textContent = tick.label;
      gutter.appendChild(tickLab);
    }

    const chartBox = document.createElement('div');
    chartBox.className = 'relative flex-1 min-w-0 plan-chart-box';
    chartBox.appendChild(chart.svg);
    // Moon-phase icon pinned just left of the axis (fixed x), at the moon's
    // altitude where its trajectory meets the left edge. Anchored to the axis
    // line itself — inset by padX inside the SVG (padX=2, W=120 → 1.667%) — with
    // its right edge ~2px to its left, so the gap to the axis is consistent.
    if (moon && chart.moonIconYFrac !== null) {
      const icon = document.createElement('span');
      icon.className = 'absolute block pointer-events-none';
      icon.style.left = '1.667%';
      icon.style.top = `${(chart.moonIconYFrac * 100).toFixed(1)}%`;
      icon.style.transform = 'translate(calc(-100% - 2px), -50%)';
      icon.title = t('targets.plan.moonLegend');
      icon.innerHTML = moonPhaseIconSvg(moon.phaseIndex);
      chartBox.appendChild(icon);
    }

    chartWrap.appendChild(gutter);
    chartWrap.appendChild(chartBox);

    if (chart.hiFrac !== null) {
      // Max-altitude label sits just above its reference line.
      const maxLab = document.createElement('span');
      maxLab.className = 'absolute right-1 text-micro text-dim leading-none pointer-events-none';
      maxLab.style.top = `${(chart.hiFrac * 100).toFixed(1)}%`;
      maxLab.style.transform = 'translateY(calc(-100% - 2px))';
      maxLab.textContent = formatAlt(chart.hi);
      chartBox.appendChild(maxLab);
    }
    if (chart.loFrac !== null && chart.loFrac !== chart.hiFrac) {
      // Min-altitude label sits just below its reference line.
      const minLab = document.createElement('span');
      minLab.className = 'absolute right-1 text-micro text-dim leading-none pointer-events-none';
      minLab.style.top = `${(chart.loFrac * 100).toFixed(1)}%`;
      minLab.style.transform = 'translateY(2px)';
      minLab.textContent = formatAlt(chart.lo);
      chartBox.appendChild(minLab);
    }
    if (chart.transitFrac !== null) {
      // HTML overlays (the SVG is non-uniformly scaled, which would distort text):
      // "Transit" above the line and the transit hour below it.
      const transitX = `${(chart.transitFrac * 100).toFixed(1)}%`;
      // Always centred over the transit line — including when it sits on the
      // start/end axis.
      const transitShift = 'translateX(-50%)';
      const tl = document.createElement('span');
      tl.className =
        'absolute top-0 text-micro text-dim leading-none px-0.5 bg-card whitespace-nowrap pointer-events-none';
      tl.style.left = transitX;
      tl.style.transform = transitShift;
      tl.textContent = t('targets.plan.transit');
      chartBox.appendChild(tl);

      const th = document.createElement('span');
      th.className =
        'absolute bottom-0 text-micro text-dim leading-none px-0.5 bg-card whitespace-nowrap pointer-events-none';
      th.style.left = transitX;
      th.style.transform = transitShift;
      th.textContent = formatTime(bestTimeUtc);
      chartBox.appendChild(th);
    }

    return chartWrap;
  }

  /**
   * Altitude-trajectory chart across the night window. The vertical axis is
   * fixed at 0–90° so all objects share the same scale. Two dashed reference
   * lines mark the object's actual min and max altitude for the night, and a
   * dashed vertical line marks the transit. Returns the object's altitude
   * extremes and the height/width fractions used to place HTML overlay labels
   * (the SVG itself is non-uniformly scaled, so text is drawn in HTML instead).
   */
  private buildAltChart(
    curve: AltSample[],
    win: { start: Date; end: Date },
    transitTime: Date,
    moon: MoonOverlay | null,
    heightPx = 180,
  ): {
    svg: SVGSVGElement;
    lo: number;
    hi: number;
    hiFrac: number | null;
    loFrac: number | null;
    transitFrac: number | null;
    moonIconYFrac: number | null;
    ticks: { label: string; frac: number }[];
  } {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 120,
      H = 53,
      padY = 7,
      padX = 2;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'block w-full');
    svg.style.height = `${heightPx}px`;
    if (curve.length === 0)
      return {
        svg,
        lo: 0,
        hi: 0,
        hiFrac: null,
        loFrac: null,
        transitFrac: null,
        moonIconYFrac: null,
        ticks: [],
      };

    const span = win.end.getTime() - win.start.getTime() || 1;
    // Fixed 0–90° Y scale so all objects are comparable.
    const lo = 0,
      hi = 90,
      range = 90;
    const usableH = H - 2 * padY;

    // The plot is inset by padX so the left axis (and a transit line at the
    // window start) sits fully inside the viewBox instead of being clipped.
    const xAt = (d: Date) => padX + ((d.getTime() - win.start.getTime()) / span) * (W - padX);
    const yAt = (alt: number) => {
      const a = Math.max(lo, Math.min(hi, alt));
      return padY + (1 - (a - lo) / range) * usableH;
    };

    // Left-axis graduations: faint gridlines at 0/20/40/60/80° (labels drawn in HTML).
    const TICK_DEGS = [0, 20, 40, 60, 80];
    for (const deg of TICK_DEGS) {
      const g = document.createElementNS(NS, 'line');
      const y = yAt(deg);
      g.setAttribute('x1', String(padX));
      g.setAttribute('x2', String(W));
      g.setAttribute('y1', String(y));
      g.setAttribute('y2', String(y));
      g.setAttribute('class', 'stroke-[var(--border-input)]');
      g.setAttribute('stroke-width', '0.5');
      g.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(g);
    }
    const ticks = TICK_DEGS.map((deg) => ({ label: formatAlt(deg), frac: yAt(deg) / H }));

    // Left vertical axis — always present, so every chart has a consistent frame.
    const axis = document.createElementNS(NS, 'line');
    axis.setAttribute('x1', String(padX));
    axis.setAttribute('x2', String(padX));
    axis.setAttribute('y1', String(padY));
    axis.setAttribute('y2', String(H - padY));
    axis.setAttribute('class', 'stroke-[var(--border-input)]');
    axis.setAttribute('stroke-width', '1');
    axis.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(axis);

    // Object's actual altitude extremes (for reference lines and labels).
    const alts = curve.map((s) => s.altDeg);
    const objLo = Math.max(0, Math.min(...alts));
    const objHi = Math.max(...alts);

    const mkRefLine = (y: number) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', String(padX));
      l.setAttribute('x2', String(W));
      l.setAttribute('y1', String(y));
      l.setAttribute('y2', String(y));
      l.setAttribute('class', 'stroke-[var(--text-dim)]');
      l.setAttribute('stroke-width', '1');
      l.setAttribute('stroke-dasharray', '3 3');
      l.setAttribute('vector-effect', 'non-scaling-stroke');
      return l;
    };
    svg.appendChild(mkRefLine(yAt(objHi)));
    svg.appendChild(mkRefLine(yAt(objLo)));

    // Moon trajectory — drawn before the object curve so the accent object line
    // stays visually dominant. Thin, dashed, muted. Returns the y-fraction of the
    // moon's altitude at the window start so the phase icon can be pinned to the
    // left axis (a fixed spot), instead of wandering with the culmination point.
    let moonIconYFrac: number | null = null;
    if (moon && moon.curve.length > 0) {
      const mPts = moon.curve.map((s) => `${xAt(s.time).toFixed(1)},${yAt(s.altDeg).toFixed(1)}`);
      const mLine = document.createElementNS(NS, 'polyline');
      mLine.setAttribute('points', mPts.join(' '));
      mLine.setAttribute('class', 'fill-none stroke-[var(--moon-curve)]');
      mLine.setAttribute('stroke-width', '1');
      mLine.setAttribute('stroke-dasharray', '2 2');
      mLine.setAttribute('stroke-linejoin', 'round');
      mLine.setAttribute('stroke-linecap', 'round');
      mLine.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(mLine);
      moonIconYFrac = yAt(moon.curve[0].altDeg) / H; // altitude at the left edge
    }

    const pts = curve.map((s) => `${xAt(s.time).toFixed(1)},${yAt(s.altDeg).toFixed(1)}`);

    // Light fill under the trajectory, down to the object's min-altitude line.
    const yMinLine = yAt(objLo);
    const area = document.createElementNS(NS, 'path');
    area.setAttribute(
      'd',
      `M${pts[0].split(',')[0]},${yMinLine} L${pts.join(' L')} L${W},${yMinLine} Z`,
    );
    area.setAttribute('class', 'fill-[var(--accent-fill-sm)] stroke-none');
    svg.appendChild(area);

    // The trajectory curve itself.
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('class', 'fill-none stroke-[var(--accent-border)]');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    // Transit vertical dashed line (the "Transit" label is rendered in HTML).
    let transitFrac: number | null = null;
    const tFrac = (transitTime.getTime() - win.start.getTime()) / span;
    if (tFrac >= 0 && tFrac <= 1) {
      const tx = xAt(transitTime);
      // Fraction of the SVG width (accounts for the padX inset) so the HTML
      // overlay labels line up with the drawn line.
      transitFrac = tx / W;
      const vLine = document.createElementNS(NS, 'line');
      vLine.setAttribute('x1', tx.toFixed(1));
      vLine.setAttribute('x2', tx.toFixed(1));
      vLine.setAttribute('y1', String(padY));
      vLine.setAttribute('y2', String(H - padY));
      vLine.setAttribute('class', 'stroke-[var(--text-dim)]');
      vLine.setAttribute('stroke-width', '1');
      vLine.setAttribute('stroke-dasharray', '2 2');
      vLine.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(vLine);
    }

    return {
      svg,
      lo: objLo,
      hi: objHi,
      hiFrac: yAt(objHi) / H,
      loFrac: yAt(objLo) / H,
      transitFrac,
      moonIconYFrac,
      ticks,
    };
  }

  /** FOV frame spec for a given gear setup (for the plan PDF). */
  private async getSelectedFovSpecs(setupId: string | null) {
    if (!setupId) return [];
    try {
      const setups = await getGearSetups();
      const setup = setups.find((s) => s.id === setupId);
      if (!setup) return [];
      return await buildFovFrameSpecs([{ ...setup, enabled: true }]);
    } catch (err) {
      reportUnknownRendererError('plan_fov_specs_failed', err, { setupId });
      return [];
    }
  }

  /** Imperative "add to plan" popover anchored to a button. */
  private openPlanPicker(
    anchorEl: HTMLElement,
    dsoId: string,
    // When set (a multiple star, not a catalogued DSO), rows add a custom-location entry
    // at these coords instead of a DSO-anchored one — add-only, no membership toggle.
    customCoords?: { ra: number; dec: number },
  ): void {
    this.closePlanPicker();

    const picker = document.createElement('div');
    picker.className =
      'plan-picker fixed z-tooltip bg-panel border border-subtle rounded-md shadow-lg py-2 min-w-[220px] max-h-[60vh] overflow-auto';

    const title = document.createElement('div');
    title.className = 'px-3 pb-1 text-micro uppercase text-label';
    title.textContent = t('targets.plan.pickerTitle');
    picker.appendChild(title);

    const list = document.createElement('div');
    picker.appendChild(list);

    const renderList = () => {
      list.innerHTML = '';
      for (const plan of this.plansStore.plans) {
        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className =
          'flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]';
        const check = document.createElement('span');
        check.className = 'w-4 shrink-0 text-bright';
        check.textContent = !customCoords && this.plansStore.isInPlan(dsoId, plan.id) ? '✓' : '';
        const label = document.createElement('span');
        label.className = 'flex-1 truncate';
        label.textContent = plan.name;
        rowBtn.appendChild(check);
        rowBtn.appendChild(label);
        rowBtn.addEventListener('click', async () => {
          if (customCoords) {
            await this.plansStore.addCustomEntry(plan.id, customCoords.ra, customCoords.dec);
            this.closePlanPicker();
          } else {
            await this.plansStore.toggleEntry(plan.id, dsoId);
            renderList();
            this.refreshAllPlanButtons();
          }
        });
        list.appendChild(rowBtn);
      }
    };
    renderList();

    const sep = document.createElement('div');
    sep.className = 'border-t border-subtle my-1';
    picker.appendChild(sep);

    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className =
      'flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]';
    newRow.textContent = '+ ' + t('targets.plan.newPlan');
    newRow.addEventListener('click', async () => {
      const id = await this.plansStore.createPlan(this.defaultPlanName());
      if (id) {
        if (customCoords)
          await this.plansStore.addCustomEntry(id, customCoords.ra, customCoords.dec);
        else await this.plansStore.addEntry(id, dsoId);
      }
      this.updatePlanBadge();
      if (customCoords) this.closePlanPicker();
      else renderList();
      this.refreshAllPlanButtons();
    });
    picker.appendChild(newRow);

    document.body.appendChild(picker);
    this.planPickerEl = picker;
    // Pin the picker to the button (native CSS anchoring where available, JS
    // scroll-tracking fallback otherwise). Right-aligned to the button edge.
    this.planPickerCleanup = attachAnchoredPanel(picker, anchorEl, {
      alignRight: true,
      onAnchorOutOfView: () => this.closePlanPicker(),
    });

    // Close on outside click / Escape (deferred so this click doesn't immediately close it).
    setTimeout(() => {
      this.planPickerOutside = (ev: MouseEvent) => {
        if (
          this.planPickerEl &&
          !this.planPickerEl.contains(ev.target as Node) &&
          ev.target !== anchorEl
        ) {
          this.closePlanPicker();
        }
      };
      this.planPickerEsc = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this.closePlanPicker();
      };
      document.addEventListener('click', this.planPickerOutside);
      document.addEventListener('keydown', this.planPickerEsc);
    }, 0);
  }

  private closePlanPicker(): void {
    if (this.planPickerEl) {
      this.planPickerEl.remove();
      this.planPickerEl = null;
    }
    if (this.planPickerOutside) {
      document.removeEventListener('click', this.planPickerOutside);
      this.planPickerOutside = null;
    }
    if (this.planPickerEsc) {
      document.removeEventListener('keydown', this.planPickerEsc);
      this.planPickerEsc = null;
    }
    if (this.planPickerCleanup) {
      this.planPickerCleanup();
      this.planPickerCleanup = null;
    }
  }

  /** Refresh every result card's plan-list button highlight. */
  private refreshAllPlanButtons(): void {
    this.recommendRoot
      ?.querySelectorAll<HTMLButtonElement>('.target-card [data-plan-dso]')
      .forEach((btn) => {
        this.refreshPlanBtnState(btn, btn.getAttribute('data-plan-dso')!);
      });
  }
}
