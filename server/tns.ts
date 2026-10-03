/**
 * Thin proxy over the IAU Transient Name Server (TNS) public cone search — used
 * to identify supernovae (and other transients) in the field of a solved photo.
 *
 * The public search page exports CSV without an API key, but is rate-limited
 * hard (x-cone-rate-limit-limit: 2 per 60 s), so results are cached in memory.
 *
 * https://www.wis-tns.org/search
 */

const TNS_SEARCH_URL = 'https://www.wis-tns.org/search';
const TNS_OBJECT_URL = 'https://www.wis-tns.org/object/';
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export interface TnsCandidate {
  /** Full TNS designation, e.g. "SN 2026aaiv" or "AT 2026abc". */
  name: string;
  raDeg: number;
  decDeg: number;
  /** Spectroscopic type ("SN Ia", "SN II"…) — null when unclassified. */
  type: string | null;
  /** True for a spectroscopically confirmed supernova ("SN" prefix). */
  classified: boolean;
  /** Discovery date as an ISO UTC string. */
  discoveryDate: string | null;
  discoveryMag: number | null;
  hostName: string | null;
  redshift: number | null;
  tnsUrl: string;
}

export interface TnsSearchParams {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  /** Discovery-date window, YYYY-MM-DD (inclusive). */
  dateStart: string;
  dateEnd: string;
}

/** TNS answered 429 — the anonymous cone search allows only a couple of queries a minute. */
export class TnsRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('TNS rate limit reached');
    this.name = 'TnsRateLimitError';
  }
}

/** Parses "22:37:05.628" (or space-separated) hours:minutes:seconds into degrees of RA. */
export function parseSexagesimalRa(hms: string): number {
  const [h, m, s] = hms
    .trim()
    .split(/[:\s]+/)
    .map(Number);
  return (h + m / 60 + s / 3600) * 15;
}

/** Parses "+34:24:35.19" (or space-separated) signed degrees:minutes:seconds into degrees. */
export function parseSexagesimalDec(dms: string): number {
  const trimmed = dms.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const [d, m, s] = trimmed
    .replace(/^[+-]/, '')
    .split(/[:\s]+/)
    .map(Number);
  return sign * (d + m / 60 + s / 3600);
}

/** Minimal RFC-4180 CSV parser: quoted fields may contain commas, "" escapes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function numOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "2026-09-01 11:23:32.352" (UT) → "2026-09-01T11:23:32.352Z". */
function tnsDateToIso(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const iso = `${trimmed.replace(' ', 'T')}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Maps the TNS search CSV export to candidates (rows without a position are dropped). */
export function parseTnsCsv(text: string): TnsCandidate[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (row: string[], name: string) => {
    const idx = header.indexOf(name);
    return idx >= 0 ? row[idx] : undefined;
  };

  const candidates: TnsCandidate[] = [];
  for (const row of rows.slice(1)) {
    const ra = col(row, 'RA');
    const dec = col(row, 'DEC');
    const name = col(row, 'Name')?.trim();
    if (!ra || !dec || !name) continue;
    const raDeg = parseSexagesimalRa(ra);
    const decDeg = parseSexagesimalDec(dec);
    if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) continue;

    const rawType = strOrNull(col(row, 'Obj. Type'));
    const classified = /^SN\s/.test(name);
    // The object page is keyed by the designation without its SN/AT prefix.
    const objName = name.replace(/^(SN|AT)\s+/, '');
    candidates.push({
      name,
      raDeg,
      decDeg,
      type: rawType && rawType !== 'NA/Unknown' && rawType !== 'Other' ? rawType : null,
      classified,
      discoveryDate: tnsDateToIso(col(row, 'Discovery Date (UT)')),
      discoveryMag: numOrNull(col(row, 'Discovery Mag/Flux')),
      hostName: strOrNull(col(row, 'Host Name')),
      redshift: numOrNull(col(row, 'Redshift')),
      tnsUrl: `${TNS_OBJECT_URL}${encodeURIComponent(objName)}`,
    });
  }
  return candidates;
}

const cache = new Map<string, { at: number; candidates: TnsCandidate[] }>();

/** Test hook — drop every cached search. */
export function clearTnsCache(): void {
  cache.clear();
}

/**
 * The cone actually sent to TNS (and used as the cache key): centre snapped to a
 * 0.01° grid and radius padded by the snap's worst-case offset (≤ 0.005° per axis,
 * i.e. under 0.5′), then rounded up to a whole arcminute. A photo's
 * computed centre jitters by a few arcseconds between opens (the photo→sky affine
 * is fitted in the sky map's current projection), so an exact key would miss the
 * cache — and TNS only allows ~2 anonymous cone searches a minute.
 */
export function snapCone(p: TnsSearchParams): TnsSearchParams {
  return {
    ...p,
    raDeg: Math.round(p.raDeg * 100) / 100,
    decDeg: Math.round(p.decDeg * 100) / 100,
    radiusArcmin: Math.min(60, Math.ceil(p.radiusArcmin + 0.9)),
  };
}

function cacheKey(p: TnsSearchParams): string {
  return [p.raDeg.toFixed(2), p.decDeg.toFixed(2), p.radiusArcmin, p.dateStart, p.dateEnd].join(
    '|',
  );
}

/**
 * Queries TNS for transients within `radiusArcmin` of (raDeg, decDeg) discovered
 * between `dateStart` and `dateEnd`. Both classified SNe and unclassified ATs
 * are returned — the caller decides how to present them.
 */
export async function tnsConesearch(requested: TnsSearchParams): Promise<TnsCandidate[]> {
  const params = snapCone(requested);
  const key = cacheKey(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.candidates;

  const query = new URLSearchParams({
    ra: String(params.raDeg),
    decl: String(params.decDeg),
    radius: String(params.radiusArcmin),
    coords_unit: 'arcmin',
    format: 'csv',
    num_page: '100',
    'date_start[date]': params.dateStart,
    'date_end[date]': params.dateEnd,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${TNS_SEARCH_URL}?${query.toString()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MyAstroSky' },
    });
  } catch (err) {
    throw new Error(`TNS request failed: ${(err as Error).message}`, { cause: err });
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  if (res.status === 429) {
    const reset = Number(
      res.headers.get('x-cone-rate-limit-reset') ?? res.headers.get('retry-after'),
    );
    throw new TnsRateLimitError(Number.isFinite(reset) && reset > 0 ? reset : null);
  }
  if (!res.ok) {
    throw new Error(`TNS request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const trimmed = text.trim();
  // A 200 with an HTML page or a JSON error object means TNS did not honour the
  // CSV export (maintenance, changed parameters…) — never parse that as data.
  if (trimmed.startsWith('<') || trimmed.startsWith('{')) {
    throw new Error(`TNS returned an unexpected response: ${trimmed.slice(0, 200)}`);
  }

  const candidates = trimmed === '' ? [] : parseTnsCsv(trimmed);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), candidates });
  return candidates;
}
