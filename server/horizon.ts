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
 * Tiles are fetched server-side (avoiding browser CORS) and this whole loop runs
 * off the render thread — the same rationale as proxying astrometry.net in
 * server/astrometry.ts. Results are cached by the caller (see /api/horizon).
 */

import sharp from 'sharp';
import { fetchPeaks, type OverpassPeak } from './overpass.js';
import { logServerError } from './logger.js';

/** A named summit sitting on the skyline (mirrors HorizonSummit in src/horizon-io.ts). */
export interface HorizonSummit {
  name: string;
  azDeg: number;
  altDeg: number;
  elevationM: number;
  distanceKm: number;
}

export interface HorizonProfileResult {
  lat: number;
  lon: number;
  /** Eye height above local ground (m) used; null ⇒ default 1.7 m applied. */
  obsHeightM: number | null;
  azStepDeg: number;
  alts: number[];
  summits: HorizonSummit[];
  source: 'auto';
}

const EARTH_R = 6371000; // m
const REFRACTION_K = 0.13; // standard atmospheric refraction coefficient
const R_EFF = EARTH_R / (1 - REFRACTION_K);
const DEG = Math.PI / 180;
const DEFAULT_EYE_HEIGHT_M = 1.7;
const ALT_FLOOR_DEG = -5; // clamp valley-floor / below-observer horizons
const TILE_ZOOM = 12; // ~38 m/px at the equator
const TILE_SIZE = 256;
const MAX_TILES = 400; // guardrail against an over-large radius
const STEP_M = 30; // ray-march step distance
const PEAK_QUERY_RADIUS_M = 30000; // cap the Overpass peak bbox (lighter query)

const TILE_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2tileY(lat: number, z: number): number {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const url = `${TILE_BASE}/${z}/${x}/${y}.png`;
  const res = await fetch(url);
  if (!res.ok) return null; // missing tile (e.g. out of coverage) → treated as sea level
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const r = data[i * ch];
    const g = data[i * ch + 1];
    const b = data[i * ch + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/**
 * Compute a horizon profile for the given location.
 * @param radiusKm  search radius for terrain (default 40 km).
 * @param obsHeightM eye height above local ground (m); default 1.7 m.
 */
export async function computeHorizon(
  lat: number,
  lon: number,
  opts: { radiusKm?: number; obsHeightM?: number | null } = {},
): Promise<HorizonProfileResult> {
  const radiusKm = Math.max(1, Math.min(100, opts.radiusKm ?? 40));
  const radiusM = radiusKm * 1000;
  const z = TILE_ZOOM;

  // Bounding box in degrees, padded so rays never leave the fetched grid.
  const dLat = radiusM / EARTH_R / DEG;
  const dLon = radiusM / (EARTH_R * Math.cos(lat * DEG)) / DEG;
  const north = lat + dLat;
  const south = lat - dLat;
  const west = lon - dLon;
  const east = lon + dLon;

  const tx0 = Math.floor(lon2tileX(west, z));
  const tx1 = Math.floor(lon2tileX(east, z));
  const ty0 = Math.floor(lat2tileY(north, z)); // north = smaller tile-y
  const ty1 = Math.floor(lat2tileY(south, z));
  const tilesX = tx1 - tx0 + 1;
  const tilesY = ty1 - ty0 + 1;
  if (tilesX * tilesY > MAX_TILES) {
    throw new Error(`Horizon radius too large: ${tilesX * tilesY} tiles exceeds ${MAX_TILES}`);
  }

  // Assemble one combined elevation grid covering the tile range.
  const gw = tilesX * TILE_SIZE;
  const gh = tilesY * TILE_SIZE;
  const grid = new Float32Array(gw * gh);
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(
        fetchTile(z, tx, ty).then((tile) => {
          if (!tile) return; // leave as 0 (sea level)
          const ox = (tx - tx0) * TILE_SIZE;
          const oy = (ty - ty0) * TILE_SIZE;
          for (let py = 0; py < TILE_SIZE; py++) {
            const dst = (oy + py) * gw + ox;
            const src = py * TILE_SIZE;
            grid.set(tile.subarray(src, src + TILE_SIZE), dst);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);

  // Global-pixel origin of the grid, so a lat/lon maps into it directly.
  const gx0 = tx0 * TILE_SIZE;
  const gy0 = ty0 * TILE_SIZE;

  function elevationAt(latD: number, lonD: number): number {
    const gx = lon2tileX(lonD, z) * TILE_SIZE - gx0;
    const gy = lat2tileY(latD, z) * TILE_SIZE - gy0;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= gw - 1 || y0 >= gh - 1) return 0;
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * gw + x0;
    const h00 = grid[i];
    const h10 = grid[i + 1];
    const h01 = grid[i + gw];
    const h11 = grid[i + gw + 1];
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
  }

  const obsGround = elevationAt(lat, lon);
  const eyeHeight = opts.obsHeightM ?? DEFAULT_EYE_HEIGHT_M;
  const obsElev = obsGround + eyeHeight;

  const alts = traceHorizonAngles(elevationAt, lat, lon, { radiusM, obsElev });

  // Named summits are best-effort: a failed/absent Overpass response must never
  // fail the horizon itself (which is the important product here). The peak query
  // is capped to a smaller radius than the terrain trace — distant peaks sit low
  // on the sky, and a tighter bbox is far less likely to time out the public
  // Overpass API.
  let summits: HorizonSummit[] = [];
  try {
    const peakRadiusM = Math.min(radiusM, PEAK_QUERY_RADIUS_M);
    const pdLat = peakRadiusM / EARTH_R / DEG;
    const pdLon = peakRadiusM / (EARTH_R * Math.cos(lat * DEG)) / DEG;
    const peaks = await fetchPeaks({
      south: lat - pdLat,
      west: lon - pdLon,
      north: lat + pdLat,
      east: lon + pdLon,
    });
    summits = selectSkylineSummits(peaks, alts, { lat, lon, obsElev }, elevationAt, { radiusM });
  } catch (err) {
    logServerError('overpass_fetch_failed', err, { lat, lon });
  }

  return {
    lat,
    lon,
    obsHeightM: opts.obsHeightM ?? null,
    azStepDeg: 1,
    alts,
    summits,
    source: 'auto',
  };
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
 * Ray-trace the horizon altitude (degrees) for every azimuth, given a terrain
 * elevation lookup. Pure and DEM-source-agnostic so it can be unit-tested against
 * a synthetic elevation function. Marches outward in `STEP_M` steps to `radiusM`,
 * tracking the maximum elevation angle (with Earth-curvature + refraction drop).
 */
export function traceHorizonAngles(
  elevationAt: (latD: number, lonD: number) => number,
  lat: number,
  lon: number,
  opts: { radiusM: number; obsElev: number; azStepDeg?: number; stepM?: number },
): number[] {
  const { radiusM, obsElev } = opts;
  const azStepDeg = opts.azStepDeg ?? 1;
  const stepM = opts.stepM ?? STEP_M;
  const cosLat = Math.cos(lat * DEG);
  const nAz = Math.round(360 / azStepDeg);
  const alts = new Array<number>(nAz);

  for (let ai = 0; ai < nAz; ai++) {
    const az = ai * azStepDeg;
    const sinAz = Math.sin(az * DEG);
    const cosAz = Math.cos(az * DEG);
    let maxAngle = ALT_FLOOR_DEG * DEG;
    for (let d = stepM; d <= radiusM; d += stepM) {
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
    alts[ai] = Math.max(ALT_FLOOR_DEG, maxAngle / DEG);
  }
  return alts;
}
