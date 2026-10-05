/**
 * Identification of solar-system objects and transients in the field of a solved photo:
 * SkyBoT asteroids (IMCCE), TNS supernovae and the MPC comet elements. The requests go through
 * the `HttpClient` port; the TNS and comet caches and the TNS rate-limit state belong to the
 * service instance, and `now` is the clock they use.
 *
 * SkyBoT: https://ssp.imcce.fr/webservices/skybot/api/conesearch.php
 * TNS: https://www.wis-tns.org/search (anonymous cone search, about 2 queries a minute)
 * MPC: https://www.minorplanetcenter.net/iau/info/CometOrbitFormat.html
 */
import { DomainError } from '../domain/errors';
import type {
  CometElements,
  SkybotCandidate,
  SkybotSearchParams,
  TnsCandidate,
  TnsSearchParams,
} from '../domain/identify';
import type { HttpClient, HttpRequest, HttpResponse } from '../ports/http-client';

const SKYBOT_URL = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php';
const SKYBOT_TIMEOUT_MS = 20_000;

const TNS_SEARCH_URL = 'https://www.wis-tns.org/search';
const TNS_OBJECT_URL = 'https://www.wis-tns.org/object/';
const TNS_TIMEOUT_MS = 20_000;
const TNS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TNS_CACHE_MAX_ENTRIES = 200;

const MPC_COMET_ELS_URL = 'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt';
const MPC_TIMEOUT_MS = 30_000;
const COMET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** TNS answered 429: the anonymous cone search allows only a couple of queries a minute. */
export class TnsRateLimitError extends DomainError {
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null) {
    super('rateLimited', 'TNS rate limit reached', { code: 'TNS_RATE_LIMITED' });
    this.name = 'TnsRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface IdentifyServiceDeps {
  http: HttpClient;
  /** The clock, in milliseconds since the epoch; it dates the caches. */
  now: () => number;
}

export interface IdentifyService {
  /**
   * Known asteroids within the cone at the epoch. Throws `invalid` (INVALID_PARAMS) for a cone or
   * epoch out of range, `upstream` (SKYBOT_FAILED) when SkyBoT cannot be reached or answers badly.
   */
  searchAsteroids(params: SkybotSearchParams): Promise<SkybotCandidate[]>;
  /**
   * TNS transients discovered in the window, within the cone. Cached 6 h by snapped cone.
   * Throws `invalid` (INVALID_PARAMS), `rateLimited` (`TnsRateLimitError`, TNS_RATE_LIMITED) or
   * `upstream` (TNS_FAILED).
   */
  searchTransients(params: TnsSearchParams): Promise<TnsCandidate[]>;
  /**
   * The current MPC comet elements, cached 24 h; a stale cache is served when the MPC is down.
   * Throws `upstream` (COMET_ELEMENTS_FAILED) when nothing is cached and the MPC fails.
   */
  getCometElements(): Promise<CometElements[]>;
}

interface SkybotRawRow {
  Num?: number | string;
  Name?: string;
  'RA (hms)'?: string;
  'DEC (dms)'?: string;
  Class?: string;
  'VMag (mag)'?: number;
  'Err (arcsec)'?: number;
  'd (arcsec)'?: number;
  'dRA (arcsec/h)'?: number;
  'dDEC (arcsec/h)'?: number;
}

/** Parses "12 27 51.8342" (hours minutes seconds) into decimal degrees of RA. */
export function parseRaHms(hms: string): number {
  const [h, m, s] = hms.trim().split(/\s+/).map(Number);
  return (h + m / 60 + s / 3600) * 15;
}

/** Parses "+12 53 24.083" (signed degrees minutes seconds) into decimal degrees of Dec. */
export function parseDecDms(dms: string): number {
  const trimmed = dms.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const [d, m, s] = trimmed.replace(/^[+-]/, '').split(/\s+/).map(Number);
  return sign * (d + m / 60 + s / 3600);
}

function skybotNumOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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

function tnsNumOrNull(value: string | undefined): number | null {
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
      discoveryMag: tnsNumOrNull(col(row, 'Discovery Mag/Flux')),
      hostName: strOrNull(col(row, 'Host Name')),
      redshift: tnsNumOrNull(col(row, 'Redshift')),
      tnsUrl: `${TNS_OBJECT_URL}${encodeURIComponent(objName)}`,
    });
  }
  return candidates;
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

/** Gregorian calendar date (fractional day) → Julian Date (Meeus, ch. 7). */
export function calendarToJd(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** "C/2025 R2 (SWAN)" → "C/2025 R2"; "10P/Tempel" → "10P"; "73P-B/Schwassmann-Wachmann" → "73P-B". */
export function designationFromName(name: string): string {
  const numbered = /^(\d+[PDI](?:-[A-Z]+)?)\//.exec(name);
  if (numbered) return numbered[1];
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}

function num(line: string, start: number, end: number): number | null {
  const raw = line.slice(start, end).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parses MPC's fixed-width `CometEls.txt` (one comet per line; malformed lines are skipped). */
export function parseCometEls(text: string): CometElements[] {
  const comets: CometElements[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 158) continue;
    const name = line.slice(102, 158).trim();
    const year = num(line, 14, 18);
    const month = num(line, 19, 21);
    const day = num(line, 22, 29);
    const q = num(line, 30, 39);
    const e = num(line, 41, 49);
    const peri = num(line, 51, 59);
    const node = num(line, 61, 69);
    const incl = num(line, 71, 79);
    if (
      !name ||
      year === null ||
      month === null ||
      day === null ||
      q === null ||
      q <= 0 ||
      e === null ||
      e < 0 ||
      peri === null ||
      node === null ||
      incl === null
    ) {
      continue;
    }
    comets.push({
      designation: designationFromName(name),
      name,
      tpJd: calendarToJd(year, month, day),
      q,
      e,
      peri,
      node,
      incl,
      h: num(line, 91, 95),
      k: num(line, 96, 100),
    });
  }
  return comets;
}

function invalidParams(message: string): DomainError {
  return new DomainError('invalid', message, { code: 'INVALID_PARAMS' });
}

function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** The cone checks every search shares: `true` when the centre and radius are in range. */
function coneInRange(raDeg: number, decDeg: number, radiusArcmin: number): boolean {
  return (
    Number.isFinite(raDeg) &&
    raDeg >= 0 &&
    raDeg <= 360 &&
    Number.isFinite(decDeg) &&
    decDeg >= -90 &&
    decDeg <= 90 &&
    Number.isFinite(radiusArcmin) &&
    radiusArcmin > 0 &&
    radiusArcmin <= 60
  );
}

function upstream(code: string, message: string, cause?: unknown): DomainError {
  const err = new DomainError('upstream', message, { code });
  if (cause !== undefined) err.cause = cause;
  return err;
}

async function request(
  http: HttpClient,
  code: string,
  label: string,
  req: HttpRequest,
): Promise<HttpResponse> {
  try {
    return await http(req);
  } catch (err) {
    throw upstream(code, `${label} request failed: ${(err as Error).message}`, err);
  }
}

const isOk = (res: HttpResponse): boolean => res.status >= 200 && res.status < 300;

export function createIdentifyService(deps: IdentifyServiceDeps): IdentifyService {
  const { http, now } = deps;
  const tnsCache = new Map<string, { at: number; candidates: TnsCandidate[] }>();
  let cometCache: { at: number; comets: CometElements[] } | null = null;

  async function searchAsteroids(params: SkybotSearchParams): Promise<SkybotCandidate[]> {
    const { raDeg, decDeg, radiusArcmin, epochJd, location = '500' } = params;
    if (!coneInRange(raDeg, decDeg, radiusArcmin) || !Number.isFinite(epochJd) || epochJd <= 0) {
      throw invalidParams('Invalid SkyBoT search parameters');
    }

    // Restricted to asteroids (-objFilter=100): broader filters currently trip a
    // satellite-ephemeris bug on IMCCE's side (Flag: -1, "calceph_compute_unit error #0").
    const query = new URLSearchParams({
      '-ra': String(raDeg),
      '-dec': String(decDeg),
      '-rd': String(radiusArcmin),
      '-ep': String(epochJd),
      '-mime': 'json',
      '-output': 'obs',
      '-loc': location,
      '-filter': '0',
      '-objFilter': '100',
      '-from': 'MyAstroSky',
    });

    const res = await request(http, 'SKYBOT_FAILED', 'SkyBoT', {
      method: 'GET',
      url: `${SKYBOT_URL}?${query.toString()}`,
      timeoutMs: SKYBOT_TIMEOUT_MS,
    });
    const text = await res.text();
    if (!isOk(res)) {
      throw upstream(
        'SKYBOT_FAILED',
        `SkyBoT request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    // IMCCE reports errors as a "# Flag: -1" comment header, still with a 200
    // status and a text (not JSON) body even though -mime=json was requested —
    // never hand that to JSON.parse.
    const trimmed = text.trim();
    if (trimmed.startsWith('#')) {
      const messageLine = trimmed.split('\n').pop() || trimmed;
      throw upstream('SKYBOT_FAILED', `SkyBoT error: ${messageLine.trim()}`);
    }
    if (trimmed === '') return [];

    let rows: SkybotRawRow[];
    try {
      rows = JSON.parse(trimmed);
    } catch (err) {
      throw upstream(
        'SKYBOT_FAILED',
        `SkyBoT returned an unexpected response: ${(err as Error).message}`,
        err,
      );
    }
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((row) => row['RA (hms)'] && row['DEC (dms)'])
      .map((row) => ({
        number: row.Num != null ? String(row.Num) : null,
        name: row.Name ?? '',
        raDeg: parseRaHms(row['RA (hms)']!),
        decDeg: parseDecDms(row['DEC (dms)']!),
        className: row.Class ?? '',
        vMag: skybotNumOrNull(row['VMag (mag)']),
        ephemErrArcsec: skybotNumOrNull(row['Err (arcsec)']),
        distArcsec: skybotNumOrNull(row['d (arcsec)']),
        dRaArcsecPerHour: skybotNumOrNull(row['dRA (arcsec/h)']),
        dDecArcsecPerHour: skybotNumOrNull(row['dDEC (arcsec/h)']),
      }));
  }

  async function searchTransients(requested: TnsSearchParams): Promise<TnsCandidate[]> {
    const { raDeg, decDeg, radiusArcmin, dateStart, dateEnd } = requested;
    if (
      !coneInRange(raDeg, decDeg, radiusArcmin) ||
      typeof dateStart !== 'string' ||
      typeof dateEnd !== 'string' ||
      !isDay(dateStart) ||
      !isDay(dateEnd) ||
      dateStart > dateEnd
    ) {
      throw invalidParams('Invalid TNS search parameters');
    }

    const params = snapCone(requested);
    const key = cacheKey(params);
    const hit = tnsCache.get(key);
    if (hit && now() - hit.at < TNS_CACHE_TTL_MS) return hit.candidates;

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

    const res = await request(http, 'TNS_FAILED', 'TNS', {
      method: 'GET',
      url: `${TNS_SEARCH_URL}?${query.toString()}`,
      headers: { 'User-Agent': 'MyAstroSky' },
      timeoutMs: TNS_TIMEOUT_MS,
    });
    const text = await res.text();
    if (res.status === 429) {
      const reset = Number(res.headers['x-cone-rate-limit-reset'] ?? res.headers['retry-after']);
      throw new TnsRateLimitError(Number.isFinite(reset) && reset > 0 ? reset : null);
    }
    if (!isOk(res)) {
      throw upstream('TNS_FAILED', `TNS request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const trimmed = text.trim();
    // A 200 with an HTML page or a JSON error object means TNS did not honour the
    // CSV export (maintenance, changed parameters…) — never parse that as data.
    if (trimmed.startsWith('<') || trimmed.startsWith('{')) {
      throw upstream('TNS_FAILED', `TNS returned an unexpected response: ${trimmed.slice(0, 200)}`);
    }

    const candidates = trimmed === '' ? [] : parseTnsCsv(trimmed);
    if (tnsCache.size >= TNS_CACHE_MAX_ENTRIES) {
      const oldest = tnsCache.keys().next().value;
      if (oldest !== undefined) tnsCache.delete(oldest);
    }
    tnsCache.set(key, { at: now(), candidates });
    return candidates;
  }

  async function getCometElements(): Promise<CometElements[]> {
    if (cometCache && now() - cometCache.at < COMET_CACHE_TTL_MS) return cometCache.comets;

    try {
      const res = await request(http, 'COMET_ELEMENTS_FAILED', 'MPC', {
        method: 'GET',
        url: MPC_COMET_ELS_URL,
        headers: { 'User-Agent': 'MyAstroSky' },
        timeoutMs: MPC_TIMEOUT_MS,
      });
      const text = await res.text();
      if (!isOk(res)) {
        throw upstream(
          'COMET_ELEMENTS_FAILED',
          `MPC request failed (${res.status}): ${text.slice(0, 200)}`,
        );
      }
      const comets = parseCometEls(text);
      if (comets.length === 0) {
        throw upstream(
          'COMET_ELEMENTS_FAILED',
          `MPC returned no comet elements: ${text.trim().slice(0, 200)}`,
        );
      }
      cometCache = { at: now(), comets };
      return comets;
    } catch (err) {
      // An ageing orbit beats no identification at all.
      if (cometCache) return cometCache.comets;
      throw err;
    }
  }

  return { searchAsteroids, searchTransients, getCometElements };
}
