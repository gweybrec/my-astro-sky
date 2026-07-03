import { describe, it, expect } from 'vitest';
import {
  dateToJD,
  gmstHours,
  lstHours,
  sunAltDeg,
  twilightWindow,
  jdToDate,
  moonRaDecDeg,
  moonPhase,
} from '../../src/astro-time';

describe('dateToJD', () => {
  // Meeus, Astronomical Algorithms, Table 7.a
  it('J2000.0 epoch: 2000-Jan-1.5 TT = JD 2451545.0', () => {
    const date = new Date('2000-01-01T12:00:00Z');
    expect(dateToJD(date)).toBeCloseTo(2451545.0, 4);
  });

  it('1957-Oct-4.81 (Sputnik launch) = JD 2436116.31', () => {
    const date = new Date('1957-10-04T19:26:24Z'); // 0.81 days = 19h 26m 24s
    expect(dateToJD(date)).toBeCloseTo(2436116.31, 2);
  });

  it('1900-Jan-0.5 = JD 2415020.0', () => {
    const date = new Date('1899-12-31T12:00:00Z');
    expect(dateToJD(date)).toBeCloseTo(2415020.0, 4);
  });

  it('2000-Jan-1.0 (midnight) = JD 2451544.5', () => {
    const date = new Date('2000-01-01T00:00:00Z');
    expect(dateToJD(date)).toBeCloseTo(2451544.5, 4);
  });
});

describe('jdToDate roundtrip', () => {
  it('roundtrip from Date → JD → Date preserves milliseconds', () => {
    const original = new Date('2024-06-15T21:30:00Z');
    const jd = dateToJD(original);
    const back = jdToDate(jd);
    expect(Math.abs(back.getTime() - original.getTime())).toBeLessThan(1000); // within 1s
  });
});

describe('gmstHours', () => {
  // Meeus eq. 12.4: at J2000.0, GMST = 18.6973746 hours
  it('GMST at J2000.0 ≈ 18.697 hours', () => {
    expect(gmstHours(2451545.0)).toBeCloseTo(18.6973746, 3);
  });

  it('returns value in range [0, 24)', () => {
    const gmst = gmstHours(2451545.0);
    expect(gmst).toBeGreaterThanOrEqual(0);
    expect(gmst).toBeLessThan(24);
  });
});

describe('lstHours', () => {
  it('LST = GMST + longitude/15', () => {
    const jd = 2451545.0;
    const lon = 30; // 30° East = +2h
    const gmst = gmstHours(jd);
    const lst = lstHours(jd, lon);
    const expected = (gmst + lon / 15 + 24) % 24;
    expect(lst).toBeCloseTo(expected, 6);
  });

  it('returns value in range [0, 24)', () => {
    const lst = lstHours(2451545.0, -120);
    expect(lst).toBeGreaterThanOrEqual(0);
    expect(lst).toBeLessThan(24);
  });
});

describe('sunAltDeg', () => {
  // At summer solstice (≈ June 21), Sun at equator (lat=0, lon=0) at solar noon should be near +23.4°
  // We use approximate values since sunAltDeg uses low-precision formula
  it('sun is positive altitude at noon UTC on a solstice at equator', () => {
    const noon = new Date('2024-06-21T12:00:00Z');
    const jd = dateToJD(noon);
    const alt = sunAltDeg(jd, 0, 0);
    expect(alt).toBeGreaterThan(60); // should be near 66.5° but low-precision
  });

  it('sun is below horizon at midnight UTC on a solstice at equator', () => {
    const midnight = new Date('2024-06-21T00:00:00Z');
    const jd = dateToJD(midnight);
    const alt = sunAltDeg(jd, 0, 0);
    expect(alt).toBeLessThan(0);
  });

  it('sun altitude is higher in summer than winter from northern hemisphere', () => {
    const noon = 'T12:00:00Z';
    const jdSummer = dateToJD(new Date('2024-06-21' + noon));
    const jdWinter = dateToJD(new Date('2024-12-21' + noon));
    const altSummer = sunAltDeg(jdSummer, 48, 0); // Paris latitude
    const altWinter = sunAltDeg(jdWinter, 48, 0);
    expect(altSummer).toBeGreaterThan(altWinter);
  });
});

describe('moonRaDecDeg', () => {
  // Meeus, Astronomical Algorithms, worked example 47.a: 1992 April 12, 0h TD.
  // Apparent geocentric α = 134.688°, δ = 13.768°. We use a reduced term set,
  // so allow ~0.5° slack.
  it('matches Meeus example 47.a within ~0.5°', () => {
    const jd = dateToJD(new Date('1992-04-12T00:00:00Z'));
    const { raDeg, decDeg } = moonRaDecDeg(jd);
    expect(raDeg).toBeCloseTo(134.688, 0);
    expect(decDeg).toBeCloseTo(13.768, 0);
    expect(Math.abs(raDeg - 134.688)).toBeLessThan(0.5);
    expect(Math.abs(decDeg - 13.768)).toBeLessThan(0.5);
  });

  it('RA stays in [0,360) and Dec within the lunar declination range', () => {
    const { raDeg, decDeg } = moonRaDecDeg(dateToJD(new Date('2024-06-15T22:00:00Z')));
    expect(raDeg).toBeGreaterThanOrEqual(0);
    expect(raDeg).toBeLessThan(360);
    expect(Math.abs(decDeg)).toBeLessThan(29); // |dec| never exceeds ~28.6°
  });
});

describe('moonPhase', () => {
  it('illumination near 0 at a new moon (2024-01-11 11:57 UTC)', () => {
    const { illum, phaseIndex } = moonPhase(dateToJD(new Date('2024-01-11T11:57:00Z')));
    expect(illum).toBeLessThan(0.05);
    expect(phaseIndex).toBe(0);
  });

  it('illumination near 1 at a full moon (2024-01-25 17:54 UTC)', () => {
    const { illum, phaseIndex } = moonPhase(dateToJD(new Date('2024-01-25T17:54:00Z')));
    expect(illum).toBeGreaterThan(0.97);
    expect(phaseIndex).toBe(4);
  });

  it('is waxing a few days after new moon and waning a few days after full', () => {
    expect(moonPhase(dateToJD(new Date('2024-01-15T00:00:00Z'))).waxing).toBe(true);
    expect(moonPhase(dateToJD(new Date('2024-01-29T00:00:00Z'))).waxing).toBe(false);
  });

  it('phaseIndex is always 0–7', () => {
    for (let d = 0; d < 30; d++) {
      const jd = dateToJD(new Date(2024, 0, 1 + d));
      const { phaseIndex } = moonPhase(jd);
      expect(phaseIndex).toBeGreaterThanOrEqual(0);
      expect(phaseIndex).toBeLessThanOrEqual(7);
    }
  });
});

describe('twilightWindow', () => {
  it('returns a window with start before end at a mid-latitude in winter', () => {
    const date = new Date('2024-01-15T00:00:00Z');
    const tw = twilightWindow(date, 48, 2); // Paris
    expect(tw).not.toBeNull();
    expect(tw!.start.getTime()).toBeLessThan(tw!.end.getTime());
  });

  it('limitDeg is one of -18, -12, -6', () => {
    const date = new Date('2024-01-15T00:00:00Z');
    const tw = twilightWindow(date, 48, 2);
    expect(tw).not.toBeNull();
    expect([-18, -12, -6]).toContain(tw!.limitDeg);
  });

  it('returns null (or a window) for high latitude in summer (polar day)', () => {
    const summerDate = new Date('2024-06-21T00:00:00Z');
    const tw = twilightWindow(summerDate, 71, 25); // Arctic Norway
    // Either null (sun never sets to -18°) or a nautical/civil window
    if (tw !== null) {
      expect(tw.limitDeg).toBeGreaterThan(-18); // forced to nautical or civil
    }
    // null is also a valid result
  });

  it('window spans no more than 24 hours', () => {
    const date = new Date('2024-01-15T00:00:00Z');
    const tw = twilightWindow(date, 48, 2);
    expect(tw).not.toBeNull();
    const durationMs = tw!.end.getTime() - tw!.start.getTime();
    expect(durationMs).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
