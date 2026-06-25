import { describe, it, expect } from 'vitest';
import {
  applyStarColor,
  SKY_THEME,
  type SkyThemeConfig,
} from '../../src/sky-themes';

function makeTheme(overrides: Partial<SkyThemeConfig>): SkyThemeConfig {
  return {
    baseFill: '#000',
    bgStops: [[0, '#000'], [1, '#000']],
    vignette: null,
    bgOpacityScale: 1,
    starTint: { rMul: 1, gMul: 1, bMul: 1 },
    starSaturation: 1,
    radiusScale: 1,
    brightZoomBoost: 0,
    glowThresholdMag: 2,
    glowRadiusMul: 4,
    glowOpacity: 0.3,
    glowSaturation: 1,
    glowZoomSpread: 0,
    gridColor: '#000',
    gridEquatorColor: '#000',
    gridLabelColor: '#000',
    constellationLineColor: '#000',
    ...overrides,
  };
}

describe('applyStarColor', () => {
  it('is identity when saturation=1 and tint=1', () => {
    const theme = makeTheme({});
    expect(applyStarColor([100, 150, 200], theme)).toEqual([100, 150, 200]);
  });

  it('blends to pure white when saturation = 0', () => {
    const theme = makeTheme({ starSaturation: 0 });
    expect(applyStarColor([200, 100, 0], theme)).toEqual([255, 255, 255]);
  });

  it('keeps a subtle, bright tint at low saturation', () => {
    const theme = makeTheme({ starSaturation: 0.4 });
    const [r, g, b] = applyStarColor([255, 152, 92], theme); // warm star
    // stays bright and near-white, warm ordering preserved (r > g > b)
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(180);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('oversaturates (pushes away from white) when saturation > 1', () => {
    const theme = makeTheme({ starSaturation: 1.5 });
    const [r, g, b] = applyStarColor([200, 120, 40], theme);
    // every channel moves further below white than the spectral color
    expect(r).toBeLessThan(200);
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(40);
  });

  it('applies per-channel tint multipliers', () => {
    const theme = makeTheme({ starTint: { rMul: 0.5, gMul: 1, bMul: 2 } });
    expect(applyStarColor([100, 100, 100], theme)).toEqual([50, 100, 200]);
  });

  it('clamps to the 0..255 range', () => {
    const theme = makeTheme({ starTint: { rMul: 10, gMul: 1, bMul: 0 } });
    const [r, , b] = applyStarColor([100, 100, 100], theme);
    expect(r).toBe(255);
    expect(b).toBe(0);
  });

  it('honors a saturation override (for the glow color)', () => {
    const theme = makeTheme({ starSaturation: 0.3 });
    const warm: [number, number, number] = [255, 152, 92];
    const dot = applyStarColor(warm, theme);                 // near-white dot
    const glow = applyStarColor(warm, theme, 1.2);           // strongly tinted glow
    // the glow keeps much more of the warm color than the dot
    expect(glow[2]).toBeLessThan(dot[2]); // bluer channel pulled further down → more orange
    expect(dot[1] - dot[2]).toBeLessThan(glow[1] - glow[2]); // warm spread larger in glow
  });

  it('returns integer channels', () => {
    const theme = makeTheme({ starSaturation: 1.3, starTint: { rMul: 1.08, gMul: 1, bMul: 0.92 } });
    const out = applyStarColor([123, 87, 200], theme);
    for (const c of out) expect(Number.isInteger(c)).toBe(true);
  });
});

describe('SKY_THEME', () => {
  it('is a complete config', () => {
    expect(SKY_THEME.bgStops.length).toBeGreaterThanOrEqual(2);
    expect(typeof SKY_THEME.baseFill).toBe('string');
    expect(SKY_THEME.glowOpacity).toBeGreaterThan(0);
    expect(SKY_THEME.glowSaturation).toBeGreaterThan(0);
  });
});
