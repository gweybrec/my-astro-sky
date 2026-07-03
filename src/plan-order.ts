import { twilightWindow } from './astro-time';
import { maxAltDuringWindow } from './sky-geometry';
import type { ObserverLocation } from './target-recommender';

/**
 * Shared transit ordering for plan entries, so the FOV-frames manager lists a
 * plan's frames in the exact same order as the "Targets & Plan" tab (earliest
 * culmination first). Mirrors TargetsView.computePlanTargets' sort and
 * nightWindow fallback.
 */

const PREFS_KEY = 'targets-prefs-v3';

export interface ObserverPrefs {
  lat: number | null;
  lon: number | null;
  lastDateISO: string | null;
}

/** Observer location + last-used date from the Targets prefs (localStorage). */
export function readObserverPrefs(): ObserverPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { lat: p.lat ?? null, lon: p.lon ?? null, lastDateISO: p.lastDateISO ?? null };
    }
  } catch {
    /* ignore */
  }
  return { lat: null, lon: null, lastDateISO: null };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dark-sky window for the night (mirrors TargetsView.nightWindow). */
export function nightWindowFor(loc: ObserverLocation, dateNight: Date): { start: Date; end: Date } {
  const tw = twilightWindow(dateNight, loc.latDeg, loc.lonDeg);
  if (tw) return { start: tw.start, end: tw.end };
  return {
    start: new Date(
      Date.UTC(
        dateNight.getUTCFullYear(),
        dateNight.getUTCMonth(),
        dateNight.getUTCDate(),
        20,
        0,
        0,
      ),
    ),
    end: new Date(
      Date.UTC(
        dateNight.getUTCFullYear(),
        dateNight.getUTCMonth(),
        dateNight.getUTCDate() + 1,
        6,
        0,
        0,
      ),
    ),
  };
}

export interface OrderableEntry {
  id: string;
  ra: number;
  dec: number;
}

/**
 * Order plan entries by transit time (earliest culmination first), using the
 * Targets prefs for location and the given plan date. Falls back to the input
 * order when no valid observer location is configured.
 *
 * @param nightOf the plan's observation night (ISO `YYYY-MM-DD`) or null
 * @returns the entry ids in display order
 */
export function orderPlanEntryIds(entries: OrderableEntry[], nightOf: string | null): string[] {
  const prefs = readObserverPrefs();
  if (
    prefs.lat == null ||
    prefs.lon == null ||
    prefs.lat < -90 ||
    prefs.lat > 90 ||
    prefs.lon < -180 ||
    prefs.lon > 180
  ) {
    return entries.map((e) => e.id);
  }
  const loc: ObserverLocation = { latDeg: prefs.lat, lonDeg: prefs.lon };
  const dateStr = nightOf ?? prefs.lastDateISO ?? todayISO();
  const dateNight = new Date(dateStr + 'T12:00:00Z');
  const win = nightWindowFor(loc, dateNight);
  return entries
    .map((e) => ({
      id: e.id,
      t: maxAltDuringWindow(
        e.ra,
        e.dec,
        loc.latDeg,
        loc.lonDeg,
        win.start,
        win.end,
        10,
      ).atDate.getTime(),
    }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.id);
}
