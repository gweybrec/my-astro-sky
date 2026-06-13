import { describe, it, expect } from 'vitest';
import { formatFov, formatGearFovLabel, computeFovTargetScale, type GearPreset } from '../../src/gear-presets';

const makePreset = (overrides: Partial<GearPreset> = {}): GearPreset => ({
  apertureMm: 102,
  focalLengthMm: 714,
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  pixelSizeUm: 3.76,
  mono: false,
  builtIn: false,
  ...overrides,
});

describe('formatFov', () => {
  it('formats degrees when both dimensions >= 1°', () => {
    expect(formatFov(2.5, 1.8)).toBe('2.5° × 1.8°');
  });

  it('formats arcminutes when dimensions < 1°', () => {
    expect(formatFov(0.5, 0.333)).toBe("30' × 20'");
  });

  it('mixes degrees and arcminutes', () => {
    expect(formatFov(1.2, 0.75)).toBe("1.2° × 45'");
  });
});

describe('formatGearFovLabel', () => {
  it('contains focal length, FOV dimensions and pixel scale', () => {
    const preset = makePreset({ focalLengthMm: 714, sensorWidthMm: 17.3, sensorHeightMm: 13.0, pixelSizeUm: 3.76 });
    const label = formatGearFovLabel(preset);
    // Focal length
    expect(label).toContain('714 mm');
    // FOV keyword
    expect(label).toContain('FOV');
    // Pixel scale unit
    expect(label).toContain('″/px');
  });

  it('uses arcminutes for a narrow FOV preset', () => {
    // Very long focal length → sub-degree FOV
    const preset = makePreset({ focalLengthMm: 3000, sensorWidthMm: 6.17, sensorHeightMm: 4.55, pixelSizeUm: 2.4 });
    const label = formatGearFovLabel(preset);
    // FOV should be in arcminutes (tiny sensor)
    expect(label).toMatch(/\d+'/);
  });

  it('uses degrees for a wide FOV preset', () => {
    // Short focal length → multi-degree FOV
    const preset = makePreset({ focalLengthMm: 24, sensorWidthMm: 35.9, sensorHeightMm: 24.0, pixelSizeUm: 5.97 });
    const label = formatGearFovLabel(preset);
    expect(label).toMatch(/\d+\.\d+°/);
  });
});

describe('computeFovTargetScale', () => {
  it('targets ~1/3 of canvas for a typical FOV', () => {
    // 2°×1.5° frame, dec=45°N, 800px canvas
    const scale = computeFovTargetScale(2, 1.5, 45, 'north', 800);
    expect(scale).toBeGreaterThan(300);
    expect(scale).toBeLessThan(50000);
    // verify the frame actually fills ~33% of canvas at this scale
    const cos2 = Math.cos((45 * Math.PI / 180) / 2) ** 2;
    const halfWPx = (1 * Math.PI / 180) / (2 * cos2) * scale;
    expect(halfWPx * 2).toBeCloseTo(800 * 0.33, 0);
  });

  it('gives lower scale for wide FOV than narrow FOV', () => {
    const wide   = computeFovTargetScale(10, 8, 45, 'north', 800);
    const narrow = computeFovTargetScale(1, 0.7, 45, 'north', 800);
    expect(wide).toBeLessThan(narrow);
  });

  it('clamps very narrow FOV to maximum', () => {
    // 0.3°×0.2° would require scale ~86k → clamped to 50000
    expect(computeFovTargetScale(0.3, 0.2, 45, 'north', 800)).toBe(50000);
  });

  it('accounts for declination (equatorial vs polar)', () => {
    const polar = computeFovTargetScale(2, 1.5, 80, 'north', 800);
    const equat = computeFovTargetScale(2, 1.5,  0, 'north', 800);
    // Objects near the pole have larger cos², needing higher scale
    expect(polar).toBeGreaterThan(equat);
  });

  it('handles south hemisphere correctly (colatitude = 90 + dec)', () => {
    // dec=-45° south ≡ 45° from pole → same cos² as dec=+45° north
    const s = computeFovTargetScale(2, 1.5, -45, 'south', 800);
    const n = computeFovTargetScale(2, 1.5,  45, 'north', 800);
    expect(s).toBeCloseTo(n, 0);
  });
});
