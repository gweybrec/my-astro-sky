// @vitest-environment node
/** The star-search service over a small in-memory catalogue (no database, no file). */
import { describe, expect, it, vi } from 'vitest';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { DeepStar } from '@myastrosky/core/domain/stars';
import { createStarSearchService } from '@myastrosky/core/services/star-search';

const VEGA = 91262;
const NEIGHBOUR = 91300;
const FAR = 10000;
const NO_NAME = 5;

const STARS: DeepStar[] = [
  {
    hip: VEGA,
    ra: 279.2347,
    dec: 38.7837,
    mag: 0.03,
    bv: 0,
    name: 'Vega',
    bayer: 'α',
    flam: '3',
    constellation: 'Lyr',
    desig: 'α',
  },
  { hip: FAR, ra: 24.4285, dec: -57.2368, mag: 1.1, bv: 0 },
  {
    hip: NEIGHBOUR,
    ra: 279.5,
    dec: 38.9,
    mag: 4.2,
    bv: 0,
    bayer: 'ε',
    constellation: 'Lyr',
    desig: 'ε',
  },
  { hip: NO_NAME, ra: 10, dec: 10, mag: 9.04, bv: 0, constellation: 'Cet' },
];

function service() {
  return createStarSearchService({ stars: STARS });
}

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

describe('search', () => {
  it('resolves a direct HIP lookup with a perfect score', async () => {
    const s = service();
    const byNumber = await s.search('91262');
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].hip).toBe(VEGA);
    expect(byNumber[0].score).toBe(100);
    expect((await s.search('HIP 91262'))[0].hip).toBe(VEGA);
    expect(await s.search('99999999')).toEqual([]);
  });

  it('matches by proper name and labels the result', async () => {
    const res = await service().search('vega');
    expect(res[0].hip).toBe(VEGA);
    expect(res[0].label).toBe('Vega (α Lyr)');
  });

  it('labels a star without a name by designation, Flamsteed number or HIP', async () => {
    const s = service();
    expect((await s.search('epsilon lyr'))[0].label).toBe('ε Lyr');
    expect((await s.search('cet'))[0].label).toBe('HIP 5 (Cet, mag 9.0)');
  });

  it('normalizes Latin Greek letter names before matching designations', async () => {
    const res = await service().search('epsilon lyr');
    expect(res.some((r) => r.hip === NEIGHBOUR)).toBe(true);
  });

  it('scores a name match above a designation match and boosts brighter stars', async () => {
    const res = await service().search('lyr');
    expect(res.map((r) => r.hip)).toEqual([VEGA, NEIGHBOUR]);
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it('returns an empty array for an empty or non-text query', async () => {
    const s = service();
    expect(await s.search('')).toEqual([]);
    expect(await s.search(undefined as unknown as string)).toEqual([]);
  });

  it('honours the result limit and clamps it to 1..50', async () => {
    const s = service();
    expect(await s.search('lyr', 1)).toHaveLength(1);
    expect(await s.search('lyr', 0)).toHaveLength(2);
    expect(await s.search('lyr', -5)).toHaveLength(1);
    expect(await s.search('lyr', NaN)).toHaveLength(2);
  });
});

describe('nearby', () => {
  it('returns stars within the radius sorted brightest-first', async () => {
    const res = await service().nearby({ ra: 279.2347, dec: 38.7837, radius: 2 });
    const hips = res.map((r) => r.hip);
    expect(hips).toContain(VEGA);
    expect(hips).toContain(NEIGHBOUR);
    expect(hips).not.toContain(FAR);
    expect(res[0].hip).toBe(VEGA);
    expect(res[0].score).toBe(0);
    expect(res.map((r) => r.mag)).toEqual([...res.map((r) => r.mag)].sort((a, b) => a - b));
  });

  it('respects the magnitude limit (default 10)', async () => {
    const s = service();
    const res = await s.nearby({ ra: 279.2347, dec: 38.7837, radius: 2, magLimit: 1 });
    expect(res.map((r) => r.hip)).toEqual([VEGA]);
    // NO_NAME has mag 9.04: inside the default limit of 10, outside a limit of 9.
    expect((await s.nearby({ ra: 10, dec: 10, radius: 1 })).map((r) => r.hip)).toEqual([NO_NAME]);
    expect(await s.nearby({ ra: 10, dec: 10, radius: 1, magLimit: 9 })).toEqual([]);
  });

  it('returns nothing when no star falls inside the radius', async () => {
    expect(await service().nearby({ ra: 0, dec: 0, radius: 0.5 })).toEqual([]);
  });

  it('clamps the result limit to 1..100 (default 20)', async () => {
    const many: DeepStar[] = Array.from({ length: 150 }, (_, i) => ({
      hip: i + 1,
      ra: 100,
      dec: 0,
      mag: i / 100,
      bv: 0,
    }));
    const s = createStarSearchService({ stars: many });
    const q = { ra: 100, dec: 0, radius: 1 };
    expect(await s.nearby(q)).toHaveLength(20);
    expect(await s.nearby({ ...q, limit: 500 })).toHaveLength(100);
    expect(await s.nearby({ ...q, limit: 3 })).toHaveLength(3);
    expect(await s.nearby({ ...q, limit: -2 })).toHaveLength(1);
  });
});

describe('getByHip', () => {
  it('returns the star without label or score', async () => {
    const star = await service().getByHip(VEGA);
    expect(star.name).toBe('Vega');
    expect(star).not.toHaveProperty('label');
    expect(star).not.toHaveProperty('score');
  });

  it('rejects a non-integer HIP with INVALID_HIP', async () => {
    const err = await rejection(service().getByHip(NaN));
    expect(isDomainError(err) && err.kind).toBe('invalid');
    expect(isDomainError(err) && err.code).toBe('INVALID_HIP');
    expect(isDomainError(err) && err.body).toEqual({ error: 'HIP invalide', code: 'INVALID_HIP' });
  });

  it('reports an unknown star with STAR_NOT_FOUND', async () => {
    const err = await rejection(service().getByHip(99999999));
    expect(isDomainError(err) && err.kind).toBe('notFound');
    expect(isDomainError(err) && err.body).toEqual({
      error: 'Étoile introuvable',
      code: 'STAR_NOT_FOUND',
    });
  });
});

describe('catalogue source', () => {
  it('accepts a synchronous or asynchronous loader and calls it once', async () => {
    const loader = vi.fn(async () => STARS);
    const s = createStarSearchService({ stars: loader });
    await Promise.all([s.search('vega'), s.nearby({ ra: 0, dec: 0, radius: 1 })]);
    await s.getByHip(VEGA);
    expect(loader).toHaveBeenCalledTimes(1);

    const sync = createStarSearchService({ stars: () => STARS });
    expect((await sync.getByHip(FAR)).hip).toBe(FAR);
  });
});
