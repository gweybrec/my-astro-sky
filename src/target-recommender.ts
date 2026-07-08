/**
 * Target recommender — selects and ranks DSOs for a given night, location
 * and gear preset.
 *
 * Scoring (0-100):
 *   45% — altitude score   (linear above 30°, best at 70°+)
 *   35% — FOV fit score    (best when object spans 15-70% of short FOV side)
 *   20% — brightness score (margin below limiting magnitude)
 */

import type { DSO } from './types';
import type { GearPreset } from './gear-presets';
import { fovDeg, limitingMag } from './gear-presets';
import { twilightWindow } from './astro-time';
import { maxAltDuringWindow, mightBeVisible } from './sky-geometry';

export interface ObserverLocation {
  latDeg: number;
  lonDeg: number;
}

export interface TargetSuggestion {
  dso: DSO;
  maxAltDeg: number;
  bestTimeUtc: Date;
  score: number;
  fovFitScore: number;
  altScore: number;
  brightnessScore: number;
}

const MAX_RESULTS = 8;

export function recommendTargets(
  dsos: DSO[],
  preset: GearPreset,
  location: ObserverLocation,
  dateNight: Date,
  limit = MAX_RESULTS,
  options: {
    ignoreFovFit?: boolean;
    minAltDeg?: number;
    maxAltDeg?: number;
    timeWindow?: { start: Date; end: Date };
  } = {},
): TargetSuggestion[] {
  const { latDeg, lonDeg } = location;
  const fov = fovDeg(preset);
  const magLimit = limitingMag(preset);
  const minFovDeg = Math.min(fov.wDeg, fov.hDeg);
  const minAlt = options.minAltDeg ?? 20;
  const maxAlt = options.maxAltDeg ?? 90;

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

  const candidates: TargetSuggestion[] = [];

  for (const dso of dsos) {
    // Multiple/double stars are point-like synthetic targets: they have no angular size
    // and no FOV-fit, and are scored by altitude + their own (setup-aware) quality rating.
    const isMultipleStar = dso.type === 'MS';

    // Skip objects without angular size (can't compute FOV fit) — except point-like stars
    const majAxisArcmin = dso.majAxis;
    if (!isMultipleStar && !majAxisArcmin) continue;

    // Skip objects that are too faint
    if (dso.mag !== null && dso.mag > magLimit) continue;

    // Quick declination pre-filter (avoids expensive sampling)
    if (!mightBeVisible(dso.dec, latDeg, minAlt)) continue;

    // Compute max altitude during the observing window. Stars use the wider visual
    // window and ignore the upper altitude cap (overhead is ideal for splitting doubles;
    // the cap only exists to avoid meridian-flip trouble on tracked imaging).
    const { maxAltDeg, atDate } = maxAltDuringWindow(
      dso.ra,
      dso.dec,
      latDeg,
      lonDeg,
      isMultipleStar ? starStart : windowStart,
      isMultipleStar ? starEnd : windowEnd,
      10,
    );

    const effectiveMaxAlt = isMultipleStar ? 90 : maxAlt;
    if (maxAltDeg < minAlt || maxAltDeg > effectiveMaxAlt) continue;

    // ─ Altitude score (0-1): best at 70°, good above 50°, ok at minAlt ─
    const altScore = altitudeScore(maxAltDeg, minAlt);

    // ─ FOV fit score (0-1) ─ (point-like stars are FOV-neutral)
    const objDeg = (majAxisArcmin ?? 0) / 60; // convert arcmin to deg
    const fovFitScore = isMultipleStar || options.ignoreFovFit ? 1.0 : fovFit(objDeg, minFovDeg);

    // ─ Brightness score (0-1) ─
    const brightnessScore = brightnessScoreFn(dso.mag, magLimit);

    // Multiple stars: rank by altitude + their own quality rating (0★ = unresolvable by
    // the setup, which sinks them). Everything else: altitude + FOV fit + brightness.
    const score = isMultipleStar
      ? 0.5 * altScore + 0.5 * ((dso.rating ?? 0) / 5)
      : 0.45 * altScore + 0.35 * fovFitScore + 0.2 * brightnessScore;

    candidates.push({
      dso,
      maxAltDeg,
      bestTimeUtc: atDate,
      score,
      fovFitScore,
      altScore,
      brightnessScore,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Diversity cap: max 2 of each DSO type in top results
  const typeCounts: Record<string, number> = {};
  const diverse: TargetSuggestion[] = [];
  for (const c of candidates) {
    const t = c.dso.type;
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    if (typeCounts[t] <= 2) {
      diverse.push(c);
    }
    if (diverse.length >= limit) break;
  }

  // If diversity filter left us with fewer than limit, top up
  if (diverse.length < limit) {
    for (const c of candidates) {
      if (!diverse.includes(c)) {
        diverse.push(c);
        if (diverse.length >= limit) break;
      }
    }
  }

  return diverse.slice(0, limit);
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
  options: { ignoreFovFit?: boolean; minAltDeg?: number } = {},
): { score: number; fovFitScore: number; altScore: number; brightnessScore: number } {
  const fov = fovDeg(preset);
  const magLimit = limitingMag(preset);
  const minFovDeg = Math.min(fov.wDeg, fov.hDeg);
  const minAlt = options.minAltDeg ?? 20;

  const altScore = altitudeScore(maxAltDeg, minAlt);
  const objDeg = (dso.majAxis ?? 0) / 60;
  const fovFitScore = options.ignoreFovFit ? 1.0 : objDeg > 0 ? fovFit(objDeg, minFovDeg) : 0;
  const brightnessScore = brightnessScoreFn(dso.mag, magLimit);
  const score = 0.45 * altScore + 0.35 * fovFitScore + 0.2 * brightnessScore;
  return { score, fovFitScore, altScore, brightnessScore };
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

function altitudeScore(altDeg: number, minAlt: number): number {
  if (altDeg < minAlt) return 0;
  if (altDeg >= 70) return 1;
  return (altDeg - minAlt) / (70 - minAlt);
}

/**
 * FOV fit score: best when the major axis of the object spans 15-70% of
 * the shorter FOV dimension.  Penalise objects that are too small (<3%) or
 * too large (>100%).
 */
function fovFit(objDeg: number, minFovDeg: number): number {
  if (minFovDeg <= 0) return 0;
  const ratio = objDeg / minFovDeg;
  if (ratio < 0.03) return (ratio / 0.03) * 0.3; // tiny object: 0→0.3
  if (ratio <= 0.15) return 0.3 + ((ratio - 0.03) / (0.15 - 0.03)) * 0.4; // small: 0.3→0.7
  if (ratio <= 0.7) return 0.7 + ((ratio - 0.15) / (0.7 - 0.15)) * 0.3; // sweet spot: 0.7→1.0
  if (ratio <= 1.0) return 1.0 - ((ratio - 0.7) / (1.0 - 0.7)) * 0.3; // slightly large: 1→0.7
  // Too large — cut off gradually
  return Math.max(0, 0.7 - (ratio - 1.0) * 0.7);
}

function brightnessScoreFn(mag: number | null, magLimit: number): number {
  if (mag === null) return 0.4; // unknown magnitude — neutral
  const margin = magLimit - mag;
  if (margin < 0) return 0;
  return Math.min(1, margin / 4); // 0 margin → 0, 4+ mag margin → 1
}
