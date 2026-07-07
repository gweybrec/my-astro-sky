import { describe, it, expect } from 'vitest';
import { sortPlanTargets, firstWindowFracByEntry, type PlanSortItem } from '../../src/plan-sort';
import type { DSO } from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDso(overrides: Partial<DSO> = {}): DSO {
  return {
    id: 'x',
    ra: 0,
    dec: 0,
    type: 'GX',
    majAxis: null,
    minAxis: null,
    pa: 0,
    mag: null,
    displayName: 'X',
    catalogs: ['X'],
    emissionLines: null,
    constellation: null,
    rating: null,
    difficulty: null,
    containerId: null,
    priority: 0,
    ...overrides,
  };
}

/** Item at a given transit minute-of-night, with optional DSO metadata. */
function item(entryId: string, transitMin: number, dso: Partial<DSO> = {}): PlanSortItem {
  return {
    entryId,
    dso: makeDso(dso),
    maxAltDeg: 45,
    bestTimeUtc: new Date(2026, 0, 1, 0, transitMin, 0),
  };
}

const ids = (arr: PlanSortItem[]) => arr.map((i) => i.entryId);

// ─── sortPlanTargets ────────────────────────────────────────────────────────

describe('sortPlanTargets', () => {
  it("'transit' orders by culmination time ascending (default behavior)", () => {
    const items = [item('c', 120), item('a', 10), item('b', 60)];
    expect(ids(sortPlanTargets(items, 'transit', new Map()))).toEqual(['a', 'b', 'c']);
  });

  it("'altitude' orders by max altitude descending", () => {
    const items = [
      { ...item('low', 0), maxAltDeg: 20 },
      { ...item('high', 0), maxAltDeg: 80 },
      { ...item('mid', 0), maxAltDeg: 50 },
    ];
    expect(ids(sortPlanTargets(items, 'altitude', new Map()))).toEqual(['high', 'mid', 'low']);
  });

  it("'magnitude' orders brighter (lower mag) first, nulls last (mag ?? 99)", () => {
    const items = [
      item('dim', 0, { mag: 9 }),
      item('none', 0, { mag: null }),
      item('bright', 0, { mag: 3 }),
    ];
    expect(ids(sortPlanTargets(items, 'magnitude', new Map()))).toEqual(['bright', 'dim', 'none']);
  });

  it("'size' orders larger majAxis first, nulls last (majAxis ?? 0)", () => {
    const items = [
      item('small', 0, { majAxis: 5 }),
      item('big', 0, { majAxis: 120 }),
      item('none', 0, { majAxis: null }),
    ];
    expect(ids(sortPlanTargets(items, 'size', new Map()))).toEqual(['big', 'small', 'none']);
  });

  it("'rating' orders higher interest first, nulls last (rating ?? 0)", () => {
    const items = [
      item('mid', 0, { rating: 3 }),
      item('top', 0, { rating: 5 }),
      item('none', 0, { rating: null }),
    ];
    expect(ids(sortPlanTargets(items, 'rating', new Map()))).toEqual(['top', 'mid', 'none']);
  });

  it("'difficulty' orders harder first, nulls last (difficulty ?? 0)", () => {
    const items = [
      item('easy', 0, { difficulty: 1 }),
      item('hard', 0, { difficulty: 5 }),
      item('none', 0, { difficulty: null }),
    ];
    expect(ids(sortPlanTargets(items, 'difficulty', new Map()))).toEqual(['hard', 'easy', 'none']);
  });

  it("'name' orders by catalog designation with numeric collation (M8 < M31 < M100)", () => {
    const items = [
      item('m100', 0, { catalogs: ['M100'] }),
      item('m8', 0, { catalogs: ['M8'] }),
      item('m31', 0, { catalogs: ['M31'] }),
    ];
    expect(ids(sortPlanTargets(items, 'name', new Map()))).toEqual(['m8', 'm31', 'm100']);
  });

  it("'window' orders windowed entries by earliest startFrac; windowless last in transit order", () => {
    // b & c have windows; a & d have none. d transits before a.
    const items = [item('a', 300), item('b', 999), item('c', 999), item('d', 100)];
    const frac = new Map<string, number>([
      ['b', 0.6],
      ['c', 0.2],
    ]);
    // c (0.2) before b (0.6); then windowless d (transit 100) before a (transit 300).
    expect(ids(sortPlanTargets(items, 'window', frac))).toEqual(['c', 'b', 'd', 'a']);
  });

  it('does not mutate the input array', () => {
    const items = [item('c', 120), item('a', 10)];
    const before = ids(items);
    sortPlanTargets(items, 'transit', new Map());
    expect(ids(items)).toEqual(before);
  });
});

// ─── firstWindowFracByEntry ─────────────────────────────────────────────────

describe('firstWindowFracByEntry', () => {
  it('maps each entry to its earliest window startFrac and omits windowless entries', () => {
    const map = firstWindowFracByEntry([
      { id: 'a', observationWindows: [{ startFrac: 0.5 }, { startFrac: 0.2 }] },
      { id: 'b', observationWindows: [] },
      { id: 'c' },
      { id: 'd', observationWindows: [{ startFrac: 0.7 }] },
    ]);
    expect(map.get('a')).toBe(0.2);
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(false);
    expect(map.get('d')).toBe(0.7);
  });
});
