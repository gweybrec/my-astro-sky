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
      idx.insert('near', 1, 0);   // distance = 1
      idx.insert('far', 10, 0);   // distance = 10
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
      idx.insert('in', 3, 0);   // distance = 3
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

  describe('clear', () => {
    it('removes all items', () => {
      const idx = new SpatialIndex<string>(1);
      idx.insert('A', 1, 1);
      idx.clear();
      expect(idx.findNearest(1, 1, 10)).toBeNull();
      expect(idx.findAll(1, 1, 10)).toEqual([]);
    });
  });
});
