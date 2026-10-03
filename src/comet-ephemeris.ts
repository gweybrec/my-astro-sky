/**
 * Two-body comet ephemeris from osculating orbital elements (as served by
 * `GET /api/comets/elements`, see server/comets.ts): heliocentric position by
 * Kepler's equation (elliptic, hyperbolic or parabolic), minus Earth's position,
 * with one light-time iteration. No planetary perturbations, aberration or
 * parallax — good to a few arcminutes near the elements' epoch, which is ample to
 * identify a comet in a photo (whose timestamp is rarely more precise anyway).
 *
 * Validated against JPL Horizons in tests/unit/comet-ephemeris.test.ts.
 */
import { earthHeliocentricXYZ } from './astro-time';

/** One comet's orbital elements — mirrors `CometElements` in server/comets.ts. */
export interface CometElements {
  designation: string;
  name: string;
  tpJd: number;
  q: number;
  e: number;
  peri: number;
  node: number;
  incl: number;
  h: number | null;
  k: number | null;
}

export interface CometPosition {
  raDeg: number;
  decDeg: number;
  /** Heliocentric distance (AU). */
  rAu: number;
  /** Geocentric distance (AU). */
  deltaAu: number;
}

const DEG = Math.PI / 180;
/** Gaussian gravitational constant (AU^1.5 / day). */
const GAUSS_K = 0.01720209895;
/** Light travel time for 1 AU, in days. */
const LIGHT_DAYS_PER_AU = 0.0057755183;
/** Mean obliquity of the ecliptic at J2000. */
const OBLIQUITY = 23.4392911 * DEG;

/** Position in the orbital plane (x towards perihelion), AU. */
function orbitalPlanePosition(q: number, e: number, dtDays: number): [number, number] {
  if (Math.abs(e - 1) < 1e-8) {
    // Parabola — Barker's equation s³ + 3s = W, solved in closed form (w = W / 2).
    const w = (3 * GAUSS_K * dtDays) / (2 * Math.sqrt(2 * q * q * q));
    const y = Math.cbrt(w + Math.sqrt(w * w + 1));
    const s = y - 1 / y; // tan(ν/2)
    return [q * (1 - s * s), 2 * q * s];
  }
  if (e < 1) {
    const a = q / (1 - e);
    let m = ((GAUSS_K * dtDays) / Math.pow(a, 1.5)) % (2 * Math.PI);
    if (m > Math.PI) m -= 2 * Math.PI;
    if (m < -Math.PI) m += 2 * Math.PI;
    // Newton from E₀ = ±π converges for every e < 1, even close to a parabola.
    let ecc = e < 0.8 ? m : m >= 0 ? Math.PI : -Math.PI;
    for (let i = 0; i < 100; i++) {
      const step = (ecc - e * Math.sin(ecc) - m) / (1 - e * Math.cos(ecc));
      ecc -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    return [a * (Math.cos(ecc) - e), a * Math.sqrt(1 - e * e) * Math.sin(ecc)];
  }
  const a = q / (e - 1);
  const m = (GAUSS_K * dtDays) / Math.pow(a, 1.5);
  let hyp = Math.sign(m) * Math.log((2 * Math.abs(m)) / e + 1.8);
  for (let i = 0; i < 100; i++) {
    const step = (e * Math.sinh(hyp) - hyp - m) / (e * Math.cosh(hyp) - 1);
    hyp -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return [a * (e - Math.cosh(hyp)), a * Math.sqrt(e * e - 1) * Math.sinh(hyp)];
}

/** Heliocentric ecliptic (J2000) position of the comet at `jd`, AU. */
export function cometHeliocentricXYZ(el: CometElements, jd: number): [number, number, number] {
  const [xp, yp] = orbitalPlanePosition(el.q, el.e, jd - el.tpJd);
  const w = el.peri * DEG;
  const node = el.node * DEG;
  const i = el.incl * DEG;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(i);
  const si = Math.sin(i);
  return [
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Astrometric geocentric RA/Dec (J2000) of the comet at `jd` (UT ≈ TT here). */
export function cometRaDec(el: CometElements, jd: number): CometPosition {
  const earth = earthHeliocentricXYZ(jd);
  let comet = cometHeliocentricXYZ(el, jd);
  const firstDelta = Math.hypot(comet[0] - earth[0], comet[1] - earth[1], comet[2] - earth[2]);
  comet = cometHeliocentricXYZ(el, jd - firstDelta * LIGHT_DAYS_PER_AU);

  const x = comet[0] - earth[0];
  const yEcl = comet[1] - earth[1];
  const zEcl = comet[2] - earth[2];
  const y = yEcl * Math.cos(OBLIQUITY) - zEcl * Math.sin(OBLIQUITY);
  const z = yEcl * Math.sin(OBLIQUITY) + zEcl * Math.cos(OBLIQUITY);
  const ra = Math.atan2(y, x) / DEG;
  return {
    raDeg: ((ra % 360) + 360) % 360,
    decDeg: Math.atan2(z, Math.hypot(x, y)) / DEG,
    rAu: Math.hypot(comet[0], comet[1], comet[2]),
    deltaAu: Math.hypot(x, y, z),
  };
}

/**
 * Predicted total visual magnitude: M1 + 5 log Δ + K1 log r, where the MPC
 * publishes K1 / 2.5 as its "G" column. Null when the MPC gives no magnitude
 * parameters. Comet brightness is notoriously unpredictable — a rough guide only.
 */
export function cometTotalMag(el: CometElements, rAu: number, deltaAu: number): number | null {
  if (el.h === null || el.k === null) return null;
  return el.h + 5 * Math.log10(deltaAu) + 2.5 * el.k * Math.log10(rAu);
}

/** Apparent motion on the sky, arcminutes per hour (centred ±30 min difference). */
export function cometRateArcminPerHour(el: CometElements, jd: number): number {
  const half = 0.5 / 24;
  const a = cometRaDec(el, jd - half);
  const b = cometRaDec(el, jd + half);
  const cosDec = Math.cos(((a.decDeg + b.decDeg) / 2) * DEG);
  let dRa = b.raDeg - a.raDeg;
  if (dRa > 180) dRa -= 360;
  if (dRa < -180) dRa += 360;
  return Math.hypot(dRa * cosDec, b.decDeg - a.decDeg) * 60;
}
