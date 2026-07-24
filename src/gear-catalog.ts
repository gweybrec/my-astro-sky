/**
 * Gear catalog — TypeScript types and lazy-fetch loaders for the telescope,
 * camera, and accessory catalogs served by the Express backend.
 *
 * Call getTelescopes() / getCameras() / getAccessories() from async contexts;
 * results are cached after the first fetch so subsequent calls are synchronous.
 */

import type { GearPreset } from './gear-presets';
import type { SmartMosaicCapability } from './mosaic';
import type { FilterCatalogEntry } from './autocomplete-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TelescopeData {
  id: string;
  brand: string;
  model: string;
  type: string;
  optical_design: string | null;
  aperture_mm: number;
  focal_length_mm: number;
  f_ratio: number;
  is_smart_telescope: boolean;
  /** Smart-scope single-frame mosaic capability (absent ⇒ no mosaic mode). */
  mosaic?: SmartMosaicCapability;
  max_sub_exposure_sec?: number;
  has_dual_band_filter?: boolean;
  integrated_camera: boolean;
  integrated_camera_id: string | null;
  mount_interface: string | null;
  optical_notes: string | null;
  recommended_use: string[];
  status: string;
}

export interface CameraData {
  id: string;
  brand: string;
  model: string;
  sensor: string;
  sensor_generation: string;
  color_type: 'OSC' | 'Mono';
  sensor_width_mm: number;
  sensor_height_mm: number;
  pixel_size_um: number;
  resolution_x: number;
  resolution_y: number;
  recommended_use: string[];
  status: string;
}

export interface AccessoryData {
  id: string;
  brand: string;
  model: string;
  type: string;
  magnification_factor: number;
  notes: string | null;
  thread_input: string | null;
  thread_output: string | null;
  status: string;
}

/** One passband of a multi-band (dual/tri/quad) filter. */
export interface FilterPassband {
  line: string;
  center_nm: number;
  fwhm_nm: number | null;
}

/**
 * An imaging filter. Unlike the three types above, a filter is NOT part of a gear
 * setup — it is picked per photo integration row and per plan observation window.
 * See resources/filters.schema.json for the full field documentation.
 */
export interface FilterData {
  id: string;
  brand: string;
  model: string;
  series: string | null;
  type: string;
  subtype: string;
  mono_osc: 'mono' | 'osc' | 'both';
  bandpass_nm: number | null;
  center_nm: number | null;
  fwhm_nm: number | null;
  passbands?: FilterPassband[];
  /** Badge colour, `#rrggbb`. Seeded by scripts/seed-filter-colors.mjs. */
  color: string;
  spcc_name?: string | null;
  astrobin_name?: string | null;
  notes?: string | null;
  status: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/** Equipment categories backed by `custom_gear` on the server. */
export type CustomGearType = 'telescope' | 'camera' | 'accessory' | 'filter';

let _telescopes: TelescopeData[] | null = null;
let _cameras: CameraData[] | null = null;
let _accessories: AccessoryData[] | null = null;
let _filters: FilterData[] | null = null;
/** Lowercased display label → filter. Rebuilt lazily whenever `_filters` changes. */
let _filterByLabel: Map<string, FilterData> | null = null;

export async function getTelescopes(): Promise<TelescopeData[]> {
  if (!_telescopes) {
    _telescopes = await fetch('/api/telescopes').then((r) => {
      if (!r.ok) throw new Error(`Failed to load telescopes: ${r.status}`);
      return r.json();
    });
  }
  return _telescopes!;
}

export async function getCameras(): Promise<CameraData[]> {
  if (!_cameras) {
    _cameras = await fetch('/api/cameras').then((r) => {
      if (!r.ok) throw new Error(`Failed to load cameras: ${r.status}`);
      return r.json();
    });
  }
  return _cameras!;
}

export async function getAccessories(): Promise<AccessoryData[]> {
  if (!_accessories) {
    _accessories = await fetch('/api/accessories').then((r) => {
      if (!r.ok) throw new Error(`Failed to load accessories: ${r.status}`);
      return r.json();
    });
  }
  return _accessories!;
}

export async function getFilters(): Promise<FilterData[]> {
  if (!_filters) {
    _filters = await fetch('/api/filters').then((r) => {
      if (!r.ok) throw new Error(`Failed to load filters: ${r.status}`);
      return r.json();
    });
    _filterByLabel = null;
  }
  return _filters!;
}

/**
 * The filters loaded so far, or `[]` if `getFilters()` has not resolved yet.
 * Badge rendering is synchronous, so it reads through this and degrades to the
 * legacy `--filter-{key}` token colours until the catalog arrives.
 */
export function getFiltersSync(): FilterData[] {
  return _filters ?? [];
}

/** Invalidate the in-memory cache (call after creating/deleting custom gear). */
export function invalidateGearCache(type: CustomGearType): void {
  if (type === 'telescope') _telescopes = null;
  else if (type === 'camera') _cameras = null;
  else if (type === 'filter') {
    _filters = null;
    _filterByLabel = null;
  } else _accessories = null;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Build the GearPreset consumed by the recommender and recipe engine from
 * a 3-part selection.  Accessory is optional (null = no reducer/barlow).
 */
export function buildGearPreset(
  telescope: TelescopeData,
  camera: CameraData,
  accessory: AccessoryData | null,
): GearPreset {
  const effectiveFocalLengthMm = telescope.focal_length_mm * (accessory?.magnification_factor ?? 1);
  return {
    apertureMm: telescope.aperture_mm,
    focalLengthMm: effectiveFocalLengthMm,
    sensorWidthMm: camera.sensor_width_mm,
    sensorHeightMm: camera.sensor_height_mm,
    pixelSizeUm: camera.pixel_size_um,
    mono: camera.color_type === 'Mono',
    builtIn: telescope.is_smart_telescope,
    maxSubSec: telescope.max_sub_exposure_sec,
    hasDualBandFilter: telescope.has_dual_band_filter ?? false,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function telescopeLabel(t: TelescopeData): string {
  return `${t.brand} ${t.model}`;
}

export function cameraLabel(c: CameraData): string {
  return `${c.brand} ${c.model}`;
}

export function accessoryLabel(a: AccessoryData): string {
  return `${a.brand} ${a.model}`;
}

/**
 * The name a filter is shown and stored under. Unlike the other three catalogs
 * this is NOT `brand + model`: the raw model strings are internal SKU-ish names
 * ("Pro LRGB – L") while the AstroBin name is the one astronomers actually use
 * and already embeds the brand ("Antlia Pro Luminance"). SPCC is the next best
 * source; custom filters have neither and fall back to their model.
 *
 * These labels are unique across the catalog (enforced by
 * tests/unit/filters-json-schema.test.ts) because an integration row stores the
 * label, and the label is the key `resolveCatalogFilter` looks colours up by.
 */
export function filterLabel(f: FilterData): string {
  return f.astrobin_name ?? f.spcc_name ?? f.model;
}

/** A short "Ha · 656.3nm / 3nm"-style description, or `null` when nothing is known. */
export function filterDetail(f: FilterData): string | null {
  const parts: string[] = [];
  if (f.subtype) parts.push(f.subtype);
  if (f.passbands?.length) {
    parts.push(f.passbands.map((p) => `${p.center_nm}nm`).join(' + '));
  } else if (f.center_nm != null) {
    parts.push(f.fwhm_nm != null ? `${f.center_nm}nm / ${f.fwhm_nm}nm` : `${f.center_nm}nm`);
  } else if (f.bandpass_nm != null) {
    parts.push(`${f.bandpass_nm}nm`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Find the catalog entry a stored filter name refers to, or `null` for a
 * free-typed name (or before the catalog has loaded). Synchronous by design —
 * badge rendering cannot await.
 */
export function resolveCatalogFilter(name: string | null | undefined): FilterData | null {
  const key = (name ?? '').trim().toLowerCase();
  if (!key || !_filters) return null;
  if (!_filterByLabel) {
    _filterByLabel = new Map();
    for (const f of _filters) _filterByLabel.set(filterLabel(f).trim().toLowerCase(), f);
  }
  return _filterByLabel.get(key) ?? null;
}

/** The catalog colour of a stored filter name, or null when it names no product. */
export function catalogFilterColor(name: string): string | null {
  return resolveCatalogFilter(name)?.color ?? null;
}

// ─── Owned-filter selection ───────────────────────────────────────────────────

/**
 * Ids of catalog filters the user has hidden in the Filters manage modal, i.e.
 * the ones they do not own. Hidden filters are excluded from the integration-row
 * and observation-window autocompletes.
 *
 * Kept here rather than in the Targets prefs because the photo metadata editors
 * need it too, and they live outside the Targets subsystem.
 */
const HIDDEN_FILTERS_KEY = 'myastrosky-hidden-filter-ids';

export function getHiddenFilterIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_FILTERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function setHiddenFilterIds(ids: Set<string>): void {
  localStorage.setItem(HIDDEN_FILTERS_KEY, JSON.stringify([...ids]));
}

/** The filters offered in autocompletes: catalog minus the ones the user hid. */
export function getVisibleFilters(): FilterData[] {
  const hidden = getHiddenFilterIds();
  return getFiltersSync().filter((f) => !hidden.has(f.id));
}

/**
 * `getVisibleFilters()` flattened into the shape the autocomplete works with.
 * Keeps `autocomplete-utils` free of any catalog import.
 */
export function getVisibleFilterEntries(): FilterCatalogEntry[] {
  return getVisibleFilters().map((f) => ({
    label: filterLabel(f),
    color: f.color,
    detail: filterDetail(f),
    brand: f.brand,
    model: f.model,
    series: f.series,
    subtype: f.subtype,
  }));
}
