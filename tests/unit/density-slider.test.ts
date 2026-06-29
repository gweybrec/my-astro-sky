import { describe, it, expect } from 'vitest';
import {
  sliderPosToBudget, budgetToSliderPos, SLIDER_STEPS,
  estimateInitialDensity,
  STAR_DENSITY_MAX, DSO_DENSITY_MAX,
} from '../../src/density-slider';

const MAX = 5000;

describe('sliderPosToBudget()', () => {
  it('maps the endpoints to 0 and max', () => {
    expect(sliderPosToBudget(0, MAX)).toBe(0);
    expect(sliderPosToBudget(SLIDER_STEPS, MAX)).toBe(MAX);
  });

  it('is monotonic non-decreasing', () => {
    let prev = -1;
    for (let p = 0; p <= SLIDER_STEPS; p += 50) {
      const v = sliderPosToBudget(p, MAX);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('is coarse near the max and fine near 0 (ease-in)', () => {
    // Equal slider steps produce a large budget jump near the max and a small one near 0.
    const stepLow = sliderPosToBudget(100, MAX) - sliderPosToBudget(0, MAX);
    const stepHigh = sliderPosToBudget(SLIDER_STEPS, MAX) - sliderPosToBudget(SLIDER_STEPS - 100, MAX);
    expect(stepHigh).toBeGreaterThan(stepLow);
  });

  it('clamps out-of-range positions', () => {
    expect(sliderPosToBudget(-100, MAX)).toBe(0);
    expect(sliderPosToBudget(SLIDER_STEPS + 500, MAX)).toBe(MAX);
  });
});

describe('budgetToSliderPos()', () => {
  it('round-trips with sliderPosToBudget (within rounding)', () => {
    for (const pos of [0, 120, 333, 500, 750, 900, SLIDER_STEPS]) {
      const budget = sliderPosToBudget(pos, MAX);
      const back = budgetToSliderPos(budget, MAX);
      expect(Math.abs(back - pos)).toBeLessThanOrEqual(1);
    }
  });

  it('maps endpoints back to 0 and SLIDER_STEPS', () => {
    expect(budgetToSliderPos(0, MAX)).toBe(0);
    expect(budgetToSliderPos(MAX, MAX)).toBe(SLIDER_STEPS);
  });

  it('clamps budgets above the max', () => {
    expect(budgetToSliderPos(MAX * 2, MAX)).toBe(SLIDER_STEPS);
  });
});

describe('estimateInitialDensity()', () => {
  it('gives a higher budget to more capable hardware', () => {
    const low = estimateInitialDensity(2, 2, false);
    const high = estimateInitialDensity(16, 32, false);
    expect(high.star).toBeGreaterThan(low.star);
    expect(high.dso).toBeGreaterThan(low.dso);
  });

  it('is monotonic non-decreasing in cores', () => {
    let prev = -1;
    for (const cores of [1, 2, 4, 6, 8, 12, 16, 32]) {
      const v = estimateInitialDensity(cores, 8, false).star;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('reduces the budget on mobile', () => {
    const desktop = estimateInitialDensity(8, 8, false);
    const mobile = estimateInitialDensity(8, 8, true);
    expect(mobile.star).toBeLessThan(desktop.star);
    expect(mobile.dso).toBeLessThan(desktop.dso);
  });

  it('stays within sane bounds for extreme inputs', () => {
    const tiny = estimateInitialDensity(1, 1, true);
    const huge = estimateInitialDensity(128, 256, false);
    for (const v of [tiny, huge]) {
      expect(v.star).toBeGreaterThan(0);
      expect(v.star).toBeLessThanOrEqual(STAR_DENSITY_MAX);
      expect(v.dso).toBeGreaterThan(0);
      expect(v.dso).toBeLessThanOrEqual(DSO_DENSITY_MAX);
    }
    // The first-impression seed is deliberately modest, never the absolute max.
    expect(huge.star).toBeLessThan(STAR_DENSITY_MAX);
  });
});
