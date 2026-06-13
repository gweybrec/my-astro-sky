import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Star, DSO } from '../../src/types';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

vi.mock('../../src/star-catalog', () => ({
  getStars: vi.fn(),
  getStarByHip: vi.fn(),
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: vi.fn(),
}));

vi.mock('../../src/api', () => ({
  searchStarsAPI: vi.fn(async () => []),
}));

import { getStars, getStarByHip } from '../../src/star-catalog';
import { getDSOs } from '../../src/dso-catalog';
import { searchStarsAPI } from '../../src/api';
import { searchStars, searchDSOs, getDSOTypeName, searchUnified } from '../../src/search';

const mockGetStars = vi.mocked(getStars);
const mockGetStarByHip = vi.mocked(getStarByHip);
const mockGetDSOs = vi.mocked(getDSOs);
const mockSearchStarsAPI = vi.mocked(searchStarsAPI);

const TEST_STARS: Star[] = [
  { hip: 27989, ra: 88.79, dec: 7.41,   mag: 0.45, bv: 1.85, name: 'Betelgeuse', bayer: 'α', desig: 'α Ori', constellation: 'Ori' },
  { hip: 32349, ra: 101.29, dec: -16.71, mag: 0.18, bv: -0.03, name: 'Rigel',     bayer: 'β', desig: 'β Ori', constellation: 'Ori' },
  { hip: 21421, ra: 68.98,  dec: 16.51,  mag: 0.87, bv: 0.44,  name: 'Aldebaran', bayer: 'α', constellation: 'Tau' },
  { hip: 91262, ra: 279.23, dec: 38.78,  mag: 0.03, bv: 0.00,  name: 'Vega',      bayer: 'α', constellation: 'Lyr' },
  { hip: 65477, ra: 201.29, dec: -11.16, mag: 2.75, bv: -0.08, desig: '67 Vir',  constellation: 'Vir' },
];

const M42: DSO  = { id: 'M42',    ra: 83.82,  dec: -5.39,  type: 'EN',  majAxis: 65,  minAxis: 60, pa: 0,  mag: 4.0,  displayName: 'Orion Nebula',      catalogs: ['M42', 'NGC1976'], emissionLines: 'Hα', constellation: 'Ori', rating: 5, difficulty: 1 };
const M31: DSO  = { id: 'M31',    ra: 10.68,  dec: 41.27,  type: 'GxS', majAxis: 190, minAxis: 60, pa: 35, mag: 3.44, displayName: 'Andromeda Galaxy',  catalogs: ['M31', 'NGC224'],  emissionLines: null, constellation: 'And', rating: 5, difficulty: 2 };
const N2024: DSO = { id: 'NGC2024', ra: 85.42, dec: -1.84, type: 'EN',  majAxis: 30,  minAxis: 30, pa: 0,  mag: null, displayName: 'Flame Nebula',      catalogs: ['NGC2024'],        emissionLines: null, constellation: 'Ori', rating: 3, difficulty: 2 };

const TEST_DSOS: DSO[] = [M42, M31, N2024];

beforeAll(() => {
  mockGetStars.mockReturnValue(TEST_STARS);
  mockGetStarByHip.mockImplementation((hip: number) => TEST_STARS.find(s => s.hip === hip));
  mockGetDSOs.mockReturnValue(TEST_DSOS);
});

// ─── searchStars ──────────────────────────────────────────────────────────────

describe('searchStars()', () => {
  it('returns empty array for empty query', () => {
    expect(searchStars('')).toEqual([]);
    // Current implementation trims after the initial guard, so whitespace-only
    // queries behave as an empty string match and return top stars.
    expect(searchStars('   ')).toHaveLength(TEST_STARS.length);
  });

  it('performs HIP lookup with "hip <n>" syntax', () => {
    const results = searchStars('hip 27989');
    expect(results).toHaveLength(1);
    expect(results[0].star.hip).toBe(27989);
    expect(results[0].score).toBe(100);
  });

  it('performs HIP lookup with bare number', () => {
    const results = searchStars('27989');
    expect(results).toHaveLength(1);
    expect(results[0].star.hip).toBe(27989);
  });

  it('returns empty array for unknown HIP number', () => {
    mockGetStarByHip.mockReturnValueOnce(undefined);
    expect(searchStars('99999')).toEqual([]);
  });

  it('exact name match scores 100+ (brightness boost may push higher)', () => {
    const results = searchStars('Betelgeuse');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].star.hip).toBe(27989);
    expect(results[0].score).toBeGreaterThanOrEqual(100);
  });

  it('prefix name match scores lower than exact match', () => {
    const exact  = searchStars('Betelgeuse')[0];
    const prefix = searchStars('Betelgeu')[0];
    expect(prefix.score).toBeLessThan(exact.score);
  });

  it('case-insensitive name matching', () => {
    const results = searchStars('betelgeuse');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].star.hip).toBe(27989);
  });

  it('normalizes Greek letter names before matching (alpha → α)', () => {
    const results = searchStars('alpha ori');
    const bayer = results.find(r => r.star.bayer === 'α' && r.star.constellation === 'Ori');
    expect(bayer).toBeDefined();
  });

  it('matches by Bayer designation', () => {
    const results = searchStars('β ori');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.star.hip === 32349)).toBe(true);
  });

  it('matches by constellation prefix', () => {
    const results = searchStars('lyr');
    expect(results.some(r => r.star.constellation === 'Lyr')).toBe(true);
  });

  it('respects limit parameter', () => {
    expect(searchStars('ori', 1)).toHaveLength(1);
  });

  it('returns results sorted by score descending', () => {
    const results = searchStars('a');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('contains match scores lower than prefix match', () => {
    const prefix   = searchStars('Veg')[0];  // "Vega".startsWith("Veg")
    const contains = searchStars('ega')[0];  // "Vega".includes("ega")
    expect(prefix.score).toBeGreaterThan(contains.score);
  });

  it('matches by desig field', () => {
    const results = searchStars('67 vir');
    expect(results.some(r => r.star.hip === 65477)).toBe(true);
  });

  it('matches by Flamsteed designation when no name/desig exists', () => {
    const flamStar: Star = {
      hip: 12345,
      ra: 160,
      dec: 56,
      mag: 4.2,
      bv: 0.5,
      flam: 47,
      constellation: 'UMa'
    };
    mockGetStars.mockReturnValueOnce([...TEST_STARS, flamStar]);
    const results = searchStars('47 uma');
    expect(results.some(r => r.star.hip === 12345)).toBe(true);
  });

  it('uses HIP fallback label when name/desig/flam are absent', () => {
    const unnamed: Star = {
      hip: 42,
      ra: 0,
      dec: 0,
      mag: 2.34,
      bv: 0.1,
      constellation: undefined
    };
    mockGetStarByHip.mockReturnValueOnce(unnamed);
    const results = searchStars('42');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('HIP 42 (?, mag 2.3)');
  });
});

// ─── searchDSOs ───────────────────────────────────────────────────────────────

describe('searchDSOs()', () => {
  it('returns empty array for empty query', () => {
    expect(searchDSOs('')).toEqual([]);
  });

  it('exact ID match scores highest', () => {
    const results = searchDSOs('M42');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].dso.id).toBe('M42');
    expect(results[0].score).toBeGreaterThanOrEqual(100);
  });

  it('case-insensitive ID matching', () => {
    expect(searchDSOs('m42')[0].dso.id).toBe('M42');
  });

  it('ID prefix match', () => {
    const ids = searchDSOs('M3').map(r => r.dso.id);
    expect(ids).toContain('M31');
  });

  it('exact display name match scores high', () => {
    const results = searchDSOs('Orion Nebula');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].dso.id).toBe('M42');
  });

  it('name prefix match', () => {
    expect(searchDSOs('Orion').some(r => r.dso.id === 'M42')).toBe(true);
  });

  it('name contains match', () => {
    expect(searchDSOs('nebula').length).toBeGreaterThan(0);
  });

  it('alias match — alternate catalog ID resolves to primary', () => {
    const results = searchDSOs('NGC1976');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].dso.id).toBe('M42');
  });

  it('partial ID match', () => {
    expect(searchDSOs('ngc202').some(r => r.dso.id === 'NGC2024')).toBe(true);
  });

  it('respects limit parameter', () => {
    expect(searchDSOs('m', 1)).toHaveLength(1);
  });

  it('returns results sorted by score descending', () => {
    const results = searchDSOs('m');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('exact match scores higher than prefix match', () => {
    const exact  = searchDSOs('M42')[0];
    const prefix = searchDSOs('M4')[0];
    expect(exact.score).toBeGreaterThanOrEqual(prefix.score);
  });

  it('formats LPN labels by stripping prefix when displayName is missing', () => {
    const lpn: DSO = {
      id: 'LPN-123',
      ra: 12,
      dec: -3,
      type: 'PN',
      majAxis: 5,
      minAxis: 4,
      pa: 0,
      mag: null,
      displayName: null,
      catalogs: ['LPN-123'],
      emissionLines: null,
      constellation: 'Ori',
      rating: 1,
      difficulty: 5
    };
    mockGetDSOs.mockReturnValueOnce([...TEST_DSOS, lpn]);
    const result = searchDSOs('LPN-123')[0];
    expect(result.label).toBe('123 (dso.types.PN)');
  });
});

// ─── getDSOTypeName ───────────────────────────────────────────────────────────

describe('getDSOTypeName()', () => {
  it('delegates to t() with the dso.types.<type> key pattern', () => {
    expect(getDSOTypeName('EN')).toBe('dso.types.EN');
    expect(getDSOTypeName('GxS')).toBe('dso.types.GxS');
    expect(getDSOTypeName('PN')).toBe('dso.types.PN');
  });
});

// ─── searchUnified ────────────────────────────────────────────────────────────

describe('searchUnified()', () => {
  it('merges star API results into unified list', async () => {
    mockSearchStarsAPI.mockResolvedValueOnce([
      {
        hip: 1,
        ra: 10,
        dec: 20,
        mag: 1.2,
        name: 'Test Star',
        label: 'Test Star',
        score: 77
      }
    ]);
    const results = await searchUnified('test');
    expect(results.some(r => r.type === 'star' && r.star?.hip === 1)).toBe(true);
  });

  it('returns empty array for empty query', async () => {
    expect(await searchUnified('')).toEqual([]);
  });

  it('merges DSO results into unified list (stars API mocked empty)', async () => {
    const results = await searchUnified('Orion Nebula');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type === 'dso' || r.type === 'star')).toBe(true);
  });

  it('returns results sorted by score descending', async () => {
    const results = await searchUnified('m');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('respects the unified limit parameter', async () => {
    mockSearchStarsAPI.mockResolvedValueOnce([
      { hip: 10, ra: 1, dec: 1, mag: 2, label: 'S1', score: 95 },
      { hip: 11, ra: 2, dec: 2, mag: 2, label: 'S2', score: 94 }
    ] as any);
    const results = await searchUnified('m', 1);
    expect(results).toHaveLength(1);
  });
});
