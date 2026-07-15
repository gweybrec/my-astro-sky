// OpenStreetMap Overpass client for named mountain summits (natural=peak).
//
// The DEM used to trace the horizon carries no place names, so summit labels come
// from OSM. The parser is a pure function kept out of the fetch wrapper so it can
// be unit-tested without the network (mirrors server/github-release.ts).

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
  url: string,
  query: string,
  signal?: AbortSignal,
): Promise<OverpassPeak[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MyAstroSky (astro horizon feature)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${url} responded ${res.status}`);
    return parseOverpassPeaks(await res.json());
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

const RETRY_BACKOFF_MS = 800;

/**
 * Fetch named peaks inside a bounding box from Overpass, retrying across
 * {@link ATTEMPT_URLS} until one succeeds. Best-effort by contract: the caller
 * catches and treats a throw as "no summits" (the horizon must never fail over
 * missing peaks), so we only throw once every attempt has failed. A per-attempt
 * 12 s timeout applies; the optional `signal` cancels the whole thing.
 */
export async function fetchPeaks(bbox: BBox, signal?: AbortSignal): Promise<OverpassPeak[]> {
  const query = `[out:json][timeout:30];node[natural=peak](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out;`;
  let lastErr: unknown = new Error('No Overpass endpoint configured');
  for (let i = 0; i < ATTEMPT_URLS.length; i++) {
    if (signal?.aborted) break;
    try {
      return await fetchFromMirror(ATTEMPT_URLS[i], query, signal);
    } catch (err) {
      lastErr = err;
      if (i < ATTEMPT_URLS.length - 1) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  throw lastErr;
}
