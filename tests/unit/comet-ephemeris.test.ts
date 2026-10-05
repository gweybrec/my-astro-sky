/**
 * Tests for src/comet-ephemeris.ts — two-body comet positions from MPC elements.
 *
 * Reference positions are JPL Horizons astrometric geocentric RA/Dec (queried for
 * the three comet photos of the development database, at their observation times).
 * The MPC elements (tests/fixtures/comets/CometEls-sample.txt) cover an elliptic
 * (10P, C/2025 R2), a hyperbolic (C/2024 E1) and a near-parabolic orbit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCometEls } from '@myastrosky/core/services/identify';
import {
  cometRaDec,
  cometTotalMag,
  cometRateArcminPerHour,
  cometHeliocentricXYZ,
  type CometElements,
} from '../../src/comet-ephemeris';
import { dateToJD } from '../../src/astro-time';
import { angularSeparationDeg } from '../../src/sky-geometry';

const COMETS = parseCometEls(
  readFileSync(join(__dirname, '../fixtures/comets/CometEls-sample.txt'), 'utf-8'),
);
const comet = (designation: string) => COMETS.find((c) => c.designation === designation)!;

const hms = (h: number, m: number, s: number) => (h + m / 60 + s / 3600) * 15;
const dms = (sign: number, d: number, m: number, s: number) => sign * (d + m / 60 + s / 3600);

const HORIZONS = [
  {
    designation: 'C/2025 R2',
    iso: '2025-11-07T18:42:00Z',
    ra: hms(22, 45, 30.92),
    dec: dms(1, 2, 15, 20.1),
  },
  {
    designation: 'C/2024 E1',
    iso: '2026-03-04T17:25:00Z',
    ra: hms(3, 1, 22.28),
    dec: dms(-1, 10, 37, 13.8),
  },
  {
    designation: '10P',
    iso: '2026-07-27T20:12:00Z',
    ra: hms(21, 44, 31.36),
    dec: dms(-1, 22, 16, 59.2),
  },
];

describe('cometRaDec()', () => {
  for (const ref of HORIZONS) {
    it(`puts ${ref.designation} within 5′ of JPL Horizons`, () => {
      const pos = cometRaDec(comet(ref.designation), dateToJD(new Date(ref.iso)));
      const errArcmin = angularSeparationDeg(pos.raDeg, pos.decDeg, ref.ra, ref.dec) * 60;
      expect(errArcmin).toBeLessThan(5);
    });
  }

  it('returns plausible heliocentric and geocentric distances', () => {
    // Horizons: 10P at r ≈ 1.42 AU, Δ ≈ 0.42 AU on 2026-07-27.
    const pos = cometRaDec(comet('10P'), dateToJD(new Date('2026-07-27T20:12:00Z')));
    expect(pos.rAu).toBeCloseTo(1.42, 1);
    expect(pos.deltaAu).toBeCloseTo(0.42, 1);
  });

  it('is continuous across e = 1 (parabolic ↔ elliptic ↔ hyperbolic branches)', () => {
    const base = comet('C/2014 R3');
    const jd = base.tpJd + 200;
    const at = (e: number) => cometHeliocentricXYZ({ ...base, e }, jd);
    const parabola = at(1);
    for (const e of [1 - 1e-6, 1 + 1e-6]) {
      const p = at(e);
      const gap = Math.hypot(p[0] - parabola[0], p[1] - parabola[1], p[2] - parabola[2]);
      expect(gap).toBeLessThan(1e-4);
    }
  });

  it('is at the perihelion distance at perihelion time', () => {
    for (const c of COMETS) {
      const p = cometHeliocentricXYZ(c, c.tpJd);
      expect(Math.hypot(...p)).toBeCloseTo(c.q, 6);
    }
  });
});

describe('cometTotalMag()', () => {
  it('applies M1 + 5 log Δ + 2.5 K log r', () => {
    const el = { h: 10, k: 4 } as CometElements;
    expect(cometTotalMag(el, 1, 1)).toBe(10);
    expect(cometTotalMag(el, 10, 10)).toBeCloseTo(10 + 5 + 10, 10);
  });

  it('is null without magnitude parameters', () => {
    expect(cometTotalMag({ h: null, k: null } as CometElements, 1, 1)).toBeNull();
  });
});

describe('cometRateArcminPerHour()', () => {
  it('matches the fast motion of C/2025 R2 (≈3.9′/h per SkyBoT)', () => {
    const rate = cometRateArcminPerHour(
      comet('C/2025 R2'),
      dateToJD(new Date('2025-11-07T18:42:00Z')),
    );
    expect(rate).toBeGreaterThan(3);
    expect(rate).toBeLessThan(4.5);
  });
});
