import { describe, it, expect } from 'vitest';
import {
  altAzFromRaDec,
  transitLstHours,
  maxAltDuringWindow,
  mightBeVisible,
  sampleAltCurve,
  angularSeparationDeg,
  sampleMoonAltCurve,
  moonDangerLevel,
} from '../../src/sky-geometry';
import { lstHours, dateToJD, moonRaDecDeg } from '../../src/astro-time';

describe('altAzFromRaDec', () => {
  it('object on meridian (LST = RA) has azimuth ≈ 180° (due south, north hemisphere)', () => {
    const raDeg = 100;
    const decDeg = 30;
    const latDeg = 48; // northern hemisphere
    const lst = raDeg / 15; // transit: LST = RA/15
    const { azDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    expect(azDeg).toBeCloseTo(180, 0);
  });

  it('altitude at meridian transit = 90 - |lat - dec| for upper culmination', () => {
    const raDeg = 50;
    const decDeg = 20;
    const latDeg = 45;
    const lst = raDeg / 15;
    const { altDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    const expected = 90 - Math.abs(latDeg - decDeg);
    expect(altDeg).toBeCloseTo(expected, 1);
  });

  it('object well below horizon has negative altitude', () => {
    const raDeg = 50;
    const decDeg = -60;
    const latDeg = 48;
    const lst = (raDeg + 12 * 15) / 15; // opposite side: set LST 12h away from transit
    const { altDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    expect(altDeg).toBeLessThan(0);
  });
});

describe('transitLstHours', () => {
  it('transit LST = RA / 15', () => {
    expect(transitLstHours(0)).toBeCloseTo(0);
    expect(transitLstHours(180)).toBeCloseTo(12);
    expect(transitLstHours(360)).toBeCloseTo(24);
  });
});

describe('mightBeVisible', () => {
  it('circumpolar star from lat=45 is visible (never sets)', () => {
    // dec > lat means it never sets. Max alt = 90 - |45 - 80| = 90 - 35 = 55 > 30
    expect(mightBeVisible(80, 45, 30)).toBe(true);
  });

  it('deep southern object never visible from far north', () => {
    // Max alt from lat=60: 90 - |60 - (-70)| = 90 - 130 = -40 < 30
    expect(mightBeVisible(-70, 60, 30)).toBe(false);
  });

  it('equatorial object is visible from mid-latitude', () => {
    // Max alt from lat=45: 90 - |45 - 0| = 45 > 30
    expect(mightBeVisible(0, 45, 30)).toBe(true);
  });
});

describe('maxAltDuringWindow', () => {
  it('finds peak altitude above min threshold for a well-positioned object', () => {
    // Orion's belt (Alnilam): RA≈84°, Dec≈-1.2° — visible from Paris in winter
    const raDeg = 84;
    const decDeg = -1.2;
    const latDeg = 48.85;
    const lonDeg = 2.35;
    // Winter 2024, astronomical night
    const windowStart = new Date('2024-01-15T19:00:00Z');
    const windowEnd = new Date('2024-01-16T05:00:00Z');
    const { maxAltDeg } = maxAltDuringWindow(raDeg, decDeg, latDeg, lonDeg, windowStart, windowEnd);
    expect(maxAltDeg).toBeGreaterThan(30); // Orion transits at ~41° from Paris
    expect(maxAltDeg).toBeLessThan(90);
  });

  it('returns negative max alt for always-below-horizon object during window', () => {
    // Alpha Centauri (Dec=-60.8°) from Paris (lat=48.9°)
    // Max possible alt = 90 - |48.9 - (-60.8)| = 90 - 109.7 = -19.7° — never rises
    const windowStart = new Date('2024-01-15T19:00:00Z');
    const windowEnd = new Date('2024-01-15T23:00:00Z');
    const { maxAltDeg } = maxAltDuringWindow(-60.8, -60.8, 48.85, 2.35, windowStart, windowEnd, 30);
    expect(maxAltDeg).toBeLessThan(0);
  });

  it('best time is within the window', () => {
    const windowStart = new Date('2024-01-15T19:00:00Z');
    const windowEnd = new Date('2024-01-16T05:00:00Z');
    const { atDate } = maxAltDuringWindow(84, -1.2, 48.85, 2.35, windowStart, windowEnd);
    expect(atDate.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    expect(atDate.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
  });
});

describe('sampleAltCurve', () => {
  const raDeg = 84,
    decDeg = -1.2,
    latDeg = 48.85,
    lonDeg = 2.35;
  const start = new Date('2024-01-15T19:00:00Z');
  const end = new Date('2024-01-16T05:00:00Z'); // 10h window

  it('returns evenly-spaced samples covering the window inclusively', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 60);
    // 10h / 60min = 10 steps → 11 inclusive samples.
    expect(curve.length).toBe(11);
    expect(curve[0].time.getTime()).toBe(start.getTime());
    expect(curve[curve.length - 1].time.getTime()).toBe(end.getTime());
  });

  it('produces monotonically increasing timestamps', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 30);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].time.getTime()).toBeGreaterThan(curve[i - 1].time.getTime());
    }
  });

  it('appends the exact window end when the step does not divide evenly', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 70);
    expect(curve[curve.length - 1].time.getTime()).toBe(end.getTime());
  });

  it('altitudes match altAzFromRaDec at the sampled times', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 120);
    for (const s of curve) {
      const lst = lstHours(dateToJD(s.time), lonDeg);
      expect(s.altDeg).toBeCloseTo(altAzFromRaDec(raDeg, decDeg, lst, latDeg).altDeg, 6);
    }
  });

  it('peak sample altitude is close to maxAltDuringWindow', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 10);
    const peak = Math.max(...curve.map((s) => s.altDeg));
    const { maxAltDeg } = maxAltDuringWindow(raDeg, decDeg, latDeg, lonDeg, start, end, 10);
    expect(peak).toBeCloseTo(maxAltDeg, 5);
  });

  it('degenerate window (end <= start) returns a single sample', () => {
    const curve = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, start, 10);
    expect(curve.length).toBe(1);
    expect(curve[0].time.getTime()).toBe(start.getTime());
  });
});

describe('angularSeparationDeg', () => {
  it('identical points → 0°', () => {
    expect(angularSeparationDeg(83, -5, 83, -5)).toBeCloseTo(0, 6);
  });

  it('antipodal points → 180°', () => {
    expect(angularSeparationDeg(0, 0, 180, 0)).toBeCloseTo(180, 4);
  });

  it('90° apart on the equator', () => {
    expect(angularSeparationDeg(0, 0, 90, 0)).toBeCloseTo(90, 6);
  });

  it('a known pair: Betelgeuse↔Rigel ≈ 18.6°', () => {
    // Betelgeuse RA 88.79 Dec 7.41, Rigel RA 78.63 Dec -8.20
    const sep = angularSeparationDeg(88.79, 7.41, 78.63, -8.2);
    expect(sep).toBeCloseTo(18.6, 0);
  });

  it('handles RA wrap across 0/360', () => {
    expect(angularSeparationDeg(359, 0, 1, 0)).toBeCloseTo(2, 4);
  });
});

describe('sampleMoonAltCurve', () => {
  const latDeg = 48.85,
    lonDeg = 2.35;
  const start = new Date('2024-01-15T19:00:00Z');
  const end = new Date('2024-01-16T05:00:00Z'); // 10h window

  it('returns end-inclusive, evenly-spaced samples', () => {
    const curve = sampleMoonAltCurve(latDeg, lonDeg, start, end, 60);
    expect(curve.length).toBe(11);
    expect(curve[0].time.getTime()).toBe(start.getTime());
    expect(curve[curve.length - 1].time.getTime()).toBe(end.getTime());
  });

  it('recomputes the Moon position per step (curve differs from a fixed RA/Dec)', () => {
    const moonCurve = sampleMoonAltCurve(latDeg, lonDeg, start, end, 60);
    // A fixed-position curve using the Moon's RA/Dec at window start.
    const { raDeg, decDeg } = moonRaDecDeg(dateToJD(start));
    const fixed = sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, 60);
    // The Moon moves ~5° over 10h, so the end altitude should diverge.
    const dEnd = Math.abs(moonCurve[moonCurve.length - 1].altDeg - fixed[fixed.length - 1].altDeg);
    expect(dEnd).toBeGreaterThan(0.5);
  });
});

describe('moonDangerLevel', () => {
  it('new moon is always ok, even very close', () => {
    expect(moonDangerLevel(5, 0.0)).toBe('ok');
    expect(moonDangerLevel(5, 0.05)).toBe('ok');
  });

  it('full moon: close is danger, far is ok', () => {
    expect(moonDangerLevel(30, 1.0)).toBe('danger');
    expect(moonDangerLevel(150, 1.0)).toBe('ok');
  });

  it('monotonic: smaller separation is never less dangerous', () => {
    const rank = { danger: 2, warn: 1, ok: 0 } as const;
    for (const illum of [0.3, 0.6, 0.9]) {
      for (let s = 10; s < 180; s += 10) {
        expect(rank[moonDangerLevel(s - 10, illum)]).toBeGreaterThanOrEqual(
          rank[moonDangerLevel(s, illum)],
        );
      }
    }
  });

  it('higher illumination is never less dangerous at a fixed separation', () => {
    const rank = { danger: 2, warn: 1, ok: 0 } as const;
    expect(rank[moonDangerLevel(50, 0.9)]).toBeGreaterThanOrEqual(rank[moonDangerLevel(50, 0.3)]);
  });
});
