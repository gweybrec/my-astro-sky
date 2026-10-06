/**
 * Tests for src/asteroid-identify.ts — the pure logic behind the asteroid
 * identification modal: JD conversion, the default time window from a photo's
 * observation date + integration time, the SkyBoT search built from two marks,
 * and ranking SkyBoT candidates against the marked trail.
 *
 * The ranking test replays real numbers: the two marker sky positions are the
 * genuine SkyBoT-computed positions of asteroid 18799 ("1999 JZ73") at the
 * NGC4438-CCD test photo's actual EXPSTART/EXPEND, and the candidate pool is
 * the real (trimmed) SkyBoT response for that field/epoch
 * (tests/fixtures/skybot/ngc4438-conesearch.json). 18799 must rank first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isoToJd,
  jdToIso,
  isoToUtcParts,
  utcPartsToIso,
  totalIntegrationSeconds,
  defaultTimeWindow,
  buildSearch,
  rankCandidates,
  formatCandidateName,
  formatAsteroidClass,
  candidateToPoi,
  type SkybotCandidate,
} from '@myastrosky/core/asteroid-identify';
import { parseRaHms, parseDecDms } from '@myastrosky/core/services/identify';

const FIXTURE_PATH = join(__dirname, '../fixtures/skybot/ngc4438-conesearch.json');

interface RawRow {
  Num?: number | string;
  Name?: string;
  'RA (hms)'?: string;
  'DEC (dms)'?: string;
  Class?: string;
  'VMag (mag)'?: number;
  'Err (arcsec)'?: number;
  'dRA (arcsec/h)'?: number;
  'dDEC (arcsec/h)'?: number;
}

function loadFixtureCandidates(): SkybotCandidate[] {
  const rows: RawRow[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  return rows.map((row) => ({
    number: row.Num != null ? String(row.Num) : null,
    name: row.Name ?? '',
    raDeg: parseRaHms(row['RA (hms)']!),
    decDeg: parseDecDms(row['DEC (dms)']!),
    className: row.Class ?? '',
    vMag: row['VMag (mag)'] ?? null,
    ephemErrArcsec: row['Err (arcsec)'] ?? null,
    distArcsec: null,
    dRaArcsecPerHour: row['dRA (arcsec/h)'] ?? null,
    dDecArcsecPerHour: row['dDEC (arcsec/h)'] ?? null,
  }));
}

describe('isoToJd() / jdToIso()', () => {
  it('round-trips an ISO timestamp through a Julian Date to within a second', () => {
    // dateToJD/jdToDate (Meeus ch. 7) carry sub-second floating-point error,
    // which is irrelevant at the datetime-local (minute) precision the modal
    // actually edits — so the round trip is checked to the nearest second.
    const iso = '2026-04-08T23:27:47.000Z';
    const jd = isoToJd(iso);
    const roundTripped = new Date(jdToIso(jd)).getTime();
    expect(Math.abs(roundTripped - new Date(iso).getTime())).toBeLessThanOrEqual(1000);
  });

  it('matches the known JD for the NGC4438 exposure start', () => {
    // EXPSTART = 2461139.47577546 (from the FITS header)
    expect(isoToJd('2026-04-08T23:25:07Z')).toBeCloseTo(2461139.47577546, 3);
  });
});

describe('isoToUtcParts() / utcPartsToIso()', () => {
  it('splits an ISO timestamp into its literal UTC calendar date and clock time', () => {
    expect(isoToUtcParts('2026-04-08T23:27:47.000Z')).toEqual({
      date: '2026-04-08',
      time: '23:27',
    });
  });

  it('never applies a local-timezone shift — the digits are the UTC digits verbatim', () => {
    // Regression for the modal's original bug: reusing the app's LOCAL-time
    // datetime-local helper for a field labelled "(UTC)" silently shifted the
    // displayed/entered digits by the browser's timezone offset. These parts must
    // match the ISO string's own UTC fields exactly, independent of TZ env.
    const iso = '2026-01-01T00:15:00.000Z';
    const parts = isoToUtcParts(iso);
    expect(parts.date).toBe('2026-01-01');
    expect(parts.time).toBe('00:15');
  });

  it('round-trips date+time back to the same ISO instant', () => {
    expect(utcPartsToIso('2026-04-08', '23:27')).toBe('2026-04-08T23:27:00.000Z');
  });

  it('defaults the time to midnight when only a date is given', () => {
    expect(utcPartsToIso('2026-04-08', '')).toBe('2026-04-08T00:00:00.000Z');
  });

  it('returns empty parts/string for empty input', () => {
    expect(isoToUtcParts('')).toEqual({ date: '', time: '' });
    expect(utcPartsToIso('', '12:00')).toBe('');
  });
});

describe('totalIntegrationSeconds()', () => {
  it('sums frames × seconds across all rows', () => {
    expect(
      totalIntegrationSeconds({
        integrations: [
          { frames: 46, seconds: 30, filter: 'L' },
          { frames: 10, seconds: 60, filter: 'R' },
        ],
      }),
    ).toBe(46 * 30 + 10 * 60);
  });

  it('returns 0 when there are no integration rows', () => {
    expect(totalIntegrationSeconds({ integrations: undefined })).toBe(0);
  });
});

describe('defaultTimeWindow()', () => {
  it('derives start/end from observationDate + total integration time', () => {
    const window = defaultTimeWindow({
      observationDate: '2026-04-08T23:27:47.000Z',
      integrations: [{ frames: 46, seconds: 30, filter: 'L' }],
    });
    expect(window).not.toBeNull();
    expect(window!.startIso).toBe('2026-04-08T23:27:47.000Z');
    expect(new Date(window!.endIso).getTime() - new Date(window!.startIso).getTime()).toBe(
      46 * 30 * 1000,
    );
  });

  it('returns null when the photo has no observation date', () => {
    expect(defaultTimeWindow({ observationDate: null, integrations: [] })).toBeNull();
  });
});

describe('buildSearch()', () => {
  it('centres the search on the marker midpoint and mid-epoch', () => {
    const search = buildSearch(
      { ra: 186.966, dec: 12.9 },
      { ra: 186.964, dec: 12.91 },
      2461139.4, // startJd
      2461139.5, // endJd
    );
    expect(search.raDeg).toBeCloseTo(186.965, 5);
    expect(search.decDeg).toBeCloseTo(12.905, 5);
    expect(search.epochJd).toBeCloseTo(2461139.45, 5);
    expect(search.suggestedRadiusArcmin).toBeGreaterThanOrEqual(5);
  });

  it('centres a trail crossing RA 0h/24h on the seam, not on the opposite side of the sky', () => {
    const search = buildSearch(
      { ra: 359.98, dec: 10 },
      { ra: 0.02, dec: 10 },
      2461139.4,
      2461139.5,
    );
    // Midpoint is RA 0° (equivalently 360°), never 180°.
    expect(Math.cos((search.raDeg * Math.PI) / 180)).toBeCloseTo(1, 9);
    expect(search.raDeg).toBeGreaterThanOrEqual(0);
    expect(search.raDeg).toBeLessThan(360);
    // A 0.04° (2.4′) trail: radius stays close to the floor instead of saturating at 60′.
    expect(search.suggestedRadiusArcmin).toBeLessThan(15);
  });

  it('wraps the midpoint back into [0, 360) when the trail crosses the seam westward', () => {
    const search = buildSearch({ ra: 0.01, dec: 0 }, { ra: 359.95, dec: 0 }, 2461139.4, 2461139.5);
    expect(search.raDeg).toBeCloseTo(359.98, 6);
  });
});

describe('rankCandidates()', () => {
  const candidates = loadFixtureCandidates();
  // Real SkyBoT-propagated positions of 18799 at the NGC4438 photo's actual
  // EXPSTART/EXPEND, queried directly from IMCCE at those two epochs.
  const startJd = 2461139.47577546;
  const endJd = 2461139.49466435;
  const queryEpochJd = 2461139.4852199; // mid-epoch, what the fixture was queried at
  const start = { ra: parseRaHms('12 27 52.3493'), dec: parseDecDms('+12 53 22.849'), jd: startJd };
  const end = { ra: parseRaHms('12 27 51.3191'), dec: parseDecDms('+12 53 25.316'), jd: endJd };

  it('ranks 18799 ("1999 JZ73") first among the fixture candidates', () => {
    const ranked = rankCandidates(candidates, { start, end }, queryEpochJd);
    expect(ranked.length).toBe(candidates.length);
    expect(ranked[0].number).toBe('18799');
    expect(ranked[0].name).toBe('1999 JZ73');
    // The marker click is on the real trajectory, so the match should be tight.
    expect(ranked[0].positionErrorArcsec).toBeLessThan(5);
  });

  it('sorts by ascending position error', () => {
    const ranked = rankCandidates(candidates, { start, end }, queryEpochJd);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].positionErrorArcsec).toBeGreaterThanOrEqual(
        ranked[i - 1].positionErrorArcsec,
      );
    }
  });

  it('flags a candidate with a large orbit uncertainty', () => {
    const uncertain: SkybotCandidate = {
      number: null,
      name: 'test',
      raDeg: start.ra,
      decDeg: start.dec,
      className: 'MB>Inner',
      vMag: 22,
      ephemErrArcsec: 500,
      distArcsec: null,
      dRaArcsecPerHour: 0,
      dDecArcsecPerHour: 0,
    };
    const ranked = rankCandidates([uncertain], { start, end }, queryEpochJd);
    expect(ranked[0].uncertainOrbit).toBe(true);
  });

  it('matches a candidate across the RA 0h/24h seam', () => {
    // Marks straddle the seam (359.99° → 0.01°, over one hour); the true object is
    // cataloged at RA 0° at mid-epoch, moving +0.02°/h (72″/h) in RA.
    const seamStart = { ra: 359.99, dec: 0, jd: 2461139.0 };
    const seamEnd = { ra: 0.01, dec: 0, jd: 2461139.0 + 1 / 24 };
    const midJd = (seamStart.jd + seamEnd.jd) / 2;
    const base: SkybotCandidate = {
      number: null,
      name: 'on-seam',
      raDeg: 0,
      decDeg: 0,
      className: 'MB>Inner',
      vMag: 18,
      ephemErrArcsec: 0.1,
      distArcsec: null,
      dRaArcsecPerHour: 72,
      dDecArcsecPerHour: 0,
    };
    // 3′ away on the far side of the seam, same motion.
    const offSeam: SkybotCandidate = { ...base, name: 'off-seam', raDeg: 359.95 };

    const ranked = rankCandidates([offSeam, base], { start: seamStart, end: seamEnd }, midJd);
    expect(ranked[0].name).toBe('on-seam');
    expect(ranked[0].positionErrorArcsec).toBeLessThan(1);
    expect(ranked[0].motionErrorArcsec).toBeLessThan(1);
    expect(ranked[1].positionErrorArcsec).toBeCloseTo(180, 0);
    expect(ranked[1].motionErrorArcsec).toBeLessThan(1);
  });
});

describe('formatCandidateName() / candidateToPoi()', () => {
  it('formats a numbered candidate with its designation', () => {
    expect(formatCandidateName({ number: '18799', name: '1999 JZ73' })).toBe('(18799) 1999 JZ73');
  });

  it('formats an unnumbered candidate as just its name', () => {
    expect(formatCandidateName({ number: null, name: '2018 PT9' })).toBe('2018 PT9');
  });

  it('builds a POI with the given category and the candidate position (so it can be pinned)', () => {
    expect(
      candidateToPoi(
        { number: '18799', name: '1999 JZ73', raDeg: 186.966, decDeg: 12.89 },
        'cat-asteroid',
      ),
    ).toEqual({ name: '(18799) 1999 JZ73', categoryId: 'cat-asteroid', ra: 186.966, dec: 12.89 });
  });

  it('normalises the POI right ascension to [0, 360)', () => {
    const poi = candidateToPoi({ number: null, name: 'X', raDeg: -0.5, decDeg: 1 }, 'cat-asteroid');
    expect(poi.ra).toBeCloseTo(359.5, 9);
  });
});

describe('formatAsteroidClass()', () => {
  it('never surfaces a raw "PREFIX>Subtype" SkyBoT code', () => {
    for (const raw of ['MB>Middle', 'MB>Inner', 'MB>Outer']) {
      expect(formatAsteroidClass(raw)).not.toContain('>');
      expect(formatAsteroidClass(raw)).not.toMatch(/^MB/);
    }
  });

  it('expands a Main Belt subtype into "<translated prefix> (<subtype>)"', () => {
    // Test environment default language is English; the translation itself is
    // exercised per-language by tests/unit/i18n-parity.test.ts.
    expect(formatAsteroidClass('MB>Middle')).toBe('Main Belt (Middle)');
  });

  it('translates an exact-match class with no subtype', () => {
    expect(formatAsteroidClass('Mars-Crosser')).toBe('Mars-Crosser');
    expect(formatAsteroidClass('Centaur')).toBe('Centaur');
    expect(formatAsteroidClass('Trojan')).toBe('Trojan');
  });

  it('de-slugs an unrecognised code rather than showing it verbatim', () => {
    expect(formatAsteroidClass('XYZ>Something')).toBe('XYZ Something');
  });

  it('returns an empty string for an empty input', () => {
    expect(formatAsteroidClass('')).toBe('');
  });
});
