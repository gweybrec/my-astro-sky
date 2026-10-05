// OpenStreetMap Overpass client for named mountain summits (natural=peak).
//
// The DEM used to trace the horizon carries no place names, so summit labels come
// from OSM. The parser is a pure function kept out of the fetch wrapper so it can
// be unit-tested without the network. The requests go through the `HttpClient` port.

import type { HttpClient } from './ports/http-client';

export interface OverpassPeak {
  name: string;
  lat: number;
  lon: number;
  /** Elevation from the OSM `ele` tag in metres, or null when absent/unparseable. */
  eleM: number | null;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// The public Overpass instances are frequently overloaded (504/429) or briefly
// hang, so we retry. The primary is tried twice first (its failures are usually
// transient), then each fallback once — a fallback being unreachable must not sink
// the feature or add much latency.
const ATTEMPT_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const FETCH_TIMEOUT_MS = 12000; // a legit response for our bbox returns in ~3 s

/**
 * Map an Overpass JSON response to named peaks. Only nodes carrying a non-empty
 * `name` tag are kept (an unnamed peak can't be labelled). The `ele` tag is
 * free-form text in OSM ("4808", "4808 m", "4,808") — parse leniently, null on
 * failure. Malformed input yields an empty array rather than throwing.
 */
export function parseOverpassPeaks(data: unknown): OverpassPeak[] {
  if (!data || typeof data !== 'object') return [];
  const elements = (data as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];
  const peaks: OverpassPeak[] = [];
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const e = el as { lat?: unknown; lon?: unknown; tags?: Record<string, unknown> };
    const tags = e.tags;
    if (!tags || typeof tags !== 'object') continue;
    const name = tags.name;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
    let eleM: number | null = null;
    if (typeof tags.ele === 'string' || typeof tags.ele === 'number') {
      const parsed = parseFloat(String(tags.ele).replace(/,/g, ''));
      if (Number.isFinite(parsed)) eleM = parsed;
    }
    peaks.push({ name: name.trim(), lat: e.lat, lon: e.lon, eleM });
  }
  return peaks;
}

async function fetchFromMirror(
  http: HttpClient,
  url: string,
  query: string,
): Promise<OverpassPeak[]> {
  const res = await http({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MyAstroSky (astro horizon feature)',
    },
    body: `data=${encodeURIComponent(query)}`,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (res.status < 200 || res.status > 299) {
    throw new Error(`Overpass ${url} responded ${res.status}`);
  }
  return parseOverpassPeaks(JSON.parse(await res.text()));
}

const RETRY_BACKOFF_MS = 800;

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch named peaks inside a bounding box from Overpass, retrying across
 * {@link ATTEMPT_URLS} until one succeeds. Best-effort by contract: the caller
 * catches and treats a throw as "no summits" (the horizon must never fail over
 * missing peaks), so we only throw once every attempt has failed. A per-attempt
 * 12 s timeout applies; `sleep` waits between attempts.
 */
export async function fetchPeaks(
  http: HttpClient,
  bbox: BBox,
  sleep: (ms: number) => Promise<void> = sleepMs,
): Promise<OverpassPeak[]> {
  const query = `[out:json][timeout:30];node[natural=peak](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out;`;
  let lastErr: unknown = new Error('No Overpass endpoint configured');
  for (let i = 0; i < ATTEMPT_URLS.length; i++) {
    try {
      return await fetchFromMirror(http, ATTEMPT_URLS[i], query);
    } catch (err) {
      lastErr = err;
      if (i < ATTEMPT_URLS.length - 1) await sleep(RETRY_BACKOFF_MS);
    }
  }
  throw lastErr;
}
