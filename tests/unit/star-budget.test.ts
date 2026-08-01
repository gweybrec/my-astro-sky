import { beforeEach, describe, expect, it } from 'vitest';

import { starAreaBudget, starFaintLimitAt, starMagThreshold } from '../../src/star-budget';
import {
  borderRadiusPU,
  setCenterMode,
  setHemisphere,
  setProjectionMode,
} from '../../src/projection';
import { STAR_BRIGHT_FLOOR_MAG } from '../../src/render-budget';
import type { ViewState } from '../../src/types';

/**
 * The area-weighted star gate. The stereographic projection is not equal-area, so a
 * single magnitude cap would crowd the map centre and empty the rim. Instead a
 * pan-invariant global count is scaled per position by the local area factor: the
 * limit is *brighter* (fewer stars) at the centre and *fainter* (more) at the edge,
 * which is what makes on-screen density uniform.
 */

/**
 * 20000 magnitudes ascending, stands in for the sorted catalog. The cube-root
 * spread mimics a real star catalog (few bright stars, many faint ones); a uniform
 * ramp would put thousands of stars brighter than STAR_BRIGHT_FLOOR_MAG and the
 * floor would flatten every position's limit to the same value.
 */
const MAGS = Array.from({ length: 20000 }, (_, i) => 15 * Math.cbrt(i / 20000));

function view(overrides: Partial<ViewState> = {}): ViewState {
  return {
    centerX: 0,
    centerY: 0,
    scale: 600,
    rotationDeg: 0,
    width: 1000,
    height: 800,
    ...overrides,
  };
}

describe('star-budget', () => {
  beforeEach(() => {
    // Projection module state is global; pin it to plain stereo/north so the
    // area factor is the (1+r²)² form and borderRadiusPU tracks the latitude.
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
  });

  describe('starAreaBudget', () => {
    it('scales the eligible count with scale² at a fixed canvas and budget', () => {
      // Budget/scale chosen so neither the min floor (budget × 2) nor the
      // catalog-length ceiling clamps either sample.
      const a = starAreaBudget(view({ scale: 1000 }), 45, 200, MAGS);
      const b = starAreaBudget(view({ scale: 2000 }), 45, 200, MAGS);
      expect(b.count).toBe(a.count * 4);
    });

    it('floors the count at 2× the budget when zoomed out', () => {
      const b = starAreaBudget(view({ scale: 10 }), 45, 200, MAGS);
      expect(b.count).toBe(400);
    });

    it('is pan-invariant — centerX/centerY do not affect the count', () => {
      const a = starAreaBudget(view({ centerX: 0, centerY: 0 }), 45, 2000, MAGS);
      const b = starAreaBudget(view({ centerX: 3, centerY: -2 }), 45, 2000, MAGS);
      expect(b.count).toBe(a.count);
      expect(b.edgeMag).toBe(a.edgeMag);
    });

    it('derives aNorm from the border radius (1 + r²)', () => {
      const b = starAreaBudget(view(), 45, 2000, MAGS);
      const r = borderRadiusPU(45);
      expect(b.aNorm).toBeCloseTo(1 + r * r, 10);
    });

    it('exposes edgeMag as the faintest limit reached anywhere on the map', () => {
      const b = starAreaBudget(view(), 45, 2000, MAGS);
      // The rim limit: local area factor there equals aNorm², so local count = count·aNorm.
      const rimPU = borderRadiusPU(45);
      const atRim = starFaintLimitAt(rimPU, 0, b);
      expect(b.edgeMag).toBeGreaterThanOrEqual(atRim);
      // and it is fainter than the centre's limit
      expect(b.edgeMag).toBeGreaterThan(starFaintLimitAt(0, 0, b));
    });

    it('caps the count at the catalog length, not an artificial ceiling', () => {
      const b = starAreaBudget(view({ scale: 500000 }), 45, 200, MAGS);
      expect(b.count).toBe(MAGS.length);
    });

    it('lets the min-budget floor win over the catalog cap (pre-existing clamp order)', () => {
      // render-budget's clamp is max(lo, min(hi, v)), so when the floor (budget × 2)
      // exceeds the catalog length the floor wins and the count exceeds the catalog.
      // Pinned as current behaviour — it is unreachable with the real ~5k star
      // catalog and the shipped density range.
      const b = starAreaBudget(view({ scale: 10 }), 45, MAGS.length, MAGS);
      expect(b.count).toBe(MAGS.length * 2);
    });
  });

  describe('starFaintLimitAt', () => {
    it('admits fainter stars toward the edge than at the centre', () => {
      const b = starAreaBudget(view(), 45, 2000, MAGS);
      const centre = starFaintLimitAt(0, 0, b);
      const mid = starFaintLimitAt(0.6, 0, b);
      const edge = starFaintLimitAt(1.5, 0, b);
      expect(mid).toBeGreaterThan(centre);
      expect(edge).toBeGreaterThan(mid);
    });

    it('depends only on radius, not direction', () => {
      const b = starAreaBudget(view(), 45, 2000, MAGS);
      const r = 0.8;
      expect(starFaintLimitAt(r, 0, b)).toBe(starFaintLimitAt(0, r, b));
      expect(starFaintLimitAt(-r, 0, b)).toBe(starFaintLimitAt(0, -r, b));
    });

    it('never returns brighter than the bright-anchor floor, even at zero budget', () => {
      const b = starAreaBudget(view({ scale: 1 }), 45, 0, MAGS);
      expect(starFaintLimitAt(0, 0, b)).toBe(STAR_BRIGHT_FLOOR_MAG);
    });
  });

  describe('starMagThreshold', () => {
    it('is the un-weighted threshold — between the centre and edge limits', () => {
      const b = starAreaBudget(view(), 45, 2000, MAGS);
      const t = starMagThreshold(b);
      expect(t).toBeGreaterThanOrEqual(starFaintLimitAt(0, 0, b));
      expect(t).toBeLessThanOrEqual(b.edgeMag);
    });

    it('honours the bright-anchor floor', () => {
      const b = starAreaBudget(view({ scale: 1 }), 45, 0, MAGS);
      expect(starMagThreshold(b)).toBe(STAR_BRIGHT_FLOOR_MAG);
    });
  });
});
