/**
 * The selected object's path across the local-sky dome, for the night currently
 * being simulated.
 *
 * Pure logic (no canvas): sampling + hour markers only, so it can be unit-tested.
 * The drawing lives in sky-frame-render.ts (`renderTrajectory`).
 *
 * The window is anchored to **local noon → next local noon** rather than to a rolling
 * span around the simulated instant. That is the astronomer's day boundary (one whole
 * night sits inside it, never split), it covers a full rise→set arc, and — crucially —
 * it only changes once per simulated day, so the sampled curve can be memoised across
 * the twice-a-second clock ticks and every pan/zoom frame that rebuild the scene.
 */
import type { AltSample } from './sky-geometry';
import { altAzFromRaDec, sampleAltCurve } from './sky-geometry';
import { dateToJD, lstHours } from './astro-time';
import { t } from './i18n';

/** Sampling step along the arc, in minutes (~720 points over a day — smooth on the dome). */
const SAMPLE_STEP_MIN = 2;

/** Hours between labelled markers. 2 divides evenly into the noon anchor, so every
 *  marker lands on an even local hour. */
const MARKER_HOUR_STEP = 2;

/** Markers below this altitude are dropped: at alt 0 the label would be clipped by the
 *  border ring (which *is* the horizon in the zenith projection). */
const MARKER_MIN_ALT_DEG = 1;

/** A labelled point on the arc — the object's position at a round local hour. */
export interface TrajectoryMarker {
  time: Date;
  altDeg: number;
  /** Azimuth in degrees, clockwise from North (0 = N, 90 = E). */
  azDeg: number;
  /** Localised hour label, e.g. "22h" (fr) or "22:00" (en). */
  label: string;
}

/** One object's night: the sampled arc plus its hour markers. */
export interface Trajectory {
  /** Every sample in the window, **including below-horizon ones** — the draw pass
   *  pen-lifts on those, which is what keeps the horizon crossings in the right place. */
  samples: AltSample[];
  markers: TrajectoryMarker[];
}

/**
 * Local noon of the day that "owns" `simDate`, through the next local noon.
 * An instant before noon belongs to the previous night, so it anchors to the
 * *previous* day's noon.
 *
 * The end is computed as a local date (not `start + 24h` in ms) so a DST boundary
 * inside the window shifts the span rather than sliding every marker off the hour.
 */
export function trajectoryWindow(simDate: Date): { start: Date; end: Date } {
  const start = new Date(simDate);
  if (start.getHours() < 12) start.setDate(start.getDate() - 1);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** The object's position at every `MARKER_HOUR_STEP`-th local hour it is up. */
function computeMarkers(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  start: Date,
  end: Date,
): TrajectoryMarker[] {
  const markers: TrajectoryMarker[] = [];
  const endMs = end.getTime();
  // Each cursor is derived from `start` rather than advanced in place, so a DST jump
  // can't accumulate drift across the window.
  for (let i = 0; ; i++) {
    const time = new Date(start);
    time.setHours(start.getHours() + i * MARKER_HOUR_STEP);
    if (time.getTime() >= endMs) break;
    const { altDeg, azDeg } = altAzFromRaDec(
      raDeg,
      decDeg,
      lstHours(dateToJD(time), lonDeg),
      latDeg,
    );
    if (altDeg <= MARKER_MIN_ALT_DEG) continue;
    markers.push({
      time,
      altDeg,
      azDeg,
      label: t('skyTime.trajectoryHour', { h: String(time.getHours()).padStart(2, '0') }),
    });
  }
  return markers;
}

// Size-1 memo: buildScene() runs on every frame, but the inputs only change when the
// selection, the observer or the simulated *day* changes.
let memoKey = '';
let memoValue: Trajectory | null = null;

/** Drops the memo — for tests, and for anything that invalidates the cached night. */
export function resetTrajectoryCache(): void {
  memoKey = '';
  memoValue = null;
}

/**
 * The object's arc + hour markers for the night containing `simDate`.
 * Repeated calls with unchanged inputs return the very same object.
 */
export function computeTrajectory(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  simDate: Date,
): Trajectory {
  const { start, end } = trajectoryWindow(simDate);
  const key = `${raDeg}|${decDeg}|${latDeg}|${lonDeg}|${start.getTime()}`;
  if (memoValue && key === memoKey) return memoValue;

  memoKey = key;
  memoValue = {
    samples: sampleAltCurve(raDeg, decDeg, latDeg, lonDeg, start, end, SAMPLE_STEP_MIN),
    markers: computeMarkers(raDeg, decDeg, latDeg, lonDeg, start, end),
  };
  return memoValue;
}
