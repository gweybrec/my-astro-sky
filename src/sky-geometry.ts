/**
 * Sky geometry — altitude/azimuth, transit time, visibility over a night.
 */

import { dateToJD, lstHours } from './astro-time';

const DEG = Math.PI / 180;

/** Alt/Az in degrees from equatorial coordinates */
export function altAzFromRaDec(
  raDeg: number,
  decDeg: number,
  lstH: number,       // local sidereal time in hours
  latDeg: number,
): { altDeg: number; azDeg: number } {
  const ha = ((lstH - raDeg / 15 + 24) % 24) * 15 * DEG; // hour angle rad
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz =
    (Math.sin(dec) - Math.sin(altRad) * Math.sin(lat)) /
    (Math.cos(altRad) * Math.cos(lat) + 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG;
  if (Math.sin(ha) > 0) az = 360 - az;

  return { altDeg: altRad / DEG, azDeg: az };
}

/** Transit LST (hours) = RA in hours */
export function transitLstHours(raDeg: number): number {
  return raDeg / 15;
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

  for (
    let t = windowStart.getTime();
    t <= windowEnd.getTime();
    t += dtMs
  ) {
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

/** One altitude sample along the night. */
export interface AltSample {
  time: Date;
  altDeg: number;
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
  if (endMs <= startMs) {
    const jd = dateToJD(windowStart);
    const lst = lstHours(jd, lonDeg);
    return [{ time: new Date(startMs), altDeg: altAzFromRaDec(raDeg, decDeg, lst, latDeg).altDeg }];
  }
  for (let tMs = startMs; tMs <= endMs; tMs += dtMs) {
    const time = new Date(tMs);
    const jd = dateToJD(time);
    const lst = lstHours(jd, lonDeg);
    samples.push({ time, altDeg: altAzFromRaDec(raDeg, decDeg, lst, latDeg).altDeg });
  }
  // Ensure the exact window end is represented (loop may stop just short).
  const last = samples[samples.length - 1];
  if (last.time.getTime() < endMs) {
    const jd = dateToJD(windowEnd);
    const lst = lstHours(jd, lonDeg);
    samples.push({ time: new Date(endMs), altDeg: altAzFromRaDec(raDeg, decDeg, lst, latDeg).altDeg });
  }
  return samples;
}

/**
 * For objects that might be above the horizon during the window,
 * returns true if max altitude ≥ minAltDeg.
 * Quick pre-filter using theoretical max altitude to avoid full sampling.
 */
export function mightBeVisible(
  decDeg: number,
  latDeg: number,
  minAltDeg = 30,
): boolean {
  // Maximum possible altitude = 90 - |lat - dec|, capped
  const maxPossible = 90 - Math.abs(latDeg - decDeg);
  return maxPossible >= minAltDeg;
}
