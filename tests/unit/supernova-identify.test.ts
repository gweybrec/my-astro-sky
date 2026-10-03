/**
 * Tests for src/supernova-identify.ts — the pure logic behind the supernova
 * identification modal: the TNS cone covering a photo, the discovery-date window
 * around the observation date, placing candidates on the photo and ranking them.
 *
 * Replays the real TNS CSV export around NGC 7331
 * (tests/fixtures/tns/ngc7331-search.csv) through a synthetic 664×470 frame at
 * 1.5″/px centred on the galaxy — the size of test-photos/NGC7331_CCD_2026aaiv.fit.
 * The test photos' two supernovae, SN 2025rbs and SN 2026aaiv, must each be the
 * one found for "their" observation date.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  photoFieldCircle,
  searchWindow,
  daysFromDiscovery,
  placeInImage,
  rankTransients,
  candidateToPoi,
  formatDaysFromDiscovery,
  SUPERNOVA_CATEGORY_ID,
  type TnsCandidate,
  type PlacedTransient,
} from '../../src/supernova-identify';
import { fitPhotoAffine } from '../../src/photo-placement';
import { project } from '../../src/projection';
import { parseTnsCsv } from '../../server/tns';

const CANDIDATES: TnsCandidate[] = parseTnsCsv(
  readFileSync(join(__dirname, '../fixtures/tns/ngc7331-search.csv'), 'utf-8'),
);

const W = 664;
const H = 470;
const RA0 = 339.267614;
const DEC0 = 34.419887;
const SCALE_DEG = 1.5 / 3600;

/** Small-angle sky position of a photo pixel: north up, east left. */
function pixelToSky(x: number, y: number) {
  return {
    ra: RA0 - ((x - W / 2) * SCALE_DEG) / Math.cos((DEC0 * Math.PI) / 180),
    dec: DEC0 - (y - H / 2) * SCALE_DEG,
  };
}

const PHOTO_POINTS = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H },
  { x: W / 2, y: H / 2 },
];
const PHOTO_TO_PROJ = fitPhotoAffine(
  PHOTO_POINTS,
  PHOTO_POINTS.map((p) => {
    const s = pixelToSky(p.x, p.y);
    return project(s.ra, s.dec);
  }),
);

function inWindow(c: TnsCandidate, obsIso: string) {
  const w = searchWindow(obsIso)!;
  const day = c.discoveryDate!.slice(0, 10);
  return day >= w.dateStart && day <= w.dateEnd;
}

describe('photoFieldCircle()', () => {
  it('is centred on the photo and reaches its corners', () => {
    const f = photoFieldCircle(PHOTO_TO_PROJ, W, H);
    expect(f.raDeg).toBeCloseTo(RA0, 3);
    expect(f.decDeg).toBeCloseTo(DEC0, 3);
    // Half-diagonal of 664×470 px at 1.5″/px ≈ 10.2′, +5 % margin.
    expect(f.radiusArcmin).toBeGreaterThan(10.1);
    expect(f.radiusArcmin).toBeLessThan(11);
    expect(f.truncated).toBe(false);
  });

  it('caps a very wide field at 60′ and flags it', () => {
    const wide = {
      ...PHOTO_TO_PROJ,
      a: PHOTO_TO_PROJ.a * 20,
      b: PHOTO_TO_PROJ.b * 20,
      c: PHOTO_TO_PROJ.c * 20,
      d: PHOTO_TO_PROJ.d * 20,
    };
    const f = photoFieldCircle(wide, W, H);
    expect(f.radiusArcmin).toBe(60);
    expect(f.truncated).toBe(true);
  });
});

describe('searchWindow()', () => {
  it('spans a year before to 60 days after the observation', () => {
    expect(searchWindow('2026-09-04T20:02:11Z')).toEqual({
      dateStart: '2025-09-04',
      dateEnd: '2026-11-03',
    });
  });

  it('returns null for an invalid date', () => {
    expect(searchWindow('')).toBeNull();
    expect(searchWindow('nope')).toBeNull();
  });

  it('keeps SN 2026aaiv but not SN 2025rbs for the 2026 photo', () => {
    const obs = '2026-09-04T20:02:11Z';
    const names = CANDIDATES.filter((c) => inWindow(c, obs)).map((c) => c.name);
    expect(names).toContain('SN 2026aaiv');
    expect(names).not.toContain('SN 2025rbs');
  });

  it('keeps SN 2025rbs but not SN 2026aaiv for a late-2025 photo', () => {
    const obs = '2025-10-15T21:00:00Z';
    const names = CANDIDATES.filter((c) => inWindow(c, obs)).map((c) => c.name);
    expect(names).toContain('SN 2025rbs');
    expect(names).not.toContain('SN 2026aaiv');
  });
});

describe('daysFromDiscovery()', () => {
  it('is positive when the photo was taken after the discovery', () => {
    expect(daysFromDiscovery('2026-09-04T20:02:11Z', '2026-09-01T11:23:32.352Z')).toBe(3);
  });

  it('is negative for a pre-discovery photo, null without a date', () => {
    expect(daysFromDiscovery('2026-08-25T00:00:00Z', '2026-09-01T00:00:00Z')).toBe(-7);
    expect(daysFromDiscovery('2026-08-25T00:00:00Z', null)).toBeNull();
  });
});

describe('placeInImage()', () => {
  const placed = placeInImage(CANDIDATES, PHOTO_TO_PROJ, W, H, '2026-09-04T20:02:11Z');

  it('keeps only the transients inside the frame (both NGC 7331 supernovae)', () => {
    expect(placed.map((c) => c.name).sort()).toEqual(['SN 2025rbs', 'SN 2026aaiv']);
  });

  it('puts SN 2026aaiv just south-east of the frame centre', () => {
    const sn = placed.find((c) => c.name === 'SN 2026aaiv')!;
    // RA +21″ (east → left), Dec −36″ (south → down) from centre, at 1.5″/px.
    expect(sn.x).toBeGreaterThan(W / 2 - 20);
    expect(sn.x).toBeLessThan(W / 2);
    expect(sn.y).toBeGreaterThan(H / 2 + 15);
    expect(sn.y).toBeLessThan(H / 2 + 35);
    expect(sn.daysFromDiscovery).toBe(3);
  });
});

describe('rankTransients()', () => {
  const base = {
    x: 0,
    y: 0,
    raDeg: 0,
    decDeg: 0,
    type: null,
    discoveryDate: null,
    discoveryMag: null,
    hostName: null,
    redshift: null,
    tnsUrl: '',
  };
  const mk = (name: string, classified: boolean, days: number | null): PlacedTransient => ({
    ...base,
    name,
    classified,
    daysFromDiscovery: days,
  });

  it('puts confirmed supernovae first, then the closest discovery date', () => {
    const ranked = rankTransients([
      mk('AT near', false, 1),
      mk('SN far', true, 200),
      mk('SN near', true, -5),
      mk('SN undated', true, null),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(['SN near', 'SN far', 'SN undated', 'AT near']);
  });
});

describe('candidateToPoi() / formatDaysFromDiscovery()', () => {
  it('builds a positioned supernova POI', () => {
    const sn = CANDIDATES.find((c) => c.name === 'SN 2026aaiv')!;
    expect(candidateToPoi(sn)).toEqual({
      name: 'SN 2026aaiv',
      categoryId: SUPERNOVA_CATEGORY_ID,
      ra: sn.raDeg,
      dec: sn.decDeg,
    });
  });

  it('formats the age relative to discovery', () => {
    expect(formatDaysFromDiscovery(null)).toBe('—');
    expect(formatDaysFromDiscovery(3)).toMatch(/3/);
    expect(formatDaysFromDiscovery(-4)).toMatch(/4/);
    expect(formatDaysFromDiscovery(3)).not.toBe(formatDaysFromDiscovery(-3));
  });
});
