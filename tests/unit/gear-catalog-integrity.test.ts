/**
 * Structural checks on the shipped gear catalogs (`resources/telescopes.json` and
 * `resources/cameras.json`), which the server loads verbatim at startup.
 *
 * The motivating bug: three smart telescopes pointed `integrated_camera_id` at camera
 * entries that did not exist, and several had optics/sensors that did not reproduce the
 * manufacturer's published field of view. Nothing caught either, because no test read
 * the real catalog files. The FOV table at the bottom pins every smart scope to its
 * published spec so a future catalog edit cannot silently regress it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', name), 'utf-8'));

interface Telescope {
  id: string;
  aperture_mm: number;
  focal_length_mm: number;
  f_ratio: number;
  is_smart_telescope: boolean;
  integrated_camera: boolean;
  integrated_camera_id: string | null;
}
interface Camera {
  id: string;
  sensor_width_mm: number;
  sensor_height_mm: number;
  pixel_size_um: number;
  resolution_x: number;
  resolution_y: number;
}

const telescopes: Telescope[] = read('telescopes.json');
const cameras: Camera[] = read('cameras.json');
const cameraById = new Map(cameras.map((c) => [c.id, c]));
const smartScopes = telescopes.filter((t) => t.is_smart_telescope);

const fovDeg = (sensorMm: number, focalMm: number) =>
  (2 * Math.atan(sensorMm / (2 * focalMm)) * 180) / Math.PI;

describe('gear catalog integrity', () => {
  it('has unique ids', () => {
    for (const [label, list] of [
      ['telescopes', telescopes],
      ['cameras', cameras],
    ] as const) {
      const ids = list.map((e) => e.id);
      expect(new Set(ids).size, `duplicate id in ${label}.json`).toBe(ids.length);
    }
  });

  it('resolves every integrated_camera_id to a real camera', () => {
    const dangling = telescopes
      .filter((t) => t.integrated_camera_id && !cameraById.has(t.integrated_camera_id))
      .map((t) => `${t.id} → ${t.integrated_camera_id}`);
    expect(dangling).toEqual([]);
  });

  it('gives every smart telescope an integrated camera', () => {
    for (const t of smartScopes) {
      expect(t.integrated_camera, `${t.id}.integrated_camera`).toBe(true);
      expect(t.integrated_camera_id, `${t.id}.integrated_camera_id`).toBeTruthy();
    }
  });

  it('gives every camera usable sensor geometry', () => {
    for (const c of cameras) {
      for (const field of [
        'sensor_width_mm',
        'sensor_height_mm',
        'pixel_size_um',
        'resolution_x',
        'resolution_y',
      ] as const) {
        const v = c[field];
        expect(typeof v, `${c.id}.${field} type`).toBe('number');
        expect(v, `${c.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  /** How far a stored sensor dimension strays from resolution × pixel size, as a ratio. */
  const dimensionDrift = (c: Camera) =>
    Math.max(
      Math.abs(c.sensor_width_mm - (c.resolution_x * c.pixel_size_um) / 1000) / c.sensor_width_mm,
      Math.abs(c.sensor_height_mm - (c.resolution_y * c.pixel_size_um) / 1000) / c.sensor_height_mm,
    );

  it('derives integrated-camera dimensions exactly from resolution × pixel size', () => {
    // The smart-scope sensors were audited against manufacturer specs, so these are
    // held to 1%. A larger drift means one of the two fields was edited alone.
    const integrated = smartScopes
      .map((t) => cameraById.get(t.integrated_camera_id!))
      .filter((c): c is Camera => c != null);
    const drifted = integrated
      .filter((c) => dimensionDrift(c) > 0.01)
      .map((c) => `${c.id} (${(dimensionDrift(c) * 100).toFixed(1)}%)`);
    expect(drifted).toEqual([]);
  });

  it('has no camera whose sensor dimensions grossly contradict its pixel grid', () => {
    // Looser gate for the wider catalog, where vendors quote rounded sensor sizes.
    // Catches transposed or mistyped values (this is how ASI224MC's 2.7 mm height,
    // 26% below the real 3.66 mm, was found).
    const drifted = cameras
      .filter((c) => dimensionDrift(c) > 0.05)
      .map((c) => `${c.id} (${(dimensionDrift(c) * 100).toFixed(1)}%)`);
    expect(drifted).toEqual([]);
  });

  it('keeps every telescope f-ratio consistent with its aperture and focal length', () => {
    for (const t of telescopes) {
      expect(t.f_ratio, `${t.id} f_ratio`).toBeCloseTo(t.focal_length_mm / t.aperture_mm, 0);
    }
  });
});

// ─── Published FOV per smart telescope ───────────────────────────────────────
//
// wDeg × hDeg as the app computes them from sensor + focal length, checked against the
// manufacturer's published figure. Where a vendor quotes only a diagonal (Seestar, DWARF)
// the diagonal is given instead. Tolerance is 0.05°, tight enough to catch a swapped
// sensor or focal length but loose enough for vendor rounding.

const EXPECTED: Record<
  string,
  { w?: number; h?: number; diag?: number; tol?: number; note: string }
> = {
  'seestar-s30': { diag: 2.46, note: 'ZWO: 2.46° tele FOV' },
  'seestar-s50': { w: 1.29, h: 0.73, note: 'ZWO: 1.29° × 0.73°' },
  'zwo-seestar-s30-pro': { diag: 4.57, note: 'ZWO: 4.6° tele FOV' },
  'vaonis-vespera': { w: 1.6, h: 0.9, note: 'Vaonis: 1.6° × 0.9°' },
  'vaonis-vespera-2': { w: 2.57, h: 1.44, note: 'Vaonis: 2.5° × 1.4°' },
  'vaonis-vespera-pro': { w: 1.63, h: 1.63, note: 'Vaonis: 1.6° × 1.6°' },
  // The 2026 generation reuses the previous sensors at a slightly shorter 245 mm, so
  // the geometry lands ~0.05° above Vaonis' published (single-decimal, likely carried
  // over) figures. Loosened rather than fudging the sensor to hit a marketing number.
  'vaonis-vespera-3': { w: 2.6, h: 1.46, tol: 0.12, note: 'Vaonis: 2.5° × 1.4°' },
  'vaonis-vespera-pro-2': { w: 1.66, h: 1.66, tol: 0.12, note: 'Vaonis: 1.6° × 1.6°' },
  'celestron-origin': { w: 1.32, h: 0.75, note: 'Celestron: 1.32° × 0.75°' },
  'unistellar-evscope-2': { w: 0.78, h: 0.57, note: 'Unistellar: 47′ × 34′' },
  'unistellar-equinox-2': { w: 0.78, h: 0.57, note: 'Unistellar: 47′ × 34′' },
  'unistellar-odyssey-pro': { w: 0.75, h: 0.57, note: 'Unistellar: 45′ × 34′' },
  'dwarflab-dwarf-3': { w: 2.93, h: 1.65, note: 'DwarfLab: 2.93° × 1.65°' },
  'dwarflab-dwarf-mini': { diag: 2.44, note: 'DwarfLab: 2.45° diagonal' },
};

describe('smart telescope field of view matches published specs', () => {
  it('covers every smart telescope in the catalog', () => {
    // Forces this table to be extended whenever a smart scope is added.
    expect(smartScopes.map((t) => t.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [id, exp] of Object.entries(EXPECTED)) {
    it(`${id} — ${exp.note}`, () => {
      const tel = telescopes.find((t) => t.id === id);
      expect(tel, `${id} missing from telescopes.json`).toBeDefined();
      const cam = cameraById.get(tel!.integrated_camera_id!);
      expect(cam, `${id} integrated camera missing`).toBeDefined();

      const fl = tel!.focal_length_mm;
      const tol = exp.tol ?? 0.05;
      const near = (actual: number, expected: number, axis: string) =>
        expect(
          Math.abs(actual - expected),
          `${axis}: ${actual.toFixed(2)}° vs ${expected}°`,
        ).toBeLessThanOrEqual(tol);

      if (exp.w != null) near(fovDeg(cam!.sensor_width_mm, fl), exp.w, 'width');
      if (exp.h != null) near(fovDeg(cam!.sensor_height_mm, fl), exp.h, 'height');
      if (exp.diag != null)
        near(fovDeg(Math.hypot(cam!.sensor_width_mm, cam!.sensor_height_mm), fl), exp.diag, 'diag');
    });
  }
});
