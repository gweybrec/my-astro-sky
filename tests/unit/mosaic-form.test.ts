import { describe, it, expect, vi } from 'vitest';

vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  getDSOById: vi.fn((id: string) =>
    id === 'M42' ? { id: 'M42', ra: 83.8, dec: -5.4 } : undefined,
  ),
}));

import {
  clampOverlap,
  entriesCoveredByMosaic,
  keptMosaicLayout,
  mosaicPlacement,
  mosaicSummary,
  mosaicTiles,
} from '@myastrosky/core/mosaic-form';

const m31 = { ra: 10.68, dec: 41.27, majAxis: 190, minAxis: 60, pa: 35 };

describe('mosaicPlacement', () => {
  it('centres on one object, along its angle, with a grid that covers it', () => {
    const p = mosaicPlacement([m31], 1.2, 0.8, 20);
    expect(p.center.ra).toBeCloseTo(10.68);
    expect(p.center.dec).toBeCloseTo(41.27);
    expect(p.paDeg).toBe(35);
    // 3.8° × 1.2° padded by 20 % with 1.2° × 0.8° tiles at 20 % overlap.
    expect(p.auto.cols).toBeGreaterThanOrEqual(1);
    expect(p.auto.rows).toBeGreaterThan(p.auto.cols);
  });

  it('keeps an edited mosaic where it is when no object is picked', () => {
    const p = mosaicPlacement([], 1.2, 0.8, 20, { centerRa: 5, centerDec: 6, paDeg: 7 });
    expect(p).toEqual({ center: { ra: 5, dec: 6 }, paDeg: 7, auto: { cols: 1, rows: 1 } });
  });
});

describe('keptMosaicLayout', () => {
  const edited = {
    id: 'm1',
    dsoId: 'M31',
    centerRa: 11,
    centerDec: 42,
    paDeg: 67,
    overlapPct: 20,
    cols: 2,
    rows: 2,
  };
  // A rotated 2 × 2 mosaic with one tile removed, and a frame of another mosaic.
  const entries = [
    { mosaicId: 'm1', ra: 10.5, dec: 41.5, paDeg: 67 },
    { mosaicId: 'm1', ra: 11.5, dec: 41.8, paDeg: 67 },
    { mosaicId: 'm1', ra: 10.8, dec: 42.4, paDeg: 67 },
    { mosaicId: 'm2', ra: 50, dec: 10, paDeg: 0 },
  ];

  it('keeps the place, angle and tiles of a rename alone', () => {
    expect(keptMosaicLayout(edited, entries, ['M31'], 20, 2, 2)).toEqual({
      center: { ra: 11, dec: 42 },
      paDeg: 67,
      tiles: entries.slice(0, 3).map(({ ra, dec, paDeg }) => ({ ra, dec, paDeg })),
    });
  });

  it('lays the grid out again once the objects, overlap or grid change', () => {
    expect(keptMosaicLayout(edited, entries, ['M42'], 20, 2, 2)).toBeNull();
    expect(keptMosaicLayout(edited, entries, [], 20, 2, 2)).toBeNull();
    expect(keptMosaicLayout(edited, entries, ['M31', 'M42'], 20, 2, 2)).toBeNull();
    expect(keptMosaicLayout(edited, entries, ['M31'], 30, 2, 2)).toBeNull();
    expect(keptMosaicLayout(edited, entries, ['M31'], 20, 3, 2)).toBeNull();
  });

  it('keeps a mosaic with no object when none is picked, unless it has no tile', () => {
    const free = { ...edited, dsoId: null };
    expect(keptMosaicLayout(free, entries, [], 20, 2, 2)?.paDeg).toBe(67);
    expect(keptMosaicLayout(free, entries, ['M31'], 20, 2, 2)).toBeNull();
    expect(keptMosaicLayout(free, [], [], 20, 2, 2)).toBeNull();
  });
});

describe('mosaic form helpers', () => {
  it('clamps the overlap and falls back to 20 %', () => {
    expect(clampOverlap(120)).toBe(90);
    expect(clampOverlap(-3)).toBe(0);
    expect(clampOverlap(NaN)).toBe(20);
  });

  it('lays out cols × rows tiles with the mosaic angle', () => {
    const tiles = mosaicTiles({ ra: 10, dec: 40 }, 15, 3, 2, 1, 1, 20);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((tl) => tl.paDeg === 15)).toBe(true);
  });

  it('writes the summary with the outline of the grid', () => {
    const text = mosaicSummary(
      3,
      2,
      2.5,
      1.7,
      20,
      'tuiles',
      (w, h) => `${w.toFixed(1)}×${h.toFixed(2)}`,
    );
    expect(text).toBe('3×2 · 6 tuiles · 6.5×3.06');
  });

  it('finds the standalone frames a new mosaic replaces', () => {
    const entries = [
      { id: 'same', dsoId: 'M42', ra: null, dec: null, mosaicId: null },
      { id: 'inside', dsoId: null, ra: 83.9, dec: -5.3, mosaicId: null },
      { id: 'far', dsoId: null, ra: 120, dec: 30, mosaicId: null },
      { id: 'tile', dsoId: 'M42', ra: 83.8, dec: -5.4, mosaicId: 'm1' },
    ];
    const ids = entriesCoveredByMosaic(entries, 'M42', { ra: 83.8, dec: -5.4 }, 2, 2, 1, 1, 20);
    expect(ids).toEqual(['same', 'inside']);
  });
});
