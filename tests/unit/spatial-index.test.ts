import { describe, it, expect } from 'vitest';
import { SpatialIndex } from '../../src/spatial-index';

describe('SpatialIndex', () => {
  describe('findNearest', () => {
    it('returns null for empty index', () => {
      const idx = new SpatialIndex<string>(1);
      expect(idx.findNearest(0, 0, 100)).toBeNull();
    });

    it('returns null when no item is within radius', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('A', 10, 10);
      expect(idx.findNearest(0, 0, 5)).toBeNull();
    });

    it('finds the single inserted item within radius', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('A', 3, 4); // distance from origin = 5
      expect(idx.findNearest(0, 0, 6)).toBe('A');
    });

    it('returns the nearest of two candidates', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('near', 1, 0); // distance = 1
      idx.insert('far', 10, 0); // distance = 10
      expect(idx.findNearest(0, 0, 20)).toBe('near');
    });

    it('finds item at exact radius boundary (strictly less than)', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('exact', 5, 0); // distance = 5
      // findNearest uses < not <=, so exact boundary is excluded
      expect(idx.findNearest(0, 0, 5)).toBeNull();
      expect(idx.findNearest(0, 0, 5.001)).toBe('exact');
    });
  });

  describe('findAll', () => {
    it('returns empty array for empty index', () => {
      const idx = new SpatialIndex<number>(1);
      expect(idx.findAll(0, 0, 100)).toEqual([]);
    });

    it('returns only items within radius', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('in', 3, 0); // distance = 3
      idx.insert('out', 10, 0); // distance = 10
      const result = idx.findAll(0, 0, 5);
      expect(result).toContain('in');
      expect(result).not.toContain('out');
    });

    it('returns multiple items sorted by distance ascending', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('B', 4, 0);
      idx.insert('A', 1, 0);
      idx.insert('C', 7, 0);
      const result = idx.findAll(0, 0, 10);
      expect(result[0]).toBe('A');
      expect(result[1]).toBe('B');
      expect(result[2]).toBe('C');
    });

    it('increasing radius finds more items', () => {
      const idx = new SpatialIndex<string>(2);
      idx.insert('r1', 1, 0);
      idx.insert('r5', 5, 0);
      idx.insert('r9', 9, 0);
      expect(idx.findAll(0, 0, 2).length).toBe(1);
      expect(idx.findAll(0, 0, 6).length).toBe(2);
      expect(idx.findAll(0, 0, 10).length).toBe(3);
    });
  });

  describe('collect', () => {
    it('returns empty array for empty index', () => {
      const idx = new SpatialIndex<number>(1);
      expect(idx.collect(0, 0, 100)).toEqual([]);
    });

    it('returns exactly the items within radius (any order), including the boundary', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('in', 3, 0); // distance = 3
      idx.insert('edge', 5, 0); // distance = 5 (collect uses <=)
      idx.insert('out', 10, 0); // distance = 10
      const result = idx.collect(0, 0, 5);
      expect(new Set(result)).toEqual(new Set(['in', 'edge']));
    });

    it('matches findAll as a set (collect is just findAll without the sort)', () => {
      const idx = new SpatialIndex<string>(2);
      idx.insert('A', 1, 0);
      idx.insert('B', 4, 3); // distance = 5
      idx.insert('C', 7, 0);
      idx.insert('D', 20, 20); // far outside
      const r = 8;
      expect(new Set(idx.collect(0, 0, r))).toEqual(new Set(idx.findAll(0, 0, r)));
    });
  });

  describe('clear', () => {
    it('removes all items', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('A', 1, 1);
      idx.clear();
      expect(idx.findNearest(1, 1, 10)).toBeNull();
      expect(idx.findAll(1, 1, 10)).toEqual([]);
    });
  });

  // The query loops clamp their cell range to the index's populated bounds so a query
  // radius far larger than the data extent (e.g. the 1/scale viewport radius when zoomed
  // way out) costs O(occupied cells), not O(radius²). These assert the clamp changes cost
  // only — never the returned results.
  describe('bounds clamp (huge query radius)', () => {
    it('a giant radius returns the same set as a radius that already covers all items', () => {
      const idx = new SpatialIndex<string>(0.02); // same tiny cell size as the DSO index
      const pts: [string, number, number][] = [
        ['A', 0, 0],
        ['B', 1, -1],
        ['C', -1.5, 0.5],
        ['D', 0.3, 1.8],
      ];
      for (const [name, x, y] of pts) idx.insert(name, x, y);
      // radius 5 already covers every point; 1e9 is the pathological zoomed-out case.
      const tight = new Set(idx.collect(0, 0, 5));
      const huge = new Set(idx.collect(0, 0, 1e9));
      expect(huge).toEqual(tight);
      expect(huge).toEqual(new Set(['A', 'B', 'C', 'D']));
    });

    it('findAll with a giant radius still returns every item in correct distance order', () => {
      const idx = new SpatialIndex<string>(0.02);
      idx.insert('B', 4, 0);
      idx.insert('A', 1, 0);
      idx.insert('C', 7, 0);
      expect(idx.findAll(0, 0, 1e9)).toEqual(['A', 'B', 'C']);
    });

    it('findNearest with a giant radius still returns the true nearest', () => {
      const idx = new SpatialIndex<string>(0.02);
      idx.insert('near', 1, 0);
      idx.insert('far', 10, 0);
      expect(idx.findNearest(0, 0, 1e9)).toBe('near');
    });

    it('a query box entirely outside the populated bounds returns nothing (loop clamps empty)', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('A', 0, 0);
      idx.insert('B', 1, 1);
      // Query centred far from the data with a radius too small to reach it.
      expect(idx.collect(1000, 1000, 5)).toEqual([]);
      expect(idx.findAll(1000, 1000, 5)).toEqual([]);
      expect(idx.findNearest(1000, 1000, 5)).toBeNull();
    });

    it('recomputes bounds after clear + re-insert (no stale over/under-scan)', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('old', 100, 100);
      idx.clear();
      idx.insert('new', 2, 2);
      // A huge query must find only the re-inserted item, and a query near the old
      // location must find nothing (stale bounds would let the loop over-scan there).
      expect(new Set(idx.collect(0, 0, 1e9))).toEqual(new Set(['new']));
      expect(idx.findNearest(100, 100, 3)).toBeNull();
    });
  });
});
