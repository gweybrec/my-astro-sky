import { describe, it, expect } from 'vitest';
import { dsoImportance } from '../../src/dso-catalog';
import type { DSO } from '../../src/types';

// dsoImportance only reads `rating` and `mag`; build minimal stand-ins.
const dso = (rating: number | null, mag: number | null): DSO => ({ rating, mag }) as unknown as DSO;

describe('dsoImportance', () => {
  it('mirrors the build-time formula rating*100 − mag*0.01', () => {
    expect(dsoImportance(dso(5, 8))).toBeCloseTo(5 * 100 - 8 * 0.01, 10);
    expect(dsoImportance(dso(3, 12))).toBeCloseTo(300 - 0.12, 10);
  });

  it('is dominated by rating (a higher rating always outranks a lower one)', () => {
    // Even a much brighter (lower-mag) low-rated object stays below a high-rated faint one.
    expect(dsoImportance(dso(4, 15))).toBeGreaterThan(dsoImportance(dso(3, 1)));
  });

  it('breaks ties by brightness — brighter (lower mag) ranks higher', () => {
    expect(dsoImportance(dso(4, 6))).toBeGreaterThan(dsoImportance(dso(4, 9)));
  });

  it('defaults null rating→0 and null mag→99, so unrated/faint objects rank lowest', () => {
    expect(dsoImportance(dso(null, null))).toBeCloseTo(0 * 100 - 99 * 0.01, 10);
    // A rated object always beats a fully-unrated one.
    expect(dsoImportance(dso(1, 20))).toBeGreaterThan(dsoImportance(dso(null, 5)));
  });

  it('sorting desc by importance yields rating-desc then mag-asc order', () => {
    const objs = [dso(2, 5), dso(5, 10), dso(5, 3), dso(null, 8), dso(2, 1)];
    const sorted = [...objs].sort((a, b) => dsoImportance(b) - dsoImportance(a));
    expect(sorted).toEqual([dso(5, 3), dso(5, 10), dso(2, 1), dso(2, 5), dso(null, 8)]);
  });
});
