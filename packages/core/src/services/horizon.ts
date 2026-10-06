/**
 * Terrain horizon of a location: the observer's real skyline, from open Terrarium elevation
 * tiles (AWS `elevation-tiles-prod`, PNG, RGB-encoded as `elevation_m = R*256 + G + B/256 - 32768`),
 * ray-traced in every compass direction, plus the named summits (OpenStreetMap Overpass) sitting
 * on it. The tiles and the peaks come through the `HttpClient` port, the PNG tiles are decoded by
 * the `ImageCodec` port, and a computed profile is cached in the `horizon_profiles` table.
 */
import { DomainError } from '../domain/errors';
import type { HorizonQuery } from '../domain/horizon';
import {
  DEFAULT_EYE_HEIGHT_M,
  DEG,
  EARTH_R,
  MAX_TILES,
  PEAK_QUERY_RADIUS_M,
  SHELL_KM,
  TILE_BASE,
  TILE_SIZE,
  TILE_ZOOM,
  lat2tileY,
  lon2tileX,
  selectSkylineSummits,
  traceHorizonAngles,
  type HorizonLayer,
  type HorizonProfileResult,
  type HorizonSummit,
} from '../horizon-trace';
import { fetchPeaks } from '../overpass';
import type { HttpClient } from '../ports/http-client';
import type { ImageCodec } from '../ports/image-codec';
import type { SqlDb } from '../ports/sql-db';

export type { HorizonLayer, HorizonProfileResult, HorizonSummit };

// Bump when the computed profile's shape/content changes (e.g. summits added), so
// stale entries from an older algorithm are bypassed rather than served forever.
const HORIZON_CACHE_VERSION = 'v5';

/** Cache key: version + 3-decimal lat/lon (~100 m) plus radius (km) and eye height (m). */
export function horizonCacheKey(
  lat: number,
  lon: number,
  radiusKm: number,
  obsHeightM: number | null,
): string {
  return `${HORIZON_CACHE_VERSION}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}:${obsHeightM ?? 'auto'}`;
}

export interface HorizonServiceDeps {
  db: SqlDb;
  http: HttpClient;
  images: ImageCodec;
  /** The clock, in milliseconds since the epoch. The profile cache has no expiry (terrain does not move), so nothing reads it today. */
  now: () => number;
  /** Where a non-fatal problem (the peaks could not be fetched) is reported. */
  log?: (event: string, error: unknown, context?: Record<string, unknown>) => void;
  /** Waits between two Overpass attempts; the default is a timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface HorizonService {
  /**
   * The horizon profile of a location, from the cache when one exists (1 database round trip), else
   * computed and cached (2 round trips). Throws `invalid` (INVALID_LAT_LON) for a latitude or
   * longitude that is not a number or a latitude outside -90..90, and `upstream`
   * (HORIZON_COMPUTE_FAILED, with the original error as `cause`) when the tiles cannot be fetched,
   * decoded or traced. A failure to get the named summits never fails the profile.
   */
  getProfile(query: HorizonQuery): Promise<HorizonProfileResult>;
}

async function readCached(db: SqlDb, key: string): Promise<HorizonProfileResult | undefined> {
  const row = await db.get<{ json: string }>('SELECT json FROM horizon_profiles WHERE key = ?', [
    key,
  ]);
  if (!row) return undefined;
  try {
    return JSON.parse(row.json) as HorizonProfileResult;
  } catch {
    return undefined;
  }
}

export function createHorizonService(deps: HorizonServiceDeps): HorizonService {
  const { db, http, images, log, sleep } = deps;

  async function fetchTile(z: number, x: number, y: number): Promise<Float32Array | null> {
    const res = await http({ method: 'GET', url: `${TILE_BASE}/${z}/${x}/${y}.png` });
    // A missing tile (e.g. out of coverage) is treated as sea level.
    if (res.status < 200 || res.status > 299) return null;
    const { data, channels } = await images.decode(await res.bytes());
    const out = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      out[i] = r * 256 + g + b / 256 - 32768;
    }
    return out;
  }

  async function compute(
    lat: number,
    lon: number,
    opts: { radiusKm: number; obsHeightM: number | null },
  ): Promise<HorizonProfileResult> {
    const radiusKm = Math.max(1, Math.min(100, opts.radiusKm));
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

    // Ray-trace the skyline at nested distance shells (near to far). The last shell is
    // the full radius = the true horizon; the nearer shells give the foreground
    // ridges the renderer layers back-to-front for depth.
    const shellsKm = [...new Set([...SHELL_KM.filter((k) => k < radiusKm), radiusKm])];
    const shellsM = shellsKm.map((k) => k * 1000);
    const shellAlts = traceHorizonAngles(elevationAt, lat, lon, { radiusM, obsElev, shellsM });
    const alts = shellAlts[shellAlts.length - 1]; // farthest = true horizon
    const layers: HorizonLayer[] = shellsKm.map((k, i) => ({ maxDistKm: k, alts: shellAlts[i] }));

    // Named summits are best-effort: a failed/absent Overpass response must never
    // fail the horizon itself (which is the important product here). The peak query
    // is capped to a smaller radius than the terrain trace: distant peaks sit low
    // on the sky, and a tighter bbox is far less likely to time out the public
    // Overpass API.
    let summits: HorizonSummit[] = [];
    try {
      const peakRadiusM = Math.min(radiusM, PEAK_QUERY_RADIUS_M);
      const pdLat = peakRadiusM / EARTH_R / DEG;
      const pdLon = peakRadiusM / (EARTH_R * Math.cos(lat * DEG)) / DEG;
      const peaks = await fetchPeaks(
        http,
        { south: lat - pdLat, west: lon - pdLon, north: lat + pdLat, east: lon + pdLon },
        sleep,
      );
      summits = selectSkylineSummits(peaks, alts, { lat, lon, obsElev }, elevationAt, { radiusM });
    } catch (err) {
      log?.('overpass_fetch_failed', err, { lat, lon });
    }

    return {
      lat,
      lon,
      obsHeightM: opts.obsHeightM ?? null,
      azStepDeg: 1,
      alts,
      layers,
      summits,
      source: 'auto',
    };
  }

  return {
    async getProfile(query) {
      const { lat, lon } = query;
      if (
        typeof lat !== 'number' ||
        typeof lon !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90
      ) {
        throw new DomainError('invalid', 'Invalid or missing lat/lon', {
          code: 'INVALID_LAT_LON',
        });
      }
      const radiusKm =
        typeof query.radiusKm === 'number' && Number.isFinite(query.radiusKm) ? query.radiusKm : 40;
      const obsHeightM =
        typeof query.obsHeightM === 'number' && Number.isFinite(query.obsHeightM)
          ? query.obsHeightM
          : null;

      const key = horizonCacheKey(lat, lon, radiusKm, obsHeightM);
      const cached = await readCached(db, key);
      if (cached) return cached;

      try {
        const profile = await compute(lat, lon, { radiusKm, obsHeightM });
        await db.run('INSERT OR REPLACE INTO horizon_profiles (key, json) VALUES (?, ?)', [
          key,
          JSON.stringify(profile),
        ]);
        return profile;
      } catch (err) {
        const message = 'Failed to compute horizon from elevation data';
        const failure = new DomainError('upstream', message, {
          code: 'HORIZON_COMPUTE_FAILED',
          body: { error: message },
        });
        failure.cause = err;
        throw failure;
      }
    },
  };
}
