import { twilightWindow, dateToJD, moonRaDecDeg } from '../astro-time';
import { angularSeparationDeg, sampleMoonAltCurve } from '../sky-geometry';
import type { ObserverLocation } from '../target-recommender';
import { todayISO } from './format';

/** Dark-sky window for the night (mirrors recommendTargets fallback). */
export function nightWindow(loc: ObserverLocation, dateNight: Date): { start: Date; end: Date } {
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

/**
 * User-configured observation window (`obsStartTime`/`obsEndTime`, HH:MM in the
 * device's local time) for the given night, or null if not set — both fields
 * must be filled in for the window to be active.
 *
 * "Night of `dateStr`" spans that evening through the following morning, so a
 * pre-noon clock time (e.g. "01:00") is anchored to the calendar day *after*
 * `dateStr`, while a PM/noon time is anchored to `dateStr` itself — matching
 * dusk (evening of `dateStr`) / dawn (morning of `dateStr`+1) from
 * `twilightWindow`. Without this, "01:00" would resolve to the night before
 * the one actually being searched.
 */
export function timeWindowFor(
  dateStr: string,
  startStr: string | null | undefined,
  endStr: string | null | undefined,
): { start: Date; end: Date } | null {
  if (!startStr || !endStr) return null;
  const anchor = (hhmm: string): Date => {
    const d = new Date(`${dateStr}T${hhmm}:00`);
    if (parseInt(hhmm.slice(0, 2), 10) < 12) d.setDate(d.getDate() + 1);
    return d;
  };
  const start = anchor(startStr);
  let end = anchor(endStr);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** Moon–target angular separation (°) at a given UTC instant. */
export function moonSeparationAt(raDeg: number, decDeg: number, at: Date): number {
  const { raDeg: moonRa, decDeg: moonDec } = moonRaDecDeg(dateToJD(at));
  return angularSeparationDeg(raDeg, decDeg, moonRa, moonDec);
}

/** The Moon's rises and sets inside a window, from its sampled altitude curve. */
export function moonEventsInWindow(
  loc: ObserverLocation,
  win: { start: Date; end: Date },
): { type: 'rise' | 'set'; time: Date }[] {
  const curve = sampleMoonAltCurve(loc.latDeg, loc.lonDeg, win.start, win.end, 5);
  const events: { type: 'rise' | 'set'; time: Date }[] = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1],
      b = curve[i];
    if (a.altDeg < 0 === b.altDeg < 0) continue; // no horizon crossing
    const frac = a.altDeg / (a.altDeg - b.altDeg); // linear interp to alt = 0
    const tMs = a.time.getTime() + frac * (b.time.getTime() - a.time.getTime());
    events.push({ type: b.altDeg >= a.altDeg ? 'rise' : 'set', time: new Date(tMs) });
  }
  return events;
}

/**
 * Where and when a plan is observed: its own location, else the global one (the Targets preferences); its own night,
 * else the global date, else today. Null when no valid location is known.
 */
export function getPlanObserverFor(
  plan: { lat?: number | null; lon?: number | null; nightOf?: string | null },
  prefs: { lat: number | null; lon: number | null; lastDateISO: string | null },
): { loc: ObserverLocation; dateNight: Date } | null {
  const lat = plan.lat ?? prefs.lat;
  const lon = plan.lon ?? prefs.lon;
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const dateStr = plan.nightOf ?? prefs.lastDateISO ?? todayISO();
  return { loc: { latDeg: lat, lonDeg: lon }, dateNight: new Date(dateStr + 'T12:00:00Z') };
}
