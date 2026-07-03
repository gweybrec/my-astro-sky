import { describe, expect, it } from 'vitest';
import {
  bvToRgb,
  starRadius,
  computeMaxMag,
  atlasScaleBucket,
  ATLAS_SCALE_STEP,
  computeStarPaint,
} from '../../src/star-render-math';
import { SKY_THEME } from '../../src/sky-themes';

describe('bvToRgb', () => {
  it('is neutral white at the B-V≈0.4 white point', () => {
    expect(bvToRgb(0.4)).toEqual([255, 255, 255]);
  });

  it('reads blue-white for hot stars (negative B-V)', () => {
    const [r, g, b] = bvToRgb(-0.4);
    expect(b).toBe(255);
    expect(r).toBeLessThan(b);
    expect(g).toBeLessThan(b);
  });

  it('reads orange/red for cool stars (high B-V)', () => {
    const [r, g, b] = bvToRgb(2.0);
    expect(r).toBe(255);
    expect(b).toBeLessThan(r);
    expect(g).toBeLessThan(r);
  });

  it('clamps out-of-range B-V to the endpoints', () => {
    expect(bvToRgb(-5)).toEqual(bvToRgb(-0.4));
    expect(bvToRgb(5)).toEqual(bvToRgb(2.0));
  });
});

describe('starRadius', () => {
  it('brighter (lower-mag) stars are larger at a fixed scale', () => {
    const bright = starRadius(0, 1000);
    const faint = starRadius(6, 1000);
    expect(bright).toBeGreaterThan(faint);
  });

  it('grows with zoom (scale) but never below the 0.9 floor', () => {
    expect(starRadius(6, 10000)).toBeGreaterThan(starRadius(6, 400));
    expect(starRadius(10, 50)).toBeGreaterThanOrEqual(0.9);
  });

  it('caps zoom growth so stars do not take over the view', () => {
    // Faint star capped at STAR_ZOOM_CAP=2.2 → base(0.3)*2.2 floored at 0.9.
    expect(starRadius(20, 1e9)).toBeCloseTo(0.9, 5);
  });
});

describe('computeMaxMag', () => {
  it('is floored at 6 when zoomed out', () => {
    expect(computeMaxMag(50)).toBe(6);
    expect(computeMaxMag(200)).toBe(6);
  });

  it('increases by 1 magnitude per doubling of scale above the floor', () => {
    expect(computeMaxMag(800)).toBeCloseTo(8, 6); // 6 + log2(800/200) = 6+2
  });
});

describe('atlasScaleBucket', () => {
  it('quantizes nearby scales to the same bucket', () => {
    const a = atlasScaleBucket(1000);
    const b = atlasScaleBucket(1000 * 1.02); // within one ~6% step
    expect(b).toBe(a);
  });

  it('snaps to a different bucket once past a full step', () => {
    const a = atlasScaleBucket(1000);
    const b = atlasScaleBucket(1000 * Math.exp(ATLAS_SCALE_STEP)); // exactly one step up
    expect(b).toBeGreaterThan(a);
  });

  it('is idempotent on an already-bucketed value', () => {
    const a = atlasScaleBucket(1234);
    expect(atlasScaleBucket(a)).toBeCloseTo(a, 6);
  });
});

describe('computeStarPaint', () => {
  it('produces a positive radius and in-range colour channels', () => {
    const p = computeStarPaint(2, 0.5, 1000, 8, SKY_THEME);
    expect(p.radius).toBeGreaterThan(0);
    for (const c of [p.r, p.g, p.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });

  it('gives a glow (glowR>0) to bright stars and none to faint ones', () => {
    const bright = computeStarPaint(0, 0.5, 1000, 10, SKY_THEME);
    const faint = computeStarPaint(9, 0.5, 1000, 10, SKY_THEME);
    expect(bright.glowAlpha).toBeGreaterThan(0.01);
    expect(bright.glowR).toBeGreaterThan(0);
    expect(faint.glowR).toBe(0);
  });

  it('softens the rim for a just-appearing star (mag near maxMag)', () => {
    const established = computeStarPaint(4, 0.5, 1000, 8, SKY_THEME, true);
    const appearing = computeStarPaint(8, 0.5, 1000, 8, SKY_THEME, false);
    expect(appearing.soft).toBeGreaterThan(established.soft);
  });
});
