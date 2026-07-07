import { describe, it, expect } from 'vitest';
import {
  targetRenderCount,
  magThresholdForCount,
  areaNormForBorderRadius,
  areaWeightedBudget,
} from '../../src/render-budget';

// Generous clamps so the core formula is exercised, not the clamps, unless stated.
const WIDE = { min: 0, max: 1e9 };

describe('targetRenderCount()', () => {
  it('scales with the square of zoom (scale)', () => {
    // Large counts so integer rounding is negligible relative to the ratio.
    const a = targetRenderCount(500, 2000, 1920, 1080, 6, WIDE.min, WIDE.max);
    const b = targetRenderCount(500, 4000, 1920, 1080, 6, WIDE.min, WIDE.max);
    expect(b / a).toBeCloseTo(4, 2); // 2x scale -> 4x count
  });

  it('is independent of pan (takes no center argument)', () => {
    // The signature has no centerX/centerY: identical inputs -> identical output,
    // so the threshold cannot drift while panning at a fixed zoom.
    const c1 = targetRenderCount(500, 250, 1600, 900, 6, WIDE.min, WIDE.max);
    const c2 = targetRenderCount(500, 250, 1600, 900, 6, WIDE.min, WIDE.max);
    expect(c1).toBe(c2);
  });

  it('halves when canvas area doubles (resolution independence)', () => {
    const small = targetRenderCount(500, 200, 1000, 1000, 6, WIDE.min, WIDE.max);
    const big = targetRenderCount(500, 200, 1000, 2000, 6, WIDE.min, WIDE.max);
    expect(big).toBeCloseTo(small / 2, 5);
  });

  it('scales linearly with budget', () => {
    const a = targetRenderCount(500, 200, 1920, 1080, 6, WIDE.min, WIDE.max);
    const b = targetRenderCount(1000, 200, 1920, 1080, 6, WIDE.min, WIDE.max);
    expect(b / a).toBeCloseTo(2, 5);
  });

  it('clamps to the lower bound when zoomed far out', () => {
    const out = targetRenderCount(500, 1, 1920, 1080, 6, 1000, 20000);
    expect(out).toBe(1000);
  });

  it('clamps to the upper bound when zoomed far in', () => {
    const out = targetRenderCount(500, 1e6, 1920, 1080, 6, 1000, 20000);
    expect(out).toBe(20000);
  });

  it('returns 0 for non-positive budget or canvas', () => {
    expect(targetRenderCount(0, 200, 1920, 1080, 6, 1000, 20000)).toBe(0);
    expect(targetRenderCount(500, 200, 0, 1080, 6, 1000, 20000)).toBe(0);
    expect(targetRenderCount(500, 200, 1920, 0, 6, 1000, 20000)).toBe(0);
  });
});

describe('magThresholdForCount()', () => {
  const mags = [1, 2, 3, 4, 5]; // ascending, brightest first

  it('returns the count-th brightest magnitude', () => {
    expect(magThresholdForCount(mags, 1)).toBe(1);
    expect(magThresholdForCount(mags, 3)).toBe(3);
  });

  it('is monotonic non-decreasing in count', () => {
    let prev = -Infinity;
    for (let n = 1; n <= mags.length; n++) {
      const v = magThresholdForCount(mags, n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('shows nothing for count <= 0', () => {
    expect(magThresholdForCount(mags, 0)).toBe(-Infinity);
    expect(magThresholdForCount(mags, -5)).toBe(-Infinity);
  });

  it('shows all (faintest magnitude) when count >= length', () => {
    expect(magThresholdForCount(mags, 5)).toBe(5);
    expect(magThresholdForCount(mags, 999)).toBe(5);
  });

  it('returns -Infinity for an empty catalog', () => {
    expect(magThresholdForCount([], 10)).toBe(-Infinity);
  });
});

describe('areaNormForBorderRadius()', () => {
  it('is 1 + r_border² (the cap-mean area factor for the stereographic form)', () => {
    // Default border: borderRadiusPU(45) = tan(67.5°) ≈ 2.4142 → aNorm ≈ 6.83.
    const rBorder = Math.tan((((90 + 45) / 2) * Math.PI) / 180);
    expect(areaNormForBorderRadius(rBorder)).toBeCloseTo(1 + rBorder * rBorder, 12);
    expect(areaNormForBorderRadius(rBorder)).toBeCloseTo(6.828, 2);
  });

  it('is 1 at the centre (r=0) and grows with the border radius', () => {
    expect(areaNormForBorderRadius(0)).toBe(1);
    expect(areaNormForBorderRadius(1)).toBe(2); // equator border
    expect(areaNormForBorderRadius(3)).toBeGreaterThan(areaNormForBorderRadius(1));
  });

  it('falls back to 1 for a non-finite or non-positive radius', () => {
    expect(areaNormForBorderRadius(Infinity)).toBe(1);
    expect(areaNormForBorderRadius(0)).toBe(1);
    expect(areaNormForBorderRadius(-2)).toBe(1);
  });
});

describe('areaWeightedBudget()', () => {
  it('equals the base when the area factor matches the normaliser (the cap mean)', () => {
    expect(areaWeightedBudget(1000, 6.83, 6.83)).toBeCloseTo(1000, 6);
  });

  it('draws fewer near the centre (A<aNorm) and more toward the edge (A>aNorm)', () => {
    const base = 1000;
    const aNorm = 6.83;
    const centre = areaWeightedBudget(base, 1, aNorm); // A=1 at the pole
    const edge = areaWeightedBudget(base, 47, aNorm); // A≈47 at the Dec −45° rim
    expect(centre).toBeLessThan(base);
    expect(edge).toBeGreaterThan(base);
    expect(centre).toBeCloseTo((base * 1) / aNorm, 6);
    expect(edge).toBeCloseTo((base * 47) / aNorm, 6);
  });

  it('is linear in the area factor', () => {
    const a = areaWeightedBudget(500, 2, 7);
    const b = areaWeightedBudget(500, 4, 7);
    expect(b / a).toBeCloseTo(2, 12);
  });

  it('falls back to the base for a non-positive normaliser', () => {
    expect(areaWeightedBudget(500, 10, 0)).toBe(500);
    expect(areaWeightedBudget(500, 10, -1)).toBe(500);
  });
});
