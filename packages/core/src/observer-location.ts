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

/** A position from the phone, rounded to 2 decimals as the desktop's "use my location" does. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "48.58, 7.75", or an empty string when no location is set. */
export function formatLatLon(loc: ObserverLatLon): string {
  return loc.lat === null || loc.lon === null ? '' : `${loc.lat}, ${loc.lon}`;
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

/**
 * The observer's location: the Targets tab's saved one, else the sky map's. The desktop keeps the two apart; the
 * phone has one location and writes both (`writeObserverLocation`).
 */
export function readObserverLocation(): ObserverLatLon {
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
