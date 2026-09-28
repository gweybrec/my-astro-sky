/**
 * Cached proxy over the Minor Planet Center's current comet orbital elements —
 * used to identify comets in the field of a solved photo. The client propagates
 * these elements itself (`src/comet-ephemeris.ts`), so a date edit in the
 * identification modal needs no further request.
 *
 * Neither IMCCE SkyBoT (intermittent crashes, stale comet orbits) nor JPL's
 * sb_ident field search (missed well-known comets) proved reliable for comets.
 * MPC's file only lists comets with current orbits: long-gone comets (e.g.
 * C/2020 F3 NEOWISE) are absent, and positions degrade far from the elements' epoch.
 *
 * https://www.minorplanetcenter.net/iau/info/CometOrbitFormat.html
 */

const MPC_COMET_ELS_URL = 'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt';
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CometElements {
  /** Short designation, e.g. "10P", "C/2025 R2", "73P-B". */
  designation: string;
  /** Designation + name as published by the MPC, e.g. "C/2025 R2 (SWAN)", "10P/Tempel". */
  name: string;
  /** Perihelion time, Julian Date (TT). */
  tpJd: number;
  /** Perihelion distance (AU). */
  q: number;
  e: number;
  /** Argument of perihelion, longitude of ascending node, inclination — degrees, J2000 ecliptic. */
  peri: number;
  node: number;
  incl: number;
  /** Absolute total magnitude M1 and slope parameter K1 (MPC's "H" and "G" columns). */
  h: number | null;
  k: number | null;
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

let cache: { at: number; comets: CometElements[] } | null = null;

/** Test hook — drop the cached elements. */
export function clearCometCache(): void {
  cache = null;
}

/**
 * Current MPC comet elements, cached for a day. When the MPC is unreachable a
 * stale cache is still served (an ageing orbit beats no identification at all).
 */
export async function fetchCometElements(): Promise<CometElements[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.comets;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(MPC_COMET_ELS_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MyAstroSky' },
      });
    } catch (err) {
      throw new Error(`MPC request failed: ${(err as Error).message}`, { cause: err });
    } finally {
      clearTimeout(timeout);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MPC request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const comets = parseCometEls(text);
    if (comets.length === 0) {
      throw new Error(`MPC returned no comet elements: ${text.trim().slice(0, 200)}`);
    }
    cache = { at: Date.now(), comets };
    return comets;
  } catch (err) {
    if (cache) return cache.comets;
    throw err;
  }
}
