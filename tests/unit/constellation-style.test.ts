import { describe, it, expect } from 'vitest';
import { isIAUStyle, IAU_CONSTELLATION_STYLES, type ConstellationStyle } from '../../src/types';
import { parseConstellationLines, normalizeRA } from '../../src/star-catalog';

// ─── isIAUStyle ───────────────────────────────────────────────────────────────

describe('isIAUStyle', () => {
  it('returns true for western, stellarium, rey', () => {
    expect(isIAUStyle('western')).toBe(true);
    expect(isIAUStyle('stellarium')).toBe(true);
    expect(isIAUStyle('rey')).toBe(true);
  });

  it('returns false for chinese and arabic', () => {
    expect(isIAUStyle('chinese')).toBe(false);
    expect(isIAUStyle('arabic')).toBe(false);
  });

  it('IAU_CONSTELLATION_STYLES contains exactly western, stellarium, rey', () => {
    expect(IAU_CONSTELLATION_STYLES).toHaveLength(3);
    expect(IAU_CONSTELLATION_STYLES).toContain('western');
    expect(IAU_CONSTELLATION_STYLES).toContain('stellarium');
    expect(IAU_CONSTELLATION_STYLES).toContain('rey');
  });
});

// ─── normalizeRA ─────────────────────────────────────────────────────────────

describe('normalizeRA', () => {
  it('keeps values already in [0, 360) unchanged', () => {
    expect(normalizeRA(0)).toBe(0);
    expect(normalizeRA(180)).toBe(180);
    expect(normalizeRA(359.9)).toBeCloseTo(359.9);
  });

  it('wraps negative values into [0, 360)', () => {
    expect(normalizeRA(-1)).toBeCloseTo(359);
    expect(normalizeRA(-90)).toBeCloseTo(270);
    expect(normalizeRA(-180)).toBeCloseTo(180);
  });

  it('wraps values >= 360', () => {
    expect(normalizeRA(360)).toBe(0);
    expect(normalizeRA(361)).toBeCloseTo(1);
    expect(normalizeRA(540)).toBeCloseTo(180);
  });
});

// ─── parseConstellationLines ──────────────────────────────────────────────────

describe('parseConstellationLines', () => {
  it('converts a GeoJSON FeatureCollection to ConstellationLine[]', () => {
    const geoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'Ori',
          properties: { rank: '1' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [90.0, 10.0],
                [91.0, 11.0],
                [92.0, 12.0],
              ],
              [
                [85.0, 5.0],
                [86.0, 6.0],
              ],
            ],
          },
        },
      ],
    };

    const result = parseConstellationLines(geoJSON);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('Ori');
    expect(result[0].segments).toHaveLength(2);
    expect(result[0].segments[0]).toHaveLength(3);
    expect(result[0].segments[0][0]).toEqual([90, 10]);
  });

  it('normalizes negative RA values into [0, 360)', () => {
    const geoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'Cyg',
          properties: { rank: '1' },
          geometry: {
            type: 'MultiLineString',
            // -60 RA should become 300
            coordinates: [
              [
                [-60.0, 45.0],
                [-50.0, 40.0],
              ],
            ],
          },
        },
      ],
    };

    const result = parseConstellationLines(geoJSON);
    expect(result[0].segments[0][0][0]).toBeCloseTo(300);
    expect(result[0].segments[0][1][0]).toBeCloseTo(310);
  });

  it('handles multiple constellations', () => {
    const geoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'And',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [10, 40],
                [15, 35],
              ],
            ],
          },
        },
        {
          id: 'Cas',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [20, 60],
                [25, 63],
                [30, 60],
              ],
            ],
          },
        },
      ],
    };

    const result = parseConstellationLines(geoJSON);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['And', 'Cas']);
  });

  it('returns empty array for empty FeatureCollection', () => {
    const geoJSON = { type: 'FeatureCollection', features: [] };
    expect(parseConstellationLines(geoJSON)).toEqual([]);
  });
});
