import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, getLang: () => 'en' }));

import { multipleStarRating } from '../../src/multiple-stars';

// A setup that resolves everything down to 1″ (so the resolution gate never fires unless
// we pass a coarse limit explicitly).
const SHARP = 1;

describe('multipleStarRating', () => {
  it('rates Albireo 5★ (strong colour contrast, balanced, comfortable 34″ split)', () => {
    // β1 Cyg (bv 1.09, mag 3.05) + β2 Cyg (bv -0.10, mag 5.12), sep 34.3″
    expect(multipleStarRating(1.09, -0.1, 3.05, 5.12, 34.3, SHARP)).toBe(5);
  });

  it('rates Sirius 1★ (no colour contrast, Δmag ≈ 10)', () => {
    // α CMa (bv 0.01, mag -1.44) + Sirius B (bv 0.0, mag 8.44), sep 11″
    expect(multipleStarRating(0.01, 0.0, -1.44, 8.44, 11.0, SHARP)).toBe(1);
  });

  it('returns 0★ when the pair is tighter than the setup can resolve', () => {
    // Albireo-quality pair, but a setup whose resolving limit is 40″ > 34.3″ split
    expect(multipleStarRating(1.09, -0.1, 3.05, 5.12, 34.3, 40)).toBe(0);
    // …and recovers once the setup resolves it
    expect(multipleStarRating(1.09, -0.1, 3.05, 5.12, 34.3, 10)).toBeGreaterThan(0);
  });

  it('never returns below 1★ for a resolvable pair, and clamps to 5', () => {
    const r = multipleStarRating(0.0, 0.0, 5.0, 5.0, 10, SHARP); // dull but resolvable
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(5);
  });
});
