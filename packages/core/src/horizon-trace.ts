/**
 * Terrain-aware horizon computation.
 *
 * Given an observer's latitude/longitude, fetch open Terrarium DEM tiles for the
 * surrounding terrain, then ray-trace outward in every compass direction to find
 * how high the land rises — the observer's real skyline. Returns the horizon
 * altitude (degrees above the astronomical horizon) sampled once per degree of
 * azimuth (0 = North, clockwise).
 *
 * DEM source: AWS "elevation-tiles-prod" Terrarium PNG tiles (open data, no key),
 * RGB-encoded as `elevation_m = R*256 + G + B/256 - 32768`.
 *
 * The tiles are fetched and the result cached by the horizon service
 * (services/horizon.ts); this module holds the pure parts: the tile maths, the ray
 * trace and the choice of the summits on the skyline.
 */

import type { OverpassPeak } from './overpass';
import type { HorizonSummit } from './horizon-io';

export type { HorizonSummit };

/** One skyline "shell": the silhouette formed by terrain within `maxDistKm`. */
export interface HorizonLayer {
  maxDistKm: number;
  alts: number[];
}

export interface HorizonProfileResult {
  lat: number;
  lon: number;
  /** Eye height above local ground (m) used; null ⇒ default 1.7 m applied. */
  obsHeightM: number | null;
  azStepDeg: number;
  /** The true horizon (max over all distances) — === layers[last].alts. */
  alts: number[];
  /** Near→far distance shells, for layered (depth) rendering. */
  layers: HorizonLayer[];
  summits: HorizonSummit[];
  source: 'auto';
}

export const EARTH_R = 6371000; // m
const REFRACTION_K = 0.13; // standard atmospheric refraction coefficient
const R_EFF = EARTH_R / (1 - REFRACTION_K);
export const DEG = Math.PI / 180;
export const DEFAULT_EYE_HEIGHT_M = 1.7;
const ALT_FLOOR_DEG = -5; // clamp valley-floor / below-observer horizons
export const TILE_ZOOM = 12; // ~38 m/px at the equator
export const TILE_SIZE = 256;
export const MAX_TILES = 400; // guardrail against an over-large radius
const STEP_M = 30; // ray-march step distance
export const PEAK_QUERY_RADIUS_M = 30000; // cap the Overpass peak bbox (lighter query)
// Fine distance shells (km) so the near→far tone reads as continuous atmospheric
// haze rather than a few chunky bands. The full radius is always appended as the
// last shell (the true horizon).
export const SHELL_KM = [2, 4, 7, 11, 16, 23];

export const TILE_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

export function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
export function lat2tileY(lat: number, z: number): number {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/**
 * Select the named peaks that sit on the ray-traced skyline, from a set of OSM
 * peaks. A peak is kept when its own elevation angle reaches (within `skylineTol`)
 * the horizon crest at its azimuth — i.e. it isn't hidden behind nearer/higher
 * terrain. Peaks within `azMerge` degrees are deduped keeping the taller one, and
 * the result is capped to `maxSummits` by elevation. Pure (no network) for tests.
 *
 * Each summit's `altDeg` is set to the *silhouette* altitude at its azimuth so its
 * dot lands exactly on the drawn horizon line, not on the (possibly slightly
 * different) peak-to-observer angle.
 */
export function selectSkylineSummits(
  peaks: OverpassPeak[],
  alts: number[],
  observer: { lat: number; lon: number; obsElev: number },
  elevationAt: (latD: number, lonD: number) => number,
  opts: { radiusM: number; skylineTolDeg?: number; azMergeDeg?: number; maxSummits?: number },
): HorizonSummit[] {
  const skylineTol = opts.skylineTolDeg ?? 0.5;
  const azMerge = opts.azMergeDeg ?? 2;
  const maxSummits = opts.maxSummits ?? 40;
  const { lat, lon, obsElev } = observer;
  const cosLat = Math.cos(lat * DEG);
  const azStep = 360 / alts.length;

  const horizonAt = (azDeg: number): number => {
    const n = alts.length;
    const pos = ((((azDeg % 360) + 360) % 360) / azStep) % n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const f = pos - Math.floor(pos);
    return alts[i0] * (1 - f) + alts[i1] * f;
  };

  const scored: (HorizonSummit & { _ele: number })[] = [];
  for (const p of peaks) {
    const northM = (p.lat - lat) * DEG * EARTH_R;
    const eastM = (p.lon - lon) * DEG * EARTH_R * cosLat;
    const dist = Math.hypot(northM, eastM);
    if (dist < 50 || dist > opts.radiusM) continue; // observer's own spot / out of range
    const az = (((Math.atan2(eastM, northM) / DEG) % 360) + 360) % 360; // bearing from N, CW
    const ele = p.eleM ?? elevationAt(p.lat, p.lon);
    const drop = (dist * dist) / (2 * R_EFF);
    const peakAngle = Math.atan2(ele - obsElev - drop, dist) / DEG;
    const crest = horizonAt(az);
    if (crest - peakAngle > skylineTol) continue; // hidden behind nearer/higher terrain
    scored.push({
      name: p.name,
      azDeg: az,
      altDeg: crest,
      elevationM: Math.round(ele),
      distanceKm: Math.round(dist / 100) / 10,
      _ele: ele,
    });
  }

  // Dedup peaks that would overlap on screen (close in azimuth), keeping the taller.
  scored.sort((a, b) => a.azDeg - b.azDeg);
  const merged: (HorizonSummit & { _ele: number })[] = [];
  for (const c of scored) {
    const last = merged[merged.length - 1];
    if (last && c.azDeg - last.azDeg < azMerge) {
      if (c._ele > last._ele) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }

  // Cap to the tallest N, then restore azimuth order for stable rendering.
  merged.sort((a, b) => b._ele - a._ele);
  const capped = merged.slice(0, maxSummits);
  capped.sort((a, b) => a.azDeg - b.azDeg);
  return capped.map(({ _ele, ...s }) => s);
}

/**
 * Ray-trace the horizon for every azimuth at one or more nested distance shells,
 * given a terrain elevation lookup. Returns one `alts` array (degrees) per shell,
 * ordered near→far to match `shellsM`; the running max is snapshotted as each shell
 * boundary is crossed, so a nearer shell's silhouette is the skyline formed by
 * terrain within that distance only. Pure and DEM-source-agnostic (unit-tested).
 * With the default single shell (`[radiusM]`) it returns the plain full horizon.
 */
export function traceHorizonAngles(
  elevationAt: (latD: number, lonD: number) => number,
  lat: number,
  lon: number,
  opts: {
    radiusM: number;
    obsElev: number;
    azStepDeg?: number;
    stepM?: number;
    shellsM?: number[];
  },
): number[][] {
  const { radiusM, obsElev } = opts;
  const azStepDeg = opts.azStepDeg ?? 1;
  const stepM = opts.stepM ?? STEP_M;
  const shellsM = opts.shellsM ?? [radiusM];
  const nShells = shellsM.length;
  const cosLat = Math.cos(lat * DEG);
  const nAz = Math.round(360 / azStepDeg);
  const shells: number[][] = Array.from({ length: nShells }, () => new Array<number>(nAz));

  for (let ai = 0; ai < nAz; ai++) {
    const az = ai * azStepDeg;
    const sinAz = Math.sin(az * DEG);
    const cosAz = Math.cos(az * DEG);
    let maxAngle = ALT_FLOOR_DEG * DEG;
    let k = 0; // next shell boundary to snapshot at
    for (let d = stepM; d <= radiusM; d += stepM) {
      // Freeze any shells whose boundary this step has passed (max of terrain nearer than it).
      while (k < nShells && d > shellsM[k]) {
        shells[k][ai] = Math.max(ALT_FLOOR_DEG, maxAngle / DEG);
        k++;
      }
      const northM = d * cosAz;
      const eastM = d * sinAz;
      const sLat = lat + northM / EARTH_R / DEG;
      const sLon = lon + eastM / (EARTH_R * cosLat) / DEG;
      const h = elevationAt(sLat, sLon);
      // Elevation angle with Earth-curvature + refraction drop.
      const drop = (d * d) / (2 * R_EFF);
      const angle = Math.atan2(h - obsElev - drop, d);
      if (angle > maxAngle) maxAngle = angle;
    }
    // Remaining shells (including the full-radius last one) get the final running max.
    for (; k < nShells; k++) shells[k][ai] = Math.max(ALT_FLOOR_DEG, maxAngle / DEG);
  }
  return shells;
}
