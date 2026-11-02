import { storage } from './platform/storage';
import { loadSkyTimeSettings, saveSkyTimeSettings } from './sky-time-settings';

/** The storage key of the Targets tab's preferences, which hold the observer's location among other fields. */
export const TARGETS_PREFS_KEY = 'targets-prefs-v3';

export interface ObserverLatLon {
  lat: number | null;
  lon: number | null;
}

/** A latitude in [-90, 90] and a longitude in [-180, 180], as the Targets tab accepts them. */
export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** A coordinate typed in a field: a decimal number (a comma is accepted as the separator), or null when empty or not a number. */
export function parseCoordinate(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** A latitude or longitude as typed in degrees, minutes and seconds fields. */
export interface DmsFields {
  degrees: string;
  minutes: string;
  seconds: string;
}

/**
 * A coordinate in degrees, minutes and whole seconds, seconds and minutes carried at 60. The sign is on the degrees,
 * "-0" included, so a value between 0 and -1 (just west of Greenwich, just south of the equator) keeps it.
 */
export function formatDms(value: number): DmsFields {
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round(((abs - d) * 60 - m) * 60);
  if (s >= 60) {
    s = 0;
    m++;
  }
  if (m >= 60) {
    m = 0;
    d++;
  }
  const negative = value < 0 && d + m + s > 0;
  return { degrees: `${negative ? '-' : ''}${d}`, minutes: String(m), seconds: String(s) };
}

/**
 * Degrees, minutes and seconds typed in fields, in decimal degrees: null when the degrees are empty or not a number,
 * or when minutes or seconds are not in [0, 60). Empty minutes and seconds count as 0; a minus sign on the degrees
 * ("-0" included) makes the whole value negative. The range of the result is checked by {@link isValidLatLon}.
 */
export function parseDms(fields: DmsFields): number | null {
  const degreesText = fields.degrees.trim().replace('−', '-');
  const d = parseCoordinate(degreesText);
  const m = fields.minutes.trim() === '' ? 0 : parseCoordinate(fields.minutes);
  const s = fields.seconds.trim() === '' ? 0 : parseCoordinate(fields.seconds);
  if (d === null || m === null || s === null) return null;
  if (m < 0 || m >= 60 || s < 0 || s >= 60) return null;
  const sign = degreesText.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}

/** A coordinate rounded to 2 decimals (about 1 km), as the desktop's "use my location" does. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The location as every screen and calculation gets it: rounded to 2 decimals. A position typed in degrees, minutes and
 * seconds is stored exact (0.01° is 36″), so the reads below all go through this one rounding.
 */
function rounded(loc: ObserverLatLon): ObserverLatLon {
  return {
    lat: loc.lat === null ? null : roundCoordinate(loc.lat),
    lon: loc.lon === null ? null : roundCoordinate(loc.lon),
  };
}

/** "48.58, 7.75" (rounded to 2 decimals), or an empty string when no location is set. */
export function formatLatLon(loc: ObserverLatLon): string {
  const { lat, lon } = rounded(loc);
  return lat === null || lon === null ? '' : `${lat}, ${lon}`;
}

function readTargetsPrefs(): Record<string, unknown> | null {
  try {
    const raw = storage().get(TARGETS_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** The location in the Targets preferences alone, rounded to 2 decimals (null fields when there are none). */
export function readTargetsLocation(): ObserverLatLon {
  const prefs = readTargetsPrefs();
  return rounded({
    lat: (prefs?.lat as number | undefined) ?? null,
    lon: (prefs?.lon as number | undefined) ?? null,
  });
}

/**
 * The observer's location, rounded to 2 decimals: the Targets tab's saved one, else the sky map's. The desktop keeps
 * the two apart; the phone has one location and writes both (`writeObserverLocation`).
 */
export function readObserverLocation(): ObserverLatLon {
  return rounded(readExactObserverLocation());
}

/** The observer's location as stored, for the degrees, minutes and seconds fields only (their seconds are kept). */
export function readExactObserverLocation(): ObserverLatLon {
  const prefs = readTargetsPrefs();
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const fromTargets = { lat: num(prefs?.lat), lon: num(prefs?.lon) };
  if (fromTargets.lat !== null || fromTargets.lon !== null) return fromTargets;
  const sky = loadSkyTimeSettings();
  return { lat: sky.lat, lon: sky.lon };
}

/**
 * Stores the location under the keys the desktop reads: the Targets preferences (the other fields are kept; a
 * missing `setupId` is added because the desktop ignores preferences without it) and the sky map's settings
 * (where leaving the location empty also turns the local-sky view off, as the desktop does).
 */
export function writeObserverLocation(lat: number | null, lon: number | null): void {
  const prefs = readTargetsPrefs() ?? { setupId: null, lastDateISO: null };
  if (!('setupId' in prefs)) prefs.setupId = null;
  prefs.lat = lat;
  prefs.lon = lon;
  storage().set(TARGETS_PREFS_KEY, JSON.stringify(prefs));

  const sky = loadSkyTimeSettings();
  sky.lat = lat;
  sky.lon = lon;
  if ((lat === null || lon === null) && sky.localSkyMode) sky.localSkyMode = false;
  saveSkyTimeSettings(sky);
}
