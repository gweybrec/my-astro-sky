/**
 * Horizon profile — data model, file parsing, and azimuth interpolation.
 *
 * A horizon profile is the observer's real skyline: the terrain altitude (degrees
 * above the astronomical horizon) as a function of compass azimuth. It is stored
 * as a *dense* array sampled every `azStepDeg` degrees starting at azimuth 0 (North),
 * going clockwise (N→E→S→W). Sparse imported/manual points are densified into the
 * same form so drawing and the target recommender can sample any azimuth cheaply.
 *
 * This module is intentionally free of DOM/canvas/astro dependencies so it can be
 * unit-tested in isolation and shared by the sky-map renderer and the recommender.
 */

export interface HorizonProfile {
  /** Location the profile was computed/imported for (informational; import may be 0/0). */
  lat: number;
  lon: number;
  /** Observer eye elevation used, in metres. null = terrain surface (auto default). */
  obsHeightM: number | null;
  /** Azimuth sample step in degrees; alts.length === 360 / azStepDeg. */
  azStepDeg: number;
  /** Horizon altitude in degrees at each azimuth: index i → azimuth i * azStepDeg. */
  alts: number[];
  /** Named summits sitting on the skyline (auto profiles only; optional). */
  summits?: HorizonSummit[];
  source: 'auto' | 'import' | 'manual';
}

/**
 * A named mountain summit that lies on the drawn skyline. `altDeg` is the
 * silhouette altitude at the summit's azimuth (so its dot sits on the line);
 * `elevationM` is the peak's real height above sea level.
 */
export interface HorizonSummit {
  name: string;
  azDeg: number;
  altDeg: number;
  elevationM: number;
  distanceKm: number;
}

/** A single (azimuth, altitude) point, both in degrees. */
export interface HorizonPoint {
  azDeg: number;
  altDeg: number;
}

/** Lowest altitude a valley-floor / below-observer horizon is clamped to. */
export const HORIZON_ALT_FLOOR_DEG = -5;

/** Normalise an azimuth into the [0, 360) range. */
export function wrapAz(azDeg: number): number {
  return ((azDeg % 360) + 360) % 360;
}

/**
 * Horizon altitude (degrees) at an arbitrary azimuth, via wrap-around linear
 * interpolation between the two nearest dense samples. Safe for any azimuth,
 * including the seam between the last sample and azimuth 0.
 */
export function horizonAltAt(profile: HorizonProfile, azDeg: number): number {
  const { alts, azStepDeg } = profile;
  const n = alts.length;
  if (n === 0) return HORIZON_ALT_FLOOR_DEG;
  if (n === 1) return alts[0];
  const az = wrapAz(azDeg);
  const pos = az / azStepDeg;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const frac = pos - Math.floor(pos);
  return alts[i0] * (1 - frac) + alts[i1] * frac;
}

/**
 * Turn a set of sparse (az, alt) points into a dense HorizonProfile sampled every
 * `azStepDeg`. Points are interpolated linearly with wrap-around, so a profile
 * described by a handful of ridge points fills the full circle smoothly.
 */
export function densifyPoints(
  points: HorizonPoint[],
  opts: {
    azStepDeg?: number;
    lat?: number;
    lon?: number;
    obsHeightM?: number | null;
    source?: HorizonProfile['source'];
  } = {},
): HorizonProfile {
  const azStepDeg = opts.azStepDeg ?? 1;
  const n = Math.round(360 / azStepDeg);
  const base: HorizonProfile = {
    lat: opts.lat ?? 0,
    lon: opts.lon ?? 0,
    obsHeightM: opts.obsHeightM ?? null,
    azStepDeg,
    alts: new Array(n).fill(HORIZON_ALT_FLOOR_DEG),
    source: opts.source ?? 'import',
  };
  if (points.length === 0) return base;

  // Sort by azimuth and wrap them so interpolation across the 360→0 seam works.
  const sorted = points
    .map((p) => ({ azDeg: wrapAz(p.azDeg), altDeg: p.altDeg }))
    .sort((a, b) => a.azDeg - b.azDeg);
  if (sorted.length === 1) {
    base.alts.fill(sorted[0].altDeg);
    return base;
  }
  // Ghost the last point before the first (az-360) and the first after the last (az+360)
  // so every target azimuth falls between two neighbours.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const ring = [
    { azDeg: last.azDeg - 360, altDeg: last.altDeg },
    ...sorted,
    { azDeg: first.azDeg + 360, altDeg: first.altDeg },
  ];

  for (let i = 0; i < n; i++) {
    const az = i * azStepDeg;
    // Find the bracketing ring segment.
    let j = 0;
    while (j < ring.length - 1 && ring[j + 1].azDeg < az) j++;
    const a = ring[j];
    const b = ring[j + 1];
    const span = b.azDeg - a.azDeg;
    const frac = span <= 0 ? 0 : (az - a.azDeg) / span;
    base.alts[i] = a.altDeg * (1 - frac) + b.altDeg * frac;
  }
  return base;
}

/**
 * Parse an imported horizon file into a HorizonProfile.
 *
 * Accepts the two formats astronomers already have to hand:
 *  - a plain `az,alt` CSV (comma or semicolon separated), and
 *  - the Stellarium *polygonal* horizon list (`az alt`, whitespace separated),
 *    which PeakFinder and HeyWhatsThat both export.
 *
 * Blank lines and `#` / `//` comments are ignored. Any line whose first two
 * tokens parse as numbers is treated as an (azimuth, altitude) pair in degrees,
 * azimuth measured clockwise from North. Throws if no valid points are found.
 */
export function parseHorizonFile(
  text: string,
  meta: { lat?: number; lon?: number } = {},
): HorizonProfile {
  const points: HorizonPoint[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(#|\/\/).*$/, '').trim();
    if (!line) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const azDeg = Number(tokens[0]);
    const altDeg = Number(tokens[1]);
    if (!Number.isFinite(azDeg) || !Number.isFinite(altDeg)) continue;
    points.push({ azDeg, altDeg });
  }
  if (points.length === 0) {
    throw new Error('No valid "azimuth altitude" pairs found in horizon file');
  }
  return densifyPoints(points, { lat: meta.lat, lon: meta.lon, source: 'import' });
}
