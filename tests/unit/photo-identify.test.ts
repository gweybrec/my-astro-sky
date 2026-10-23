/**
 * Tests for packages/core/src/photo-identify.ts — the identification steps at a photo's level, shared by the desktop's
 * identification modals and the phone's identification pages: pixels to sky through the photo's solve, the asteroid,
 * supernova and comet searches, a comet pin moved by hand, and adding found points of interest without duplicates.
 *
 * The photos are synthetic frames solved by correspondences at given sky positions (starHip 0), at the size and centre
 * of the test photos the supernova and comet tests use.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  asteroidSearchPlan,
  cometPois,
  cometsInPhoto,
  isPhotoSolved,
  mergeIdentifiedPois,
  photoPixelsToRaDec,
  placeSupernovae,
  poiAtPixel,
  rankAsteroids,
  supernovaSearchPlan,
} from '@myastrosky/core/photo-identify';
import { parseCometEls, parseTnsCsv } from '@myastrosky/core/services/identify';
import { setCenterMode } from '@myastrosky/core/projection';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';

/** A photo of `width`×`height` px at `scaleArcsec`″/px centred on (ra0, dec0), north up and east left. */
function solvedPhoto(
  width: number,
  height: number,
  ra0: number,
  dec0: number,
  scaleArcsec: number,
): Photo {
  const scale = scaleArcsec / 3600;
  const sky = (x: number, y: number) => ({
    ra: ra0 - ((x - width / 2) * scale) / Math.cos((dec0 * Math.PI) / 180),
    dec: dec0 - (y - height / 2) * scale,
  });
  const points = [
    { x: width * 0.1, y: height * 0.1 },
    { x: width * 0.9, y: height * 0.15 },
    { x: width * 0.5, y: height * 0.9 },
  ];
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1.jpg',
    width,
    height,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: points.map((p, i) => {
      const s = sky(p.x, p.y);
      return {
        pointIndex: i,
        photoX: p.x,
        photoY: p.y,
        starHip: 0,
        starName: `p${i}`,
        starRa: s.ra,
        starDec: s.dec,
      };
    }),
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
  };
}

const NGC7331 = solvedPhoto(664, 470, 339.267614, 34.419887, 1.5);
const UNSOLVED: Photo = { ...NGC7331, correspondences: [] };

describe('isPhotoSolved() and photoPixelsToRaDec()', () => {
  it('turns the centre pixel into the photo centre', () => {
    expect(isPhotoSolved(NGC7331)).toBe(true);
    const [c] = photoPixelsToRaDec(NGC7331, [{ x: 332, y: 235 }])!;
    expect(c.ra).toBeCloseTo(339.267614, 3);
    expect(c.dec).toBeCloseTo(34.419887, 3);
  });

  it('gives nothing for a photo without a solve', () => {
    expect(isPhotoSolved(UNSOLVED)).toBe(false);
    expect(photoPixelsToRaDec(UNSOLVED, [{ x: 0, y: 0 }])).toBeNull();
    expect(poiAtPixel(UNSOLVED, { x: 0, y: 0 }, 'x', 'cat')).toBeNull();
  });

  it('does not depend on the map being centred on the zenith', () => {
    const pole = photoPixelsToRaDec(NGC7331, [{ x: 10, y: 20 }])!;
    setCenterMode('zenith');
    try {
      const zenith = photoPixelsToRaDec(NGC7331, [{ x: 10, y: 20 }])!;
      expect(zenith[0].ra).toBeCloseTo(pole[0].ra, 9);
      expect(zenith[0].dec).toBeCloseTo(pole[0].dec, 9);
    } finally {
      setCenterMode('pole');
    }
  });
});

describe('asteroidSearchPlan() and rankAsteroids()', () => {
  const start = { x: 200, y: 235 };
  const end = { x: 460, y: 235 };
  const plan = asteroidSearchPlan(
    NGC7331,
    start,
    end,
    '2026-09-04T20:00:00.000Z',
    '2026-09-04T22:00:00.000Z',
    5,
  )!;

  it('searches around the middle of the trail at its middle time', () => {
    expect(plan.params.raDeg).toBeCloseTo(339.267614, 2);
    expect(plan.params.decDeg).toBeCloseTo(34.419887, 3);
    expect(plan.params.epochJd).toBeCloseTo((plan.marks.start.jd + plan.marks.end.jd) / 2, 9);
  });

  it('widens a radius smaller than the trail calls for, keeps a larger one', () => {
    // The trail is 260 px × 1.5″ = 6.5′ long: 3 × 6.5 + 5 = 24.5′ suggested.
    expect(plan.params.radiusArcmin).toBeCloseTo(24.5, 1);
    const wide = asteroidSearchPlan(
      NGC7331,
      start,
      end,
      '2026-09-04T20:00:00.000Z',
      '2026-09-04T22:00:00.000Z',
      40,
    )!;
    expect(wide.params.radiusArcmin).toBe(40);
  });

  it('ranks the candidate whose motion reproduces the trail first', () => {
    const [s, e] = photoPixelsToRaDec(NGC7331, [start, end])!;
    const hours = 2;
    const decRad = (34.42 * Math.PI) / 180;
    const along = {
      number: '1',
      name: 'Along',
      raDeg: (s.ra + e.ra) / 2,
      decDeg: (s.dec + e.dec) / 2,
      className: 'MB>Middle',
      vMag: 16,
      ephemErrArcsec: 1,
      distArcsec: 0,
      dRaArcsecPerHour: (((e.ra - s.ra) * Math.cos(decRad)) / hours) * 3600,
      dDecArcsecPerHour: 0,
    };
    const still = { ...along, number: '2', name: 'Still', dRaArcsecPerHour: 0 };
    const ranked = rankAsteroids([still, along], plan);
    expect(ranked.map((c) => c.name)).toEqual(['Along', 'Still']);
    expect(ranked[0].positionErrorArcsec).toBeLessThan(5);
  });

  it('gives no search for a photo without a solve', () => {
    expect(
      asteroidSearchPlan(UNSOLVED, start, end, '2026-09-04T20:00:00Z', '2026-09-04T22:00:00Z', 5),
    ).toBeNull();
  });
});

describe('supernovaSearchPlan() and placeSupernovae()', () => {
  const CANDIDATES = parseTnsCsv(
    readFileSync(join(__dirname, '../fixtures/tns/ngc7331-search.csv'), 'utf-8'),
  );

  it('covers the photo over the year before its date', () => {
    const plan = supernovaSearchPlan(NGC7331, '2026-09-04T20:02:11Z')!;
    expect(plan.params.raDeg).toBeCloseTo(339.267614, 3);
    expect(plan.params.radiusArcmin).toBeGreaterThan(10.1);
    expect(plan.params.radiusArcmin).toBeLessThan(11);
    expect(plan.params.dateStart).toBe('2025-09-04');
    expect(plan.field.truncated).toBe(false);
  });

  it('needs a date and a solve', () => {
    expect(supernovaSearchPlan(NGC7331, '')).toBeNull();
    expect(supernovaSearchPlan(UNSOLVED, '2026-09-04T20:02:11Z')).toBeNull();
  });

  it('places both NGC 7331 supernovae on the photo, confirmed ones first', () => {
    const placed = placeSupernovae(NGC7331, CANDIDATES, '2026-09-04T20:02:11Z');
    expect(placed.map((c) => c.name).sort()).toEqual(['SN 2025rbs', 'SN 2026aaiv']);
    expect(placed[0].daysFromDiscovery).toBe(3);
    for (const c of placed) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(664);
    }
  });
});

describe('cometsInPhoto() and cometPois()', () => {
  const COMETS = parseCometEls(
    readFileSync(join(__dirname, '../fixtures/comets/CometEls-sample.txt'), 'utf-8'),
  );
  const R2 = solvedPhoto(1341, 790, 341.441, 2.273, 2.36);
  const OBS = '2025-11-07T18:42:00.000Z';

  it('finds C/2025 R2 in its photo', () => {
    const r = cometsInPhoto(R2, COMETS, OBS);
    expect(r.inFrame.map((c) => c.name)).toEqual(['C/2025 R2 (SWAN)']);
  });

  it('pins a comet at its prediction, or where its pin was moved', () => {
    const [r2] = cometsInPhoto(R2, COMETS, OBS).inFrame;
    const [predicted] = cometPois(R2, [r2], new Map());
    expect(predicted).toMatchObject({ name: r2.name, categoryId: 'cat-comet' });
    expect(predicted.ra).toBeCloseTo(r2.raDeg, 6);

    const [moved] = cometPois(R2, [r2], new Map([[r2.name, { x: 670.5, y: 395 }]]));
    expect(moved.ra).toBeCloseTo(341.441, 3);
    expect(moved.dec).toBeCloseTo(2.273, 3);
  });

  it('finds nothing in a photo without a solve', () => {
    expect(cometsInPhoto({ ...R2, correspondences: [] }, COMETS, OBS)).toEqual({
      inFrame: [],
      nearby: [],
    });
  });
});

describe('poiAtPixel() and mergeIdentifiedPois()', () => {
  it('places a point of interest at a pixel, RA in [0, 360)', () => {
    const poi = poiAtPixel(NGC7331, { x: 332, y: 235 }, 'Nova', 'cat-x')!;
    expect(poi).toMatchObject({ name: 'Nova', categoryId: 'cat-x' });
    expect(poi.ra).toBeCloseTo(339.267614, 3);
  });

  it('skips a point already listed with the same name and type', () => {
    const a: PointOfInterest = { name: 'A', categoryId: 'cat-comet' };
    const b: PointOfInterest = { name: 'B', categoryId: 'cat-comet' };
    const aOther: PointOfInterest = { name: 'A', categoryId: 'cat-asteroid' };
    const { merged, fresh } = mergeIdentifiedPois([a], [a, b, aOther]);
    expect(fresh).toEqual([b, aOther]);
    expect(merged).toEqual([a, b, aOther]);
    expect(mergeIdentifiedPois([a], [a]).fresh).toEqual([]);
  });
});
