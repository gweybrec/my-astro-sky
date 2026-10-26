import { dateToJD, lstHours } from '../astro-time';
import { DSO_CATALOGS_ALL, getDSOs } from '../catalog/dso-registry';
import { getConstellationInfos } from '../catalog/star-registry';
import type { HorizonProfile } from '../horizon-io';
import { altAzFromRaDec } from '../sky-geometry';
import { isAltAzInRegion } from '../region-geometry';
import {
  createRecommender,
  type ObserverLocation,
  type TargetSuggestion,
} from '../target-recommender';
import type { GearPreset } from '../gear-presets';
import type { DSO } from '../types';
import { ALL_DSO_TYPES, filterTargetDSOs } from './filters';
import { todayISO } from './format';
import { buildMultipleStarTargets } from './multiple-stars';
import { nightWindow, timeWindowFor } from './night';
import { presetForSetupId, type GearLists } from './plan-setup';
import type { TargetsPrefs } from './prefs';

/** What the recommendation reads: the preferences and everything they refer to. */
export interface RecommendationInput {
  prefs: TargetsPrefs;
  /** The night, `YYYY-MM-DD`; today when absent. */
  dateStr?: string;
  gear: GearLists;
  /** The object ids carried by the user's photos; read only when `prefs.excludePhotographed` is on. */
  photographedIds?: Set<string> | null;
  /** The terrain horizon, used when `prefs.respectHorizon` is on. */
  horizonProfile?: HorizonProfile | null;
  /** The saved sky regions; the one named by `prefs.skyRegionId` filters the result. */
  regions?: readonly { id: string; points: { azDeg: number; altDeg: number }[] }[];
  /** The objects to choose among; the catalogue by default. */
  dsos?: DSO[];
}

export type RecommendationEmptyReason = 'no-location' | 'no-setup' | 'no-window-overlap';

export type RecommendationResult =
  | { kind: 'empty'; reason: RecommendationEmptyReason }
  | {
      kind: 'ok';
      /** In the recommender's order (best score first); may be empty when nothing matches the filters. */
      suggestions: TargetSuggestion[];
      preset: GearPreset;
      location: ObserverLocation;
      dateNight: Date;
      dateStr: string;
    };

interface Prepared {
  kind: 'ready';
  pool: DSO[];
  recommender: ReturnType<typeof createRecommender>;
  finish: (scored: TargetSuggestion[]) => RecommendationResult;
}

/**
 * The Targets tab's search without its page: validates the location and the setup, filters the catalogue by the
 * preferences, scores it, then applies the sky-direction and sky-region filters. Moved unchanged from the desktop's
 * `runRecommendation`; its inputs that were read from the page and the stores are parameters.
 */
function prepare(
  input: RecommendationInput,
): Prepared | { kind: 'empty'; reason: RecommendationEmptyReason } {
  const { prefs, gear } = input;
  const lat = prefs.lat ?? NaN;
  const lon = prefs.lon ?? NaN;
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { kind: 'empty', reason: 'no-location' };
  }

  const preset = presetForSetupId(prefs.setupId, gear);
  if (!preset) return { kind: 'empty', reason: 'no-setup' };

  const dateStr = input.dateStr || todayISO();
  const dateNight = new Date(dateStr + 'T12:00:00Z');
  const dsos = input.dsos ?? getDSOs();
  const enabledTypes = new Set(prefs.enabledTypes ?? [...ALL_DSO_TYPES]);
  const enabledRatings = new Set(prefs.enabledRatings ?? [1, 2, 3, 4, 5]);
  const enabledDifficulties = new Set(prefs.enabledDifficulties ?? [1, 2, 3, 4, 5]);
  const enabledCatalogs = new Set(prefs.enabledCatalogs ?? [...DSO_CATALOGS_ALL]);
  const allConsts = getConstellationInfos();
  const enabledConstellations =
    prefs.enabledConstellations && prefs.enabledConstellations.length < allConsts.length
      ? new Set(prefs.enabledConstellations)
      : null;

  const filteredDSOs = filterTargetDSOs(dsos, {
    enabledTypes,
    enabledRatings,
    enabledDifficulties,
    enabledCatalogs,
    photographedIds: prefs.excludePhotographed ? (input.photographedIds ?? null) : null,
    enabledConstellations,
  });
  const location: ObserverLocation = { latDeg: lat, lonDeg: lon };
  const enabledDirs = new Set(prefs.horizonDirs ?? ['N', 'S', 'E', 'W']);
  const dirFilterActive = enabledDirs.size < 4;

  const timeWindow = timeWindowFor(dateStr, prefs.obsStartTime, prefs.obsEndTime);
  if (timeWindow) {
    const dark = nightWindow(location, dateNight);
    const overlapStart = Math.max(dark.start.getTime(), timeWindow.start.getTime());
    const overlapEnd = Math.min(dark.end.getTime(), timeWindow.end.getTime());
    if (overlapEnd <= overlapStart) return { kind: 'empty', reason: 'no-window-overlap' };
  }

  // Multiple/double stars are synthetic point-like targets (not in the DSO catalog);
  // inject them into the pool when their type chip is enabled.
  const msTargets = enabledTypes.has('MS') ? buildMultipleStarTargets(preset) : [];
  const pool = msTargets.length ? [...filteredDSOs, ...msTargets] : filteredDSOs;

  const recommender = createRecommender(preset, location, dateNight, {
    ignoreFovFit: prefs.includeOversized ?? false,
    minAltDeg: prefs.minAltDeg ?? 20,
    maxAltDeg: prefs.maxAltDeg ?? 80,
    timeWindow: timeWindow ?? undefined,
    horizonProfile: prefs.respectHorizon ? (input.horizonProfile ?? null) : null,
  });

  /** Ranks the scored objects, then applies the sky-direction and sky-region filters. */
  const finish = (scored: TargetSuggestion[]): RecommendationResult => {
    const rawSuggestions = recommender.finish(scored, 5000);

    let suggestions: TargetSuggestion[];
    if (!dirFilterActive) {
      suggestions = rawSuggestions;
    } else {
      const midnightUTC = dateNight.getTime() + (12 - lon / 15) * 3600 * 1000;
      suggestions = rawSuggestions.filter((s) => {
        const isNorth = s.dso.dec > lat;
        if (!enabledDirs.has('N') && isNorth) return false;
        if (!enabledDirs.has('S') && !isNorth) return false;
        const isEast = s.bestTimeUtc.getTime() > midnightUTC;
        if (!enabledDirs.has('E') && isEast) return false;
        if (!enabledDirs.has('W') && !isEast) return false;
        return true;
      });
    }

    // Sky region filter: composes as AND with the N/S/E/W chips above — a precise
    // "what I can actually see from my garden" cut on top of the coarse quadrant one.
    const activeRegion = prefs.skyRegionId
      ? input.regions?.find((r) => r.id === prefs.skyRegionId)
      : null;
    if (activeRegion) {
      suggestions = suggestions.filter((s) => {
        const lstH = lstHours(dateToJD(s.bestTimeUtc), lon);
        const { altDeg, azDeg } = altAzFromRaDec(s.dso.ra, s.dso.dec, lstH, lat);
        return isAltAzInRegion(azDeg, altDeg, activeRegion);
      });
    }

    return { kind: 'ok', suggestions, preset, location, dateNight, dateStr };
  };

  return { kind: 'ready', pool, recommender, finish };
}

/** The Targets tab's search, in one go (what the desktop runs). */
export function runTargetRecommendation(input: RecommendationInput): RecommendationResult {
  const p = prepare(input);
  if (p.kind === 'empty') return p;
  return p.finish(p.recommender.collect(p.pool));
}

/**
 * The same search, scoring `sliceSize` objects at a time and awaiting `yieldToUi` between slices, so that a phone's
 * page keeps answering touches during the search. The result is the one of {@link runTargetRecommendation}.
 */
export async function runTargetRecommendationSliced(
  input: RecommendationInput,
  yieldToUi: () => Promise<void>,
  sliceSize = 600,
): Promise<RecommendationResult> {
  const p = prepare(input);
  if (p.kind === 'empty') return p;
  const scored: TargetSuggestion[] = [];
  for (let i = 0; i < p.pool.length; i += sliceSize) {
    scored.push(...p.recommender.collect(p.pool.slice(i, i + sliceSize)));
    await yieldToUi();
  }
  return p.finish(scored);
}
