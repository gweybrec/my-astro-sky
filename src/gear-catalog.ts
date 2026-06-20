/**
 * Gear catalog — TypeScript types and lazy-fetch loaders for the telescope,
 * camera, and accessory catalogs served by the Express backend.
 *
 * Call getTelescopes() / getCameras() / getAccessories() from async contexts;
 * results are cached after the first fetch so subsequent calls are synchronous.
 */

import type { GearPreset } from './gear-presets';
import type { SmartMosaicCapability } from './mosaic';

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

// ─── Cache ────────────────────────────────────────────────────────────────────

let _telescopes: TelescopeData[] | null = null;
let _cameras: CameraData[] | null = null;
let _accessories: AccessoryData[] | null = null;

export async function getTelescopes(): Promise<TelescopeData[]> {
  if (!_telescopes) {
    _telescopes = await fetch('/api/telescopes').then(r => {
      if (!r.ok) throw new Error(`Failed to load telescopes: ${r.status}`);
      return r.json();
    });
  }
  return _telescopes!;
}

export async function getCameras(): Promise<CameraData[]> {
  if (!_cameras) {
    _cameras = await fetch('/api/cameras').then(r => {
      if (!r.ok) throw new Error(`Failed to load cameras: ${r.status}`);
      return r.json();
    });
  }
  return _cameras!;
}

export async function getAccessories(): Promise<AccessoryData[]> {
  if (!_accessories) {
    _accessories = await fetch('/api/accessories').then(r => {
      if (!r.ok) throw new Error(`Failed to load accessories: ${r.status}`);
      return r.json();
    });
  }
  return _accessories!;
}

/** Invalidate the in-memory cache (call after creating/deleting custom gear). */
export function invalidateGearCache(type: 'telescope' | 'camera' | 'accessory'): void {
  if (type === 'telescope') _telescopes = null;
  else if (type === 'camera') _cameras = null;
  else _accessories = null;
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
  const effectiveFocalLengthMm =
    telescope.focal_length_mm * (accessory?.magnification_factor ?? 1);
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
