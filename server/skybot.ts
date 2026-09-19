/**
 * Thin proxy over IMCCE's SkyBoT cone-search web service — used to identify a
 * solar-system object (asteroid) marked by the user on a solved photo.
 *
 * https://ssp.imcce.fr/webservices/skybot/api/conesearch.php
 */

const SKYBOT_URL = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php';
const FETCH_TIMEOUT_MS = 20_000;

export interface SkybotCandidate {
  number: string | null;
  name: string;
  raDeg: number;
  decDeg: number;
  className: string;
  vMag: number | null;
  ephemErrArcsec: number | null;
  distArcsec: number | null;
  dRaArcsecPerHour: number | null;
  dDecArcsecPerHour: number | null;
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

function numOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Queries SkyBoT for known solar-system objects within `radiusArcmin` of
 * (raDeg, decDeg) at the given Julian Date epoch. Restricted to asteroids
 * (-objFilter=100): broader filters currently trip a satellite-ephemeris bug
 * on IMCCE's side (Flag: -1, "calceph_compute_unit error #0").
 */
export async function skybotConesearch(opts: {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  epochJd: number;
  location?: string;
}): Promise<SkybotCandidate[]> {
  const { raDeg, decDeg, radiusArcmin, epochJd, location = '500' } = opts;

  const params = new URLSearchParams({
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${SKYBOT_URL}?${params.toString()}`, { signal: controller.signal });
  } catch (err) {
    throw new Error(`SkyBoT request failed: ${(err as Error).message}`, { cause: err });
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SkyBoT request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  // IMCCE reports errors as a "# Flag: -1" comment header, still with a 200
  // status and a text (not JSON) body even though -mime=json was requested —
  // never hand that to JSON.parse.
  const trimmed = text.trim();
  if (trimmed.startsWith('#')) {
    const messageLine = trimmed.split('\n').pop() || trimmed;
    throw new Error(`SkyBoT error: ${messageLine.trim()}`);
  }
  if (trimmed === '') return [];

  let rows: SkybotRawRow[];
  try {
    rows = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`SkyBoT returned an unexpected response: ${(err as Error).message}`, {
      cause: err,
    });
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
      vMag: numOrNull(row['VMag (mag)']),
      ephemErrArcsec: numOrNull(row['Err (arcsec)']),
      distArcsec: numOrNull(row['d (arcsec)']),
      dRaArcsecPerHour: numOrNull(row['dRA (arcsec/h)']),
      dDecArcsecPerHour: numOrNull(row['dDEC (arcsec/h)']),
    }));
}
