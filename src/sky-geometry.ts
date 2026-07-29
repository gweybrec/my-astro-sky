/**
 * Sky geometry — altitude/azimuth, transit time, visibility over a night.
 */

import { dateToJD, lstHours, moonRaDecDeg } from './astro-time';

const DEG = Math.PI / 180;

/** Alt/Az in degrees from equatorial coordinates */
export function altAzFromRaDec(
  raDeg: number,
  decDeg: number,
  lstH: number, // local sidereal time in hours
  latDeg: number,
): { altDeg: number; azDeg: number } {
  const ha = ((lstH - raDeg / 15 + 24) % 24) * 15 * DEG; // hour angle rad
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz =
    (Math.sin(dec) - Math.sin(altRad) * Math.sin(lat)) / (Math.cos(altRad) * Math.cos(lat) + 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG;
  if (Math.sin(ha) > 0) az = 360 - az;

  return { altDeg: altRad / DEG, azDeg: az };
}

/** Transit LST (hours) = RA in hours */
export function transitLstHours(raDeg: number): number {
  return raDeg / 15;
}

/** Altitude of an object above the horizon at a single instant. */
export function altitudeAtDeg(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  date: Date,
): number {
  const jd = dateToJD(date);
  const lst = lstHours(jd, lonDeg);
  return altAzFromRaDec(raDeg, decDeg, lst, latDeg).altDeg;
}

/**
 * Great-circle angular separation in degrees between two equatorial points.
 * Uses the haversine / atan2 form (numerically stable at small angles, which
 * is exactly the regime the moon-proximity colour thresholds care about).
 */
export function angularSeparationDeg(
  ra1Deg: number,
  dec1Deg: number,
  ra2Deg: number,
  dec2Deg: number,
): number {
  const dRa = (ra2Deg - ra1Deg) * DEG;
  const d1 = dec1Deg * DEG,
    d2 = dec2Deg * DEG;
  const dDec = d2 - d1;
  const a = Math.sin(dDec / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(dRa / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / DEG;
}

/**
 * Moonlight interference level for a target, weighted by both the angular
 * separation and the Moon's illuminated fraction. A near-full moon poisons a
 * large swath of the sky; a thin crescent / new moon is harmless almost
 * everywhere. Thresholds therefore scale with `illum` rather than being fixed
 * degree cutoffs. Constants are deliberately coarse and easy to tune.
 */
const ILLUM_MAX_DANGER_DEG = 90; // danger radius at full moon
const DANGER_TRANSITION_DEG = 30; // amber band beyond the red line
export function moonDangerLevel(sepDeg: number, illum: number): 'danger' | 'warn' | 'ok' {
  if (illum < 0.1) return 'ok'; // moon too dim to matter at any separation
  const redLine = ILLUM_MAX_DANGER_DEG * illum;
  const amberLine = redLine + DANGER_TRANSITION_DEG;
  if (sepDeg < redLine) return 'danger';
  if (sepDeg < amberLine) return 'warn';
  return 'ok';
}

/**
 * Maximum altitude of an object during a window, sampled every stepMin minutes.
 * Returns the best altitude found and the UTC Date it occurs.
 */
export function maxAltDuringWindow(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  windowStart: Date,
  windowEnd: Date,
  stepMin = 10,
): { maxAltDeg: number; atDate: Date } {
  const dtMs = stepMin * 60 * 1000;
  let best = -Infinity;
  let bestDate = windowStart;

  for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += dtMs) {
    const date = new Date(t);
    const jd = dateToJD(date);
    const lst = lstHours(jd, lonDeg);
    const { altDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    if (altDeg > best) {
      best = altDeg;
      bestDate = date;
    }
  }

  return { maxAltDeg: best, atDate: bestDate };
}

/** One altitude sample along the night (azimuth kept for direction readouts). */
export interface AltSample {
  time: Date;
  altDeg: number;
  /** Azimuth in degrees, clockwise from North (0 = N, 90 = E). */
  azDeg: number;
}

/**
 * Sample an object's altitude across a window, every `stepMin` minutes.
 * Returns evenly-spaced `{ time, altDeg }` points (inclusive of both ends),
 * for drawing an altitude-over-the-night timeline.
 */
export function sampleAltCurve(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  windowStart: Date,
  windowEnd: Date,
  stepMin = 10,
): AltSample[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const dtMs = Math.max(1, stepMin) * 60 * 1000;
  const samples: AltSample[] = [];
  const sampleAt = (tMs: number): AltSample => {
    const time = new Date(tMs);
    const lst = lstHours(dateToJD(time), lonDeg);
    const { altDeg, azDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    return { time, altDeg, azDeg };
  };
  if (endMs <= startMs) return [sampleAt(startMs)];
  for (let tMs = startMs; tMs <= endMs; tMs += dtMs) samples.push(sampleAt(tMs));
  // Ensure the exact window end is represented (loop may stop just short).
  if (samples[samples.length - 1].time.getTime() < endMs) samples.push(sampleAt(endMs));
  return samples;
}

/**
 * Sample the Moon's altitude across a window, every `stepMin` minutes.
 * Unlike `sampleAltCurve`, the Moon's RA/Dec is recomputed at every step
 * because the Moon moves ~0.5°/hr (a fixed position would be wrong over a
 * multi-hour night). Returns evenly-spaced, end-inclusive `{ time, altDeg }`.
 */
export function sampleMoonAltCurve(
  latDeg: number,
  lonDeg: number,
  windowStart: Date,
  windowEnd: Date,
  stepMin = 10,
): AltSample[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const dtMs = Math.max(1, stepMin) * 60 * 1000;
  const sampleAt = (tMs: number): AltSample => {
    const time = new Date(tMs);
    const jd = dateToJD(time);
    const { raDeg, decDeg } = moonRaDecDeg(jd);
    const lst = lstHours(jd, lonDeg);
    const { altDeg, azDeg } = altAzFromRaDec(raDeg, decDeg, lst, latDeg);
    return { time, altDeg, azDeg };
  };
  if (endMs <= startMs) return [sampleAt(startMs)];
  const samples: AltSample[] = [];
  for (let tMs = startMs; tMs <= endMs; tMs += dtMs) samples.push(sampleAt(tMs));
  if (samples[samples.length - 1].time.getTime() < endMs) samples.push(sampleAt(endMs));
  return samples;
}

/** A moment when an object's azimuth crosses an exact multiple of a step. */
export interface AzCrossing {
  time: Date;
  /** Azimuth in [0, 360), an exact multiple of the step (0 = N, 90 = E, …). */
  azDeg: number;
  /** Altitude interpolated at the crossing, to tell horizon side. */
  altDeg: number;
}

/** True for the four cardinal directions (N/E/S/W). */
export function isCardinalAz(azDeg: number): boolean {
  return azDeg % 90 === 0;
}

/**
 * Times at which an object's azimuth crosses each multiple of `stepDeg` along a
 * sampled curve — used to mark direction (N/E/S/W plus finer graduations) on the
 * time axis of a trajectory chart.
 *
 * Azimuth is unwrapped as the curve is walked (each step follows the shortest
 * signed delta), so the 0/360 discontinuity at north needs no special case, and
 * *every* multiple spanned by a sample interval is emitted — near a zenith
 * passage azimuth can swing more than 90° between two 10-minute samples, which a
 * pairwise "did it cross" test would miss. Crossings below `minAltDeg` are
 * dropped (by default, everything under the horizon).
 */
export function azimuthCrossings(curve: AltSample[], stepDeg = 15, minAltDeg = 0): AzCrossing[] {
  const step = Math.abs(stepDeg);
  if (curve.length < 2 || step <= 0) return [];
  const out: AzCrossing[] = [];
  let unwrapped = curve[0].azDeg;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1],
      b = curve[i];
    // Shortest signed delta into (-180, 180], so the walk never jumps 360°.
    const delta = ((b.azDeg - a.azDeg + 540) % 360) - 180;
    const from = unwrapped;
    const to = from + delta;
    unwrapped = to;
    if (delta === 0) continue;
    // Multiples of `step` strictly between `from` and `to`, in travel order.
    const lo = Math.min(from, to),
      hi = Math.max(from, to);
    const firstK = Math.floor(lo / step) + 1;
    const lastK = Math.ceil(hi / step) - 1;
    const ks: number[] = [];
    for (let k = firstK; k <= lastK; k++) ks.push(k);
    if (delta < 0) ks.reverse();
    for (const k of ks) {
      const frac = (k * step - from) / delta; // 0..1 within the interval
      const altDeg = a.altDeg + frac * (b.altDeg - a.altDeg);
      if (altDeg < minAltDeg) continue;
      out.push({
        time: new Date(a.time.getTime() + frac * (b.time.getTime() - a.time.getTime())),
        azDeg: (((k * step) % 360) + 360) % 360,
        altDeg,
      });
    }
  }
  return out;
}

/**
 * Thin a crossing list so no two kept entries are closer than `minGap` on the
 * x axis (`xOf` maps a crossing to whatever unit the caller draws in). Cardinal
 * directions are reserved first and win every conflict, so a graduation never
 * crowds an N/E/S/W label. Order is preserved.
 */
export function thinCrossingsByX<T extends AzCrossing>(
  items: T[],
  xOf: (c: T) => number,
  minGap: number,
): T[] {
  const cardinals = items.filter((c) => isCardinalAz(c.azDeg));
  const kept = new Set<T>(cardinals);
  const xs = cardinals.map(xOf);
  for (const item of items) {
    if (kept.has(item)) continue;
    const x = xOf(item);
    if (xs.some((k) => Math.abs(k - x) < minGap)) continue;
    kept.add(item);
    xs.push(x);
  }
  return items.filter((c) => kept.has(c));
}

/**
 * Inverse of altAzFromRaDec: horizontal coordinates → equatorial.
 * Needed for unprojecting fisheye canvas coordinates back to RA/Dec.
 */
export function raDecFromAltAz(
  altDeg: number,
  azDeg: number,
  lstH: number,
  latDeg: number,
): { raDeg: number; decDeg: number } {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const lat = latDeg * DEG;

  const sinDec = Math.sin(lat) * Math.sin(alt) + Math.cos(lat) * Math.cos(alt) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  const cosHA = (Math.sin(alt) - Math.sin(lat) * sinDec) / (Math.cos(lat) * Math.cos(dec) + 1e-12);
  let ha = Math.acos(Math.max(-1, Math.min(1, cosHA))) / DEG;
  if (Math.sin(az) > 0) ha = 360 - ha;

  let ra = (((lstH * 15 - ha) % 360) + 360) % 360;
  return { raDeg: ra, decDeg: dec / DEG };
}

/**
 * For objects that might be above the horizon during the window,
 * returns true if max altitude ≥ minAltDeg.
 * Quick pre-filter using theoretical max altitude to avoid full sampling.
 */
export function mightBeVisible(decDeg: number, latDeg: number, minAltDeg = 30): boolean {
  // Maximum possible altitude = 90 - |lat - dec|, capped
  const maxPossible = 90 - Math.abs(latDeg - decDeg);
  return maxPossible >= minAltDeg;
}
