import { dateToJD, moonPhase } from '../astro-time';
import { nearestNamedStar, starDisplayName } from '../catalog/star-registry';
import type { GearPreset } from '../gear-presets';
import { recommendRecipe, type ImagingRecipe } from '../imaging-recipe';
import {
  maxAltDuringWindow,
  moonDangerLevel,
  sampleAltCurve,
  sampleMoonAltCurve,
  type AltSample,
} from '../sky-geometry';
import { scoreDso, type ObserverLocation } from '../target-recommender';
import type { DSO } from '../types';
import { firstWindowFracByEntry, sortPlanTargets } from '../plan-sort';
import type { PlanSortKey } from '../domain/plans';
import { getPlanObserverFor, moonSeparationAt, nightWindow } from './night';

/** A plan target resolved and scored for the current observer and night. */
export interface PlanTargetInfo {
  entryId: string;
  dso: DSO;
  maxAltDeg: number;
  bestTimeUtc: Date;
  curve: AltSample[];
  /** Moon–target angular separation (°) at the imaging time, or null when the moon overlay is off / moon never rises. */
  moonSepDeg: number | null;
}

/**
 * Moon overlay for a plan render, identical for every row of a plan (same night and location), so it is computed once.
 * Null when the toggle is off or the Moon never clears the horizon.
 */
export interface MoonOverlay {
  curve: AltSample[];
  phaseIndex: number;
  illum: number;
}

/** The Moon's phase (icon index 0 to 7, illuminated fraction) in the middle of a night window. */
export function moonPhaseForWindow(win: { start: Date; end: Date }): {
  phaseIndex: number;
  illum: number;
} {
  const midJd = dateToJD(new Date((win.start.getTime() + win.end.getTime()) / 2));
  const { phaseIndex, illum } = moonPhase(midJd);
  return { phaseIndex, illum };
}

/** Moon overlay for a plan night; null when the overlay is off or the Moon stays below the horizon the whole window. */
export function buildMoonOverlay(
  loc: ObserverLocation,
  win: { start: Date; end: Date },
  enabled: boolean,
): MoonOverlay | null {
  if (!enabled) return null;
  const curve = sampleMoonAltCurve(loc.latDeg, loc.lonDeg, win.start, win.end);
  if (!curve.some((s) => s.altDeg > 0)) return null; // moon never rises this night
  return { curve, ...moonPhaseForWindow(win) };
}

/** The Moon–target distance read as a level, the i18n key of its adjective and the colour token it is drawn in. */
export function moonSeparationRating(
  sepDeg: number,
  illum: number,
): { level: 'danger' | 'warn' | 'ok'; labelKey: string; colorToken: string } {
  const level = moonDangerLevel(sepDeg, illum);
  return {
    level,
    labelKey: {
      danger: 'targets.plan.moonClose',
      warn: 'targets.plan.moonModerate',
      ok: 'targets.plan.moonFar',
    }[level],
    colorToken: {
      danger: '--color-danger',
      warn: '--status-warn-text',
      ok: '--status-success-text',
    }[level],
  };
}

/**
 * Display label for a custom-location frame (no DSO): the nearest named star, or `fallback` (the generic "custom
 * location" string) when none is close.
 */
export function customLocationLabelOr(ra: number, dec: number, fallback: string): string {
  const s = nearestNamedStar(ra, dec);
  return s ? starDisplayName(s) : fallback;
}

/** Synthetic DSO for a custom-location plan entry (no catalogued object). */
export function customLocationDso(entryId: string, ra: number, dec: number, label: string): DSO {
  return {
    id: `custom:${entryId}`,
    ra,
    dec,
    type: '?',
    majAxis: null,
    minAxis: null,
    pa: 0,
    mag: null,
    displayName: label,
    catalogs: [`${ra.toFixed(1)}°, ${dec.toFixed(1)}°`],
    emissionLines: null,
    constellation: null,
    rating: null,
    difficulty: null,
    containerId: null,
    priority: Number.MAX_SAFE_INTEGER,
  };
}

/** What {@link computePlanTargets} reads from the catalogues. */
export interface PlanTargetLookups {
  getDsoById: (id: string) => DSO | undefined;
  /** The label of a frame on empty sky at the given coordinates. */
  customLabel: (ra: number, dec: number) => string;
}

/** The standalone entries of a plan resolved for a night, transit-ordered (earliest culmination first). */
export function computePlanTargets(
  plan: {
    entries: Array<{
      id: string;
      dsoId: string | null;
      ra: number | null;
      dec: number | null;
      mosaicId?: string | null;
    }>;
  },
  loc: ObserverLocation,
  win: { start: Date; end: Date },
  moonEnabled: boolean,
  lookups: PlanTargetLookups,
): PlanTargetInfo[] {
  const out: PlanTargetInfo[] = [];
  for (const e of plan.entries) {
    if (e.mosaicId) continue; // mosaic tiles are summarised as one mosaic, not per-tile rows
    const realDso = e.dsoId ? lookups.getDsoById(e.dsoId) : null;
    // Effective position: explicit frame-centre override, else the DSO centre.
    const ra = e.ra ?? realDso?.ra;
    const dec = e.dec ?? realDso?.dec;
    if (ra == null || dec == null) continue; // nothing to place
    // A frame on empty sky keeps a trajectory but has no catalogue metadata.
    const dso = realDso ?? customLocationDso(e.id, ra, dec, lookups.customLabel(ra, dec));
    const { maxAltDeg, atDate } = maxAltDuringWindow(
      ra,
      dec,
      loc.latDeg,
      loc.lonDeg,
      win.start,
      win.end,
      10,
    );
    const curve = sampleAltCurve(ra, dec, loc.latDeg, loc.lonDeg, win.start, win.end, 10);
    const moonSepDeg = moonEnabled ? moonSeparationAt(ra, dec, atDate) : null;
    out.push({ entryId: e.id, dso, maxAltDeg, bestTimeUtc: atDate, curve, moonSepDeg });
  }
  // Transit-ordered: earliest culmination first.
  out.sort((a, b) => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime());
  return out;
}

/** A plan's item count: a mosaic counts as one item (its tiles are not listed individually). */
export function planItemCount(plan: {
  entries: readonly { mosaicId?: string | null }[];
  mosaics?: readonly unknown[];
}): number {
  return plan.entries.filter((e) => !e.mosaicId).length + (plan.mosaics?.length ?? 0);
}

/** A night's date as the plans show it ("3 oct. 2026"), written in the given locale. */
export function formatPlanDate(dateISO: string, locale?: string | string[]): string {
  return new Date(dateISO + 'T12:00:00Z').toLocaleDateString(locale ?? [], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The default name of a new plan: "Nuit du {date}" with the date of the chosen night written in the given locale. */
export function defaultPlanName(
  dateISO: string,
  translate: (key: string, params?: Record<string, string | number>) => string,
  locale?: string | string[],
): string {
  return translate('targets.plan.defaultName', { date: formatPlanDate(dateISO, locale) });
}

/** The scores and the imaging recipe of a plan target for a gear preset. */
export function scorePlanEntry(
  dso: DSO,
  preset: GearPreset,
  maxAltDeg: number,
  prefs: { includeOversized?: boolean; minAltDeg?: number },
): { scorePct: number; fovFitPct: number; recipe: ImagingRecipe } {
  const { score, fovFitScore } = scoreDso(dso, preset, maxAltDeg, {
    ignoreFovFit: prefs.includeOversized ?? false,
    minAltDeg: prefs.minAltDeg ?? 20,
  });
  return {
    scorePct: Math.round(score * 100),
    fovFitPct: Math.round(fovFitScore * 100),
    recipe: recommendRecipe(dso, preset),
  };
}

/** A plan resolved for its night: where it is observed, the night, the Moon, and its targets in the plan's order. */
export interface PlanNight {
  loc: ObserverLocation;
  win: { start: Date; end: Date };
  /** The Moon overlay; null when it is off or the Moon stays below the horizon the whole night. */
  moon: MoonOverlay | null;
  phase: { phaseIndex: number; illum: number };
  infos: PlanTargetInfo[];
}

/**
 * Where, when and under which Moon a plan is observed (its own location and night, else the global ones), with its
 * standalone targets ordered by the plan's sort key. Null when no valid location is known.
 */
export function resolvePlanNight(
  plan: {
    lat?: number | null;
    lon?: number | null;
    nightOf?: string | null;
    sortBy?: PlanSortKey | null;
    entries: Array<{
      id: string;
      dsoId: string | null;
      ra: number | null;
      dec: number | null;
      mosaicId?: string | null;
      observationWindows?: Array<{ startFrac: number }>;
    }>;
  },
  prefs: { lat: number | null; lon: number | null; lastDateISO: string | null; showMoon?: boolean },
  lookups: PlanTargetLookups,
): PlanNight | null {
  const observer = getPlanObserverFor(plan, prefs);
  if (!observer) return null;
  const win = nightWindow(observer.loc, observer.dateNight);
  const moonEnabled = prefs.showMoon !== false;
  const infos = sortPlanTargets(
    computePlanTargets(plan, observer.loc, win, moonEnabled, lookups),
    plan.sortBy ?? 'transit',
    firstWindowFracByEntry(plan.entries),
  );
  return {
    loc: observer.loc,
    win,
    moon: buildMoonOverlay(observer.loc, win, moonEnabled),
    phase: moonPhaseForWindow(win),
    infos,
  };
}
