/**
 * Target recommender — selects and ranks DSOs for a given night, location
 * and gear preset.
 *
 * An object is kept when it spends at least an hour (or the whole window, when shorter) between the minimum and
 * maximum altitude: a peak above the maximum does not exclude it.
 *
 * Scoring (0-100):
 *   45% — altitude score   (by airmass: 0 at the minimum altitude, full from 50°)
 *   35% — FOV fit score    (best when object spans 15-70% of short FOV side; an object larger than the
 *                           frame, kept by `allowOversized`, scores lower the more mosaic panels it needs)
 *   20% — brightness score (margin below limiting magnitude; the difficulty when no magnitude is known)
 * The sum is then multiplied by the difficulty factor (×1 at 1/5 down to ×0.6 at 5/5, see {@link difficultyFactor})
 * and the rating factor (×1 at 5★ down to ×0.6 at 1★), so easier and finer targets rank above others placed as well; the rest stay
 * listed, lower. The list is ranked by score alone.
 */

import type { DSO } from './types';
import type { GearPreset } from './gear-presets';
import { fovDeg, limitingMag } from './gear-presets';
import { twilightWindow, dateToJD, lstHours } from './astro-time';
import { altitudeOverWindow, mightBeVisible, altAzFromRaDec } from './sky-geometry';
import { horizonAltAt, type HorizonProfile } from './horizon-io';
import { planGrid, smartMosaicEnvelope, type SmartMosaicEnvelope } from './mosaic';

export interface ObserverLocation {
  latDeg: number;
  lonDeg: number;
}

/**
 * Why a target is shown outside the user's criteria: it does not spend an hour between the minimum and maximum
 * altitude (too low: below the minimum or only briefly above it; too high: above the maximum most of that time), it
 * is larger than the frame, or it is already photographed.
 */
export type OutsideReason = 'too-low' | 'too-high' | 'too-big' | 'photographed';

export interface TargetSuggestion {
  dso: DSO;
  maxAltDeg: number;
  bestTimeUtc: Date;
  score: number;
  fovFitScore: number;
  altScore: number;
  brightnessScore: number;
  /** Set only on a target that misses the altitude, size or photographed criteria (see `RecommendOptions.keepOutside`). */
  outside?: OutsideReason[];
  /** Set on a target larger than a smart telescope's frame that its mosaic mode covers (see {@link needsSmartMosaic}). */
  needsMosaic?: true;
}

const MAX_RESULTS = 8;

/** Time an object must spend within the altitude range to be kept (minutes), or the whole window when shorter. */
export const MIN_MINUTES_IN_RANGE = 60;
/** Altitude from which the altitude score is full: above it, the air in the way barely changes. */
const FULL_ALT_SCORE_DEG = 50;

/** Largest mosaic (in panels) an object larger than the frame may need to be kept by `allowOversized`: a 3×3. */
export const MAX_OVERSIZE_PANELS = 9;
/** Overlap between mosaic panels when counting them (the mosaic form's default, `MOSAIC_DEFAULT_OVERLAP`). */
const OVERSIZE_OVERLAP_PCT = 20;
/** FOV fit of a target a smart telescope covers only in mosaic mode, against the mosaic area: a little below one that
 *  fits its frame, as the mosaic takes longer. */
const SMART_MOSAIC_FIT_FACTOR = 0.85;

/** Options of the recommendation (see {@link recommendTargets}). */
export interface RecommendOptions {
  /**
   * Keep objects larger than the frame when they fit in a mosaic of at most {@link MAX_OVERSIZE_PANELS} panels,
   * with a FOV-fit score that falls with the number of panels (larger ones stay out).
   */
  allowOversized?: boolean;
  minAltDeg?: number;
  maxAltDeg?: number;
  timeWindow?: { start: Date; end: Date };
  /** Terrain skyline: reject targets whose peak sits below the horizon in that
   *  direction ("how low not to go" made azimuth-dependent). */
  horizonProfile?: HorizonProfile | null;
  /**
   * Keep the objects that miss only the altitude range (while rising above the horizon) or the frame size, tagged
   * with `outside`, instead of leaving them out. `finish` ranks only the others.
   */
  keepOutside?: boolean;
}

/**
 * The recommendation in two steps so that a caller can score the objects a slice at a time and let the page breathe
 * between slices: `collect` scores objects (call it on consecutive slices of the pool, in order), `finish` ranks the
 * concatenated result. {@link recommendTargets} is both steps on the whole pool.
 */
export function createRecommender(
  preset: GearPreset,
  location: ObserverLocation,
  dateNight: Date,
  options: RecommendOptions = {},
): {
  collect: (dsos: DSO[]) => TargetSuggestion[];
  finish: (candidates: TargetSuggestion[], limit: number) => TargetSuggestion[];
} {
  const { latDeg, lonDeg } = location;
  const fov = fovDeg(preset);
  const magLimit = limitingMag(preset);
  const minFovDeg = Math.min(fov.wDeg, fov.hDeg);
  const maxFovDeg = Math.max(fov.wDeg, fov.hDeg);
  const minAlt = options.minAltDeg ?? 20;
  const maxAlt = options.maxAltDeg ?? 90;
  const mosaicArea = smartMosaicArea(preset);

  // Compute twilight window; if none (polar day), use a 12-hour fallback window
  const tw = twilightWindow(dateNight, latDeg, lonDeg);
  let windowStart: Date;
  let windowEnd: Date;
  if (tw) {
    windowStart = tw.start;
    windowEnd = tw.end;
  } else {
    // Fallback: 8pm to 6am UTC
    windowStart = new Date(
      Date.UTC(dateNight.getFullYear(), dateNight.getMonth(), dateNight.getDate(), 20, 0, 0),
    );
    windowEnd = new Date(
      Date.UTC(dateNight.getFullYear(), dateNight.getMonth(), dateNight.getDate() + 1, 6, 0, 0),
    );
  }

  // Multiple/double stars are quick visual targets, observable well into twilight, so
  // they get a wider "night" window (civil twilight, sun < −6°, falling back to sunset)
  // instead of the narrow astronomical-dark window used for deep-sky imaging — otherwise
  // few doubles qualify on short summer nights.
  const starTw = twilightWindow(dateNight, latDeg, lonDeg, [-6, 0]);
  let starStart = starTw ? starTw.start : windowStart;
  let starEnd = starTw ? starTw.end : windowEnd;

  // Narrow to the user's observation window, if any (intersection with the dark window).
  if (options.timeWindow) {
    windowStart = new Date(Math.max(windowStart.getTime(), options.timeWindow.start.getTime()));
    windowEnd = new Date(Math.min(windowEnd.getTime(), options.timeWindow.end.getTime()));
    starStart = new Date(Math.max(starStart.getTime(), options.timeWindow.start.getTime()));
    starEnd = new Date(Math.min(starEnd.getTime(), options.timeWindow.end.getTime()));
  }

  const collect = (dsos: DSO[]): TargetSuggestion[] => {
    const candidates: TargetSuggestion[] = [];

    for (const dso of dsos) {
      // Multiple/double stars are point-like synthetic targets: they have no angular size
      // and no FOV-fit, and are scored by altitude + their own (setup-aware) quality rating.
      const isMultipleStar = dso.type === 'MS';

      // Skip objects without angular size (can't compute FOV fit) — except point-like stars
      const majAxisArcmin = dso.majAxis;
      if (!isMultipleStar && !majAxisArcmin) continue;

      // Objects larger than the frame are left out unless the user asked for them ("Include objects larger than
      // FOV"), and even then when they would need more than a 3×3 mosaic: a low FOV-fit score alone would still
      // list them, only further down.
      // A smart telescope covers what its mosaic mode reaches: such a target is kept, marked `needsMosaic`.
      const outside: OutsideReason[] = [];
      const fitsFrame =
        isMultipleStar ||
        fitsInFrame(majAxisArcmin!, dso.minAxis, minFovDeg, maxFovDeg, fitTolerance(preset));
      const needsMosaic =
        !fitsFrame &&
        mosaicArea !== null &&
        fitsMosaicArea(
          majAxisArcmin!,
          dso.minAxis,
          mosaicArea,
          fov.wDeg,
          fov.hDeg,
          fitTolerance(preset),
        );
      const panels =
        fitsFrame || needsMosaic
          ? 1
          : oversizePanels(majAxisArcmin!, dso.minAxis, minFovDeg, maxFovDeg);
      if (panels > 1 && (!options.allowOversized || panels > MAX_OVERSIZE_PANELS)) {
        if (!options.keepOutside) continue;
        outside.push('too-big');
      }

      // Skip objects that are too faint
      if (dso.mag !== null && dso.mag > magLimit) continue;

      // Quick declination pre-filter (avoids expensive sampling)
      if (!mightBeVisible(dso.dec, latDeg, options.keepOutside ? 0 : minAlt)) continue;

      // Altitude over the observing window. Stars use the wider visual window and ignore
      // the upper altitude cap (overhead is ideal for splitting doubles; the cap only
      // exists to avoid meridian-flip trouble on tracked imaging).
      const effectiveMaxAlt = isMultipleStar ? 90 : maxAlt;
      const start = isMultipleStar ? starStart : windowStart;
      const end = isMultipleStar ? starEnd : windowEnd;
      const { maxAltDeg, atDate, minutesInRange } = altitudeOverWindow(
        dso.ra,
        dso.dec,
        latDeg,
        lonDeg,
        start,
        end,
        minAlt,
        effectiveMaxAlt,
        10,
      );

      // Kept when it spends an hour in the range (or the whole window, when shorter): an object peaking above the
      // maximum altitude is still fine for the hours it is below it.
      const windowMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
      // An empty window (the user's hours miss the night) leaves nothing observable.
      const required = windowMinutes > 0 ? Math.min(MIN_MINUTES_IN_RANGE, windowMinutes) : Infinity;
      if (minutesInRange < required) {
        if (!options.keepOutside || maxAltDeg <= 0) continue;
        outside.push(maxAltDeg > effectiveMaxAlt ? 'too-high' : 'too-low');
      }

      // Terrain horizon gate: reject targets that never clear the real skyline in
      // their direction. The peak-time azimuth is used as an MVP approximation — an
      // object hidden behind terrain even at culmination is definitely blocked.
      if (options.horizonProfile) {
        const lst = lstHours(dateToJD(atDate), lonDeg);
        const azDeg = altAzFromRaDec(dso.ra, dso.dec, lst, latDeg).azDeg;
        if (maxAltDeg < horizonAltAt(options.horizonProfile, azDeg)) continue;
      }

      // ─ Altitude score (0-1): by airmass, full from 50°, 0 at minAlt ─
      const altScore = altitudeScore(maxAltDeg, minAlt);

      // ─ FOV fit score (0-1) ─ (point-like stars are FOV-neutral)
      const fovFitScore = isMultipleStar
        ? 1.0
        : needsMosaic
          ? mosaicFit(majAxisArcmin!, dso.minAxis, mosaicArea!)
          : panels > 1
            ? oversizeFit(panels)
            : fovFit(majAxisArcmin!, dso.minAxis, minFovDeg, maxFovDeg);

      // ─ Brightness score (0-1) ─
      const brightnessScore = brightnessScoreFn(dso, magLimit);

      // Multiple stars: rank by altitude + their own quality rating (0★ = unresolvable by
      // the setup, which sinks them). Everything else: altitude + FOV fit + brightness.
      const score = isMultipleStar
        ? 0.5 * altScore + 0.5 * ((dso.rating ?? 0) / 5)
        : (0.45 * altScore + 0.35 * fovFitScore + 0.2 * brightnessScore) *
          difficultyFactor(dso) *
          ratingFactor(dso);

      candidates.push({
        dso,
        maxAltDeg,
        bestTimeUtc: atDate,
        score,
        fovFitScore,
        altScore,
        brightnessScore,
        ...(outside.length ? { outside } : {}),
        ...(needsMosaic ? { needsMosaic: true as const } : {}),
      });
    }
    return candidates;
  };

  const finish = (collected: TargetSuggestion[], limit: number): TargetSuggestion[] => {
    // Only the targets inside the criteria are ranked, by score alone: with rating and difficulty in the score the
    // top mixes object types by itself, where a per-type quota would pull weak objects above strong ones.
    const candidates = collected.filter((c) => !c.outside);
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  };

  return { collect, finish };
}

export function recommendTargets(
  dsos: DSO[],
  preset: GearPreset,
  location: ObserverLocation,
  dateNight: Date,
  limit = MAX_RESULTS,
  options: RecommendOptions = {},
): TargetSuggestion[] {
  const recommender = createRecommender(preset, location, dateNight, options);
  return recommender.finish(recommender.collect(dsos), limit);
}

/**
 * Score a single DSO against a gear preset, given its already-computed max
 * altitude for the night. Unlike {@link recommendTargets} this never filters
 * the object out — it is used for objects the user has explicitly added to a
 * plan, which may be faint or sizeless. Mirrors the scoring weights above.
 */
export function scoreDso(
  dso: DSO,
  preset: GearPreset,
  maxAltDeg: number,
  options: { allowOversized?: boolean; minAltDeg?: number } = {},
): {
  score: number;
  fovFitScore: number;
  altScore: number;
  brightnessScore: number;
  needsMosaic: boolean;
} {
  const fov = fovDeg(preset);
  const magLimit = limitingMag(preset);
  const minFovDeg = Math.min(fov.wDeg, fov.hDeg);
  const maxFovDeg = Math.max(fov.wDeg, fov.hDeg);
  const minAlt = options.minAltDeg ?? 20;

  const altScore = altitudeScore(maxAltDeg, minAlt);
  const needsMosaic = needsSmartMosaic(dso.majAxis, dso.minAxis, preset);
  let fovFitScore = 0;
  if (needsMosaic) {
    fovFitScore = mosaicFit(dso.majAxis!, dso.minAxis, smartMosaicArea(preset)!);
  } else if ((dso.majAxis ?? 0) > 0) {
    // Larger than the frame and allowed: scored by its mosaic panels, unless it needs more than a 3×3.
    const panels =
      options.allowOversized &&
      !fitsInFrame(dso.majAxis!, dso.minAxis, minFovDeg, maxFovDeg, fitTolerance(preset))
        ? oversizePanels(dso.majAxis!, dso.minAxis, minFovDeg, maxFovDeg)
        : 1;
    fovFitScore =
      panels > 1 && panels <= MAX_OVERSIZE_PANELS
        ? oversizeFit(panels)
        : fovFit(dso.majAxis!, dso.minAxis, minFovDeg, maxFovDeg);
  }
  const brightnessScore = brightnessScoreFn(dso, magLimit);
  const score =
    (0.45 * altScore + 0.35 * fovFitScore + 0.2 * brightnessScore) *
    difficultyFactor(dso) *
    ratingFactor(dso);
  return { score, fovFitScore, altScore, brightnessScore, needsMosaic };
}

/**
 * A smart telescope's mosaic area: its frame enlarged as far as its mosaic mode goes (the frame it resizes, not a grid
 * of panels), or null for a setup without a mosaic mode.
 */
export function smartMosaicArea(preset: GearPreset): SmartMosaicEnvelope | null {
  if (!preset.smartMosaic) return null;
  const fov = fovDeg(preset);
  return smartMosaicEnvelope(preset.smartMosaic, fov.wDeg, fov.hDeg);
}

/**
 * Whether an object is larger than a smart telescope's frame but within its mosaic area: the user will shoot it in
 * mosaic mode, sizing the frame to suit. False on a setup without a mosaic mode, or for an object that fits the frame
 * or exceeds the mosaic. Axes in arcminutes.
 */
export function needsSmartMosaic(
  majAxisArcmin: number | null,
  minAxisArcmin: number | null,
  preset: GearPreset,
): boolean {
  if (!majAxisArcmin) return false;
  const area = smartMosaicArea(preset);
  if (!area) return false;
  const fov = fovDeg(preset);
  const minFovDeg = Math.min(fov.wDeg, fov.hDeg);
  const maxFovDeg = Math.max(fov.wDeg, fov.hDeg);
  const tolerance = fitTolerance(preset);
  if (fitsInFrame(majAxisArcmin, minAxisArcmin, minFovDeg, maxFovDeg, tolerance)) return false;
  return fitsMosaicArea(majAxisArcmin, minAxisArcmin, area, fov.wDeg, fov.hDeg, tolerance);
}

/**
 * Whether a smart telescope's frame, enlarged in mosaic mode (never below its native size, each side within its
 * maximum and, for a Vaonis, the area within its cap), covers the object turned to its best angle, up to `tolerance`.
 */
function fitsMosaicArea(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  area: SmartMosaicEnvelope,
  nativeWDeg: number,
  nativeHDeg: number,
  tolerance: number,
): boolean {
  // Without an area cap the mosaic is just a larger frame.
  if (area.maxAreaDeg2 === undefined) {
    const sides = [area.maxWDeg, area.maxHDeg];
    return (
      frameFill(majAxisArcmin, minAxisArcmin, Math.min(...sides), Math.max(...sides)) <= tolerance
    );
  }
  const a = majAxisArcmin / 60;
  const b = (minAxisArcmin ?? majAxisArcmin) / 60;
  for (let deg = 0; deg <= 90; deg += FIT_ANGLE_STEP_DEG) {
    const [w, h] = ellipseBox(a, b, deg);
    const fw = Math.max(w / tolerance, nativeWDeg);
    const fh = Math.max(h / tolerance, nativeHDeg);
    if (
      fw <= area.maxWDeg &&
      fh <= area.maxHDeg &&
      (area.maxAreaDeg2 === undefined || fw * fh <= area.maxAreaDeg2)
    ) {
      return true;
    }
  }
  return false;
}

/** FOV fit of a target shot in mosaic mode: against the mosaic area, a little below a target that fits the frame. */
function mosaicFit(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  area: SmartMosaicEnvelope,
): number {
  const sides = [area.maxWDeg, area.maxHDeg];
  return (
    SMART_MOSAIC_FIT_FACTOR *
    fovFit(majAxisArcmin, minAxisArcmin, Math.min(...sides), Math.max(...sides))
  );
}

/** An object up to this much larger than the frame still counts as fitting: only its faint edges are cut. */
export const FIT_TOLERANCE = 1.1;
/**
 * A smart telescope's margin: its targets are framed for their bright core (the Pleiades' stars), a quarter larger
 * than its frame or mosaic area still counts.
 */
export const SMART_FIT_TOLERANCE = 1.25;

/** How much larger than the frame an object may be and still fit, for this setup. */
export function fitTolerance(preset: GearPreset): number {
  return preset.builtIn ? SMART_FIT_TOLERANCE : FIT_TOLERANCE;
}
/** Angle step when turning an object in a Vaonis mosaic area (side and area caps) to find a fit. */
const FIT_ANGLE_STEP_DEG = 2;

/** Width and height of the box around an ellipse of axes `a` × `b`, its long axis turned `deg` from the width. */
function ellipseBox(a: number, b: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [Math.hypot(a * c, b * s), Math.hypot(a * s, b * c)];
}

/**
 * How much an object fills the frame at its best angle: the object is taken as an ellipse of its two axes (the long one
 * when the short is unknown) and turned in the frame, so a long thin object can lie along the diagonal (√(w² + h²)).
 * 1 = it just touches the edges, below 1 it fits with room, above 1 it is cut. Axes in arcminutes, sides in degrees.
 */
export function frameFill(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  minFovDeg: number,
  maxFovDeg: number,
): number {
  if (minFovDeg <= 0 || maxFovDeg <= 0) return Infinity;
  const a = majAxisArcmin / 60;
  const b = Math.min(a, (minAxisArcmin ?? majAxisArcmin) / 60);
  const fill = (deg: number) => {
    const [w, h] = ellipseBox(a, b, deg);
    return Math.max(w / maxFovDeg, h / minFovDeg);
  };
  if (a === b) return a / minFovDeg; // round: no angle helps
  // Turning the ellipse narrows its box along the long side and widens it along the short one, so the best angle is
  // where the two fills meet (cos²θ = (a²W² − b²H²) / ((a² − b²)(W² + H²))), or an end when they never do.
  const W = maxFovDeg;
  const H = minFovDeg;
  const cos2 = Math.min(
    1,
    Math.max(0, (a * a * W * W - b * b * H * H) / ((a * a - b * b) * (W * W + H * H))),
  );
  const meet = (Math.acos(Math.sqrt(cos2)) * 180) / Math.PI;
  return Math.min(fill(0), fill(90), fill(meet));
}

/**
 * Whether an object fits in the frame, turned to its best angle (along the diagonal when long and thin), allowing
 * `tolerance` ({@link fitTolerance}: 10 %, a quarter on a smart telescope): a slightly larger object is only cut at
 * its edges. Axes in arcminutes, sides in degrees.
 */
export function fitsInFrame(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  minFovDeg: number,
  maxFovDeg: number,
  tolerance = FIT_TOLERANCE,
): boolean {
  return frameFill(majAxisArcmin, minAxisArcmin, minFovDeg, maxFovDeg) <= tolerance;
}

/**
 * Panels of the smallest mosaic (20 % overlap) that covers an object, the camera turned whichever way needs fewer.
 * Axes in arcminutes, sides in degrees.
 */
export function oversizePanels(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  minFovDeg: number,
  maxFovDeg: number,
): number {
  const majDeg = majAxisArcmin / 60;
  const minDeg = (minAxisArcmin ?? majAxisArcmin) / 60;
  const along = planGrid(maxFovDeg, minFovDeg, majDeg, minDeg, OVERSIZE_OVERLAP_PCT);
  const across = planGrid(minFovDeg, maxFovDeg, majDeg, minDeg, OVERSIZE_OVERLAP_PCT);
  return Math.min(along.cols * along.rows, across.cols * across.rows);
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

/**
 * FOV fit of an object larger than the frame: 0.55 for a 2-panel mosaic down to 0.15 for a 3×3, below any object
 * that fits well, so such objects never top the list on framing alone.
 */
function oversizeFit(panels: number): number {
  const t = Math.min(1, Math.max(0, (panels - 2) / (MAX_OVERSIZE_PANELS - 2)));
  return 0.55 - t * 0.4;
}

/**
 * Altitude score by airmass (the thickness of air the light crosses, 1/sin(alt)): 0 at the minimum altitude, 1 from
 * 50°, where the air barely thickens any more. Airmass grows fast only near the horizon, so a target at 38° (M42 from
 * France) keeps most of the score while one just above the minimum gets little.
 */
function altitudeScore(altDeg: number, minAlt: number): number {
  if (altDeg < minAlt) return 0;
  if (altDeg >= FULL_ALT_SCORE_DEG || minAlt >= FULL_ALT_SCORE_DEG) return 1;
  const airmass = (a: number) => 1 / Math.sin((Math.max(a, 1) * Math.PI) / 180);
  const worst = airmass(minAlt);
  const best = airmass(FULL_ALT_SCORE_DEG);
  return (worst - airmass(altDeg)) / (worst - best);
}

/**
 * FOV fit score: best when the object spans 15-70% of the frame at its best angle ({@link frameFill}). Penalise
 * objects that are too small (<3%) or too large (>100%). Axes in arcminutes, sides in degrees.
 */
function fovFit(
  majAxisArcmin: number,
  minAxisArcmin: number | null,
  minFovDeg: number,
  maxFovDeg: number,
): number {
  if (minFovDeg <= 0 || maxFovDeg <= 0) return 0;
  const ratio = frameFill(majAxisArcmin, minAxisArcmin, minFovDeg, maxFovDeg);
  if (ratio < 0.03) return (ratio / 0.03) * 0.3; // tiny object: 0→0.3
  if (ratio <= 0.15) return 0.3 + ((ratio - 0.03) / (0.15 - 0.03)) * 0.4; // small: 0.3→0.7
  if (ratio <= 0.7) return 0.7 + ((ratio - 0.15) / (0.7 - 0.15)) * 0.3; // sweet spot: 0.7→1.0
  if (ratio <= 1.0) return 1.0 - ((ratio - 0.7) / (1.0 - 0.7)) * 0.3; // slightly large: 1→0.7
  // Too large — cut off gradually
  return Math.max(0, 0.7 - (ratio - 1.0) * 0.7);
}

const RATING_FACTORS = [0.6, 0.7, 0.8, 0.9, 1];
const DIFFICULTY_FACTORS = [1, 0.95, 0.85, 0.72, 0.6];

/**
 * Multiplies the score so finer targets rank higher: ×1 at 5★, 0.9 at 4★, 0.8 at 3★, 0.7 at 2★, 0.6 at 1★.
 * An object with no rating (one the user added) is not held down.
 */
export function ratingFactor(dso: DSO): number {
  if (dso.rating === null || dso.rating === undefined) return 1;
  return RATING_FACTORS[Math.round(Math.min(5, Math.max(1, dso.rating))) - 1];
}

/**
 * Multiplies the score so easier targets rank higher: ×1 at difficulty 1, 0.95 at 2, 0.85 at 3, 0.72 at 4, 0.6 at 5.
 * Gentle at 3, where many showpiece nebulae sit (Rosette, Horsehead, Veil), steep for the faint ones.
 */
export function difficultyFactor(dso: DSO): number {
  if (dso.difficulty === null || dso.difficulty === undefined) return 1;
  return DIFFICULTY_FACTORS[Math.round(Math.min(5, Math.max(1, dso.difficulty))) - 1];
}

/**
 * How easily the object shows up: its margin below the limiting magnitude. An object with no magnitude (many faint
 * nebulae) is scored by its difficulty instead (1 → 1, 5 → 0), so an unmeasured faint planetary nebula does not
 * count as average; the difficulty factor applies to every object on top.
 */
function brightnessScoreFn(dso: DSO, magLimit: number): number {
  if (dso.mag === null) {
    if (dso.difficulty === null || dso.difficulty === undefined) return 0.4; // neither known — neutral
    return Math.min(1, Math.max(0, (5 - dso.difficulty) / 4));
  }
  const margin = magLimit - dso.mag;
  return margin < 0 ? 0 : Math.min(1, margin / 4); // 0 margin → 0, 4+ mag margin → 1
}
