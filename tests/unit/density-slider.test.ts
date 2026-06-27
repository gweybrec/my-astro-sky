import { describe, it, expect } from 'vitest';
import {
  sliderPosToBudget, budgetToSliderPos, SLIDER_STEPS,
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
