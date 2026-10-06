/**
 * Tests for src/comet-identify.ts — placing MPC comets on a solved photo.
 *
 * Synthetic frames (north up, east left, 2.36″/px) reproduce the geometry of the
 * development database's comet photos: C/2025 R2 (1341×790, centred 341.441°
 * +2.273°) and 10P/Tempel (1147×876, centred 327.783° −24.622°). The 10P photo's
 * stored date (2026-07-27) is ~6 days off: 10P was 2.8° away then and only reached
 * the frame around 2026-08-02 — the case the "nearby" list exists for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCometEls } from '@myastrosky/core/services/identify';
import {
  findComets,
  candidateToPoi,
  jplLookupUrl,
  COMET_CATEGORY_ID,
  NEARBY_RADIUS_DEG,
} from '@myastrosky/core/comet-identify';
import type { CometElements } from '@myastrosky/core/comet-ephemeris';
import { fitPhotoAffine } from '@myastrosky/core/photo-placement';
import { project } from '@myastrosky/core/projection';

const COMETS = parseCometEls(
  readFileSync(join(__dirname, '../fixtures/comets/CometEls-sample.txt'), 'utf-8'),
);

const SCALE_DEG = 2.36 / 3600;

function frame(width: number, height: number, ra0: number, dec0: number) {
  const pixelToSky = (x: number, y: number) => ({
    ra: ra0 - ((x - width / 2) * SCALE_DEG) / Math.cos((dec0 * Math.PI) / 180),
    dec: dec0 - (y - height / 2) * SCALE_DEG,
  });
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
    { x: width / 2, y: height / 2 },
  ];
  const matrix = fitPhotoAffine(
    points,
    points.map((p) => {
      const s = pixelToSky(p.x, p.y);
      return project(s.ra, s.dec);
    }),
  );
  return { width, height, matrix };
}

const R2_FRAME = frame(1341, 790, 341.441, 2.273);
const TEMPEL_FRAME = frame(1147, 876, 327.783, -24.622);

describe('findComets()', () => {
  it('finds C/2025 R2 near the centre of its photo, with its motion', () => {
    const { width, height, matrix } = R2_FRAME;
    const r = findComets(COMETS, matrix!, width, height, '2025-11-07T18:42:00.000Z');
    expect(r.inFrame.map((c) => c.name)).toEqual(['C/2025 R2 (SWAN)']);
    const [r2] = r.inFrame;
    expect(Math.hypot(r2.x - width / 2, r2.y - height / 2)).toBeLessThan(150);
    expect(r2.designation).toBe('C/2025 R2');
    expect(r2.rateArcminPerHour).toBeGreaterThan(3);
    expect(r2.mag).not.toBeNull();
  });

  it('lists 10P as nearby on the wrong stored date, and in frame on the right one', () => {
    const { width, height, matrix } = TEMPEL_FRAME;
    const wrong = findComets(COMETS, matrix!, width, height, '2026-07-27T20:12:00.000Z');
    expect(wrong.inFrame).toEqual([]);
    const tempel = wrong.nearby.find((c) => c.designation === '10P')!;
    expect(tempel.separationDeg).toBeGreaterThan(2.5);
    expect(tempel.separationDeg).toBeLessThan(3.1);

    const right = findComets(COMETS, matrix!, width, height, '2026-08-02T00:00:00.000Z');
    expect(right.inFrame.map((c) => c.designation)).toEqual(['10P']);
  });

  it('ignores comets farther than the nearby radius', () => {
    const { width, height, matrix } = TEMPEL_FRAME;
    // Five days earlier, 10P is well over 3° away.
    const r = findComets(COMETS, matrix!, width, height, '2026-07-20T00:00:00.000Z');
    expect(r.nearby.every((c) => c.separationDeg <= NEARBY_RADIUS_DEG + 1)).toBe(true);
    expect(r.nearby.some((c) => c.designation === '10P')).toBe(false);
  });

  it('drops comets predicted fainter than magnitude 20', () => {
    const { width, height, matrix } = R2_FRAME;
    const faint: CometElements[] = COMETS.map((c) => ({ ...c, h: 30 }));
    const r = findComets(faint, matrix!, width, height, '2025-11-07T18:42:00.000Z');
    expect(r.inFrame).toEqual([]);
  });

  it('keeps comets without magnitude parameters, ranked after the others', () => {
    const { width, height, matrix } = R2_FRAME;
    const r2 = COMETS.find((c) => c.designation === 'C/2025 R2')!;
    const twin: CometElements = { ...r2, designation: 'X', name: 'X (twin)', h: null, k: null };
    const r = findComets([twin, r2], matrix!, width, height, '2025-11-07T18:42:00.000Z');
    expect(r.inFrame.map((c) => c.name)).toEqual(['C/2025 R2 (SWAN)', 'X (twin)']);
  });

  it('returns nothing for an invalid date', () => {
    const { width, height, matrix } = R2_FRAME;
    expect(findComets(COMETS, matrix!, width, height, '')).toEqual({ inFrame: [], nearby: [] });
  });
});

describe('candidateToPoi()', () => {
  it('builds a positioned comet POI, RA normalised to [0, 360)', () => {
    expect(candidateToPoi({ name: '10P/Tempel' }, { ra: -1, dec: -24.6 })).toEqual({
      name: '10P/Tempel',
      categoryId: COMET_CATEGORY_ID,
      ra: 359,
      dec: -24.6,
    });
    expect(COMET_CATEGORY_ID).toBe('cat-comet');
  });
});

describe('jplLookupUrl()', () => {
  it('links the JPL Small-Body Database lookup page', () => {
    expect(jplLookupUrl('C/2025 R2')).toBe(
      'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=C%2F2025%20R2',
    );
  });
});
