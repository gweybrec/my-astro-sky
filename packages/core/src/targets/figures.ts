import type { DSO } from '../types';
import type { GearPreset } from '../gear-presets';
import { twilightWindow } from '../astro-time';
import { maxAltDuringWindow } from '../sky-geometry';
import { scoreDso } from '../target-recommender';

/** A deep-sky object's figures for a night and a setup, as the target search scores them. */
export interface TargetFigures {
  /** When it is highest during the night, and how high; null without a place or a dark window. */
  bestTimeUtc: Date | null;
  maxAltDeg: number | null;
  /** The overall score in percent; null without the night or the setup. */
  scorePct: number | null;
  /** How well it fills the setup's field, in percent; null without the setup. */
  fovFitPct: number | null;
}

/**
 * The figures of an object found outside the target search (the map's search): its highest point during the night of
 * `place.date` (sampled every 10 minutes, as the map's transit), and the target search's score and field fit with
 * `preset` and its preferences.
 */
export function targetFigures(
  dso: DSO,
  place: { lat: number; lon: number; date: Date } | null,
  preset: GearPreset | null,
  prefs: { includeOversized?: boolean; minAltDeg?: number } = {},
): TargetFigures {
  const night = place ? twilightWindow(place.date, place.lat, place.lon) : null;
  const peak =
    place && night
      ? maxAltDuringWindow(dso.ra, dso.dec, place.lat, place.lon, night.start, night.end, 10)
      : null;
  const scores = preset
    ? scoreDso(dso, preset, peak?.maxAltDeg ?? 0, {
        ignoreFovFit: prefs.includeOversized ?? false,
        minAltDeg: prefs.minAltDeg ?? 20,
      })
    : null;
  return {
    bestTimeUtc: peak?.atDate ?? null,
    maxAltDeg: peak?.maxAltDeg ?? null,
    scorePct: scores && peak ? Math.round(scores.score * 100) : null,
    fovFitPct: scores ? Math.round(scores.fovFitScore * 100) : null,
  };
}
