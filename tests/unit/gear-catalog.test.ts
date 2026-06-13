/**
 * Unit tests for src/gear-catalog.ts and the fovDeg() formula.
 */

import { describe, it, expect } from 'vitest';
import { buildGearPreset } from '../../src/gear-catalog';
import { fovDeg, pixelScaleArcsec } from '../../src/gear-presets';
import type { TelescopeData, CameraData, AccessoryData } from '../../src/gear-catalog';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const C8_TELESCOPE: TelescopeData = {
  id: 'celestron-c8-sct', brand: 'Celestron', model: 'C8 SCT',
  type: 'SCT', optical_design: 'Schmidt-Cassegrain', aperture_mm: 203.2,
  focal_length_mm: 2032, f_ratio: 10, is_smart_telescope: false,
  integrated_camera: false, integrated_camera_id: null,
  mount_interface: 'Losmandy', optical_notes: null, recommended_use: ['deep-sky'],
  status: 'active',
};

const ATIK_CAMERA: CameraData = {
  id: 'atik-314l-plus', brand: 'Atik', model: '314L+',
  sensor: 'Sony ICX285AL', sensor_generation: 'CCD', color_type: 'Mono',
  sensor_width_mm: 8.98, sensor_height_mm: 6.71,
  pixel_size_um: 6.45, resolution_x: 1391, resolution_y: 1039,
  recommended_use: ['deep-sky'], status: 'active',
};

const OSC_CAMERA: CameraData = {
  ...ATIK_CAMERA, id: 'osc-cam', color_type: 'OSC',
};

const REDUCER_063: AccessoryData = {
  id: 'celestron-fr-0-63', brand: 'Celestron', model: 'Focal Reducer 0.63×',
  type: 'focal-reducer', magnification_factor: 0.63,
  notes: null, thread_input: null, thread_output: null, status: 'active',
};

const BARLOW_2X: AccessoryData = {
  id: 'barlow-2x', brand: 'Generic', model: 'Barlow 2×',
  type: 'barlow', magnification_factor: 2.0,
  notes: null, thread_input: null, thread_output: null, status: 'active',
};

const SMART_TELESCOPE: TelescopeData = {
  id: 'seestar-s50', brand: 'ZWO', model: 'Seestar S50',
  type: 'Smart Telescope', optical_design: 'refractor', aperture_mm: 50,
  focal_length_mm: 250, f_ratio: 5, is_smart_telescope: true,
  integrated_camera: true, integrated_camera_id: 'seestar-s50-camera',
  mount_interface: null, optical_notes: null, recommended_use: ['wide-field'],
  status: 'active',
};

// ─── buildGearPreset ──────────────────────────────────────────────────────────

describe('buildGearPreset', () => {
  it('uses native focal length when no accessory', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.focalLengthMm).toBe(2032);
  });

  it('applies reducer magnification factor correctly', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, REDUCER_063);
    expect(preset.focalLengthMm).toBeCloseTo(2032 * 0.63, 4);
  });

  it('applies barlow 2× factor correctly', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, BARLOW_2X);
    expect(preset.focalLengthMm).toBeCloseTo(4064, 4);
  });

  it('sets aperture from telescope', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.apertureMm).toBe(203.2);
  });

  it('sets sensor dimensions from camera', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.sensorWidthMm).toBe(8.98);
    expect(preset.sensorHeightMm).toBe(6.71);
    expect(preset.pixelSizeUm).toBe(6.45);
  });

  it('sets mono=true for Mono camera', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.mono).toBe(true);
  });

  it('sets mono=false for OSC camera', () => {
    const preset = buildGearPreset(C8_TELESCOPE, OSC_CAMERA, null);
    expect(preset.mono).toBe(false);
  });

  it('sets builtIn=false for regular telescope', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.builtIn).toBe(false);
  });

  it('sets builtIn=true for smart telescope', () => {
    const preset = buildGearPreset(SMART_TELESCOPE, ATIK_CAMERA, null);
    expect(preset.builtIn).toBe(true);
  });
});

// ─── fovDeg accuracy ──────────────────────────────────────────────────────────

describe('fovDeg', () => {
  it('returns correct FOV for C8 + Atik 314L+', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    const { wDeg, hDeg } = fovDeg(preset);
    // Expected: 2*atan(8.98 / (2*2032)) * (180/PI) ≈ 0.2531°
    expect(wDeg).toBeCloseTo(0.2531, 2);
    // Expected: 2*atan(6.71 / (2*2032)) * (180/PI) ≈ 0.1891°
    expect(hDeg).toBeCloseTo(0.1891, 2);
  });

  it('widens FOV with 0.63× reducer', () => {
    const presetNative  = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    const presetReduced = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, REDUCER_063);
    const fovNative  = fovDeg(presetNative);
    const fovReduced = fovDeg(presetReduced);
    expect(fovReduced.wDeg).toBeGreaterThan(fovNative.wDeg);
    expect(fovReduced.hDeg).toBeGreaterThan(fovNative.hDeg);
  });

  it('narrows FOV with 2× barlow', () => {
    const presetNative = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    const presetBarlow = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, BARLOW_2X);
    const fovNative = fovDeg(presetNative);
    const fovBarlow = fovDeg(presetBarlow);
    expect(fovBarlow.wDeg).toBeLessThan(fovNative.wDeg);
  });

  it('matches 2*atan formula precisely for known values', () => {
    // Explicit manual computation: sensor=8.98mm, FL=2032mm
    const expected = 2 * Math.atan(8.98 / (2 * 2032)) * (180 / Math.PI);
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    expect(fovDeg(preset).wDeg).toBeCloseTo(expected, 10);
  });
});

// ─── pixelScaleArcsec ─────────────────────────────────────────────────────────

describe('pixelScaleArcsec', () => {
  it('returns expected pixel scale for C8 + Atik 314L+', () => {
    const preset = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    // (6.45 / 2032) * 206265 ≈ 0.655 "/px
    expect(pixelScaleArcsec(preset)).toBeCloseTo(0.655, 1);
  });

  it('pixel scale increases when focal length decreases', () => {
    const presetNative  = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, null);
    const presetReduced = buildGearPreset(C8_TELESCOPE, ATIK_CAMERA, REDUCER_063);
    expect(pixelScaleArcsec(presetReduced)).toBeGreaterThan(pixelScaleArcsec(presetNative));
  });
});
