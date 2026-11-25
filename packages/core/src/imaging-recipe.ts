/**
 * Rule-based filter + integration time recommendations for a DSO/gear pair.
 * These are heuristic "ballpark" estimates, not radiometric calculations.
 */

import type { DSO } from './types';
import type { GearPreset } from './gear-presets';

export interface FilterRec {
  name: string; // 'Ha', 'OIII', 'SII', 'L', 'R', 'G', 'B', 'RGB'
  subSeconds: number; // recommended sub-exposure in seconds
  count: number; // recommended number of subs
  hours: number; // total hours for this filter
}

export interface ImagingRecipe {
  filters: FilterRec[];
  totalHours: number;
  /** Human-readable note keys for the UI */
  noteKeys: string[];
}

// ─── Magnitude bands ─────────────────────────────────────────────────────────

type MagBand = 'bright' | 'medium' | 'faint';

function magBand(mag: number | null): MagBand {
  if (mag === null || mag > 12) return 'faint';
  if (mag > 9) return 'medium';
  return 'bright';
}

// ─── Integration time ─────────────────────────────────────────────────────────

/**
 * Base total integration hours for a good result (not a first look), indexed by difficulty 1–5 (1 = easy,
 * 5 = expert). Nebulae and galaxies are given at f/5, the others at a 200 mm aperture.
 *
 * Clusters use lower tables because they are resolution-limited rather than
 * SNR-limited: stacking more frames on a compact, bright cluster yields
 * diminishing returns much faster than it does for a faint diffuse nebula.
 * Even the easiest nebula or galaxy (M42, M31, M81) takes amateurs a few hours;
 * difficulty 4–5 ones (faint Sharpless/LBN regions, old planetary nebulae like
 * Abell 31 or Outters 4, tidal streams) are multi-night projects of tens of hours.
 */
const HOURS_BY_DIFFICULTY_DEFAULT = [2.0, 3.0, 5.0, 8.0, 25.0]; // nebulae (EN, SNR, RN, DN), galaxies
const HOURS_BY_DIFFICULTY_GC = [0.25, 0.5, 1.0, 2.0, 4.0]; // globular clusters
const HOURS_BY_DIFFICULTY_OC = [0.15, 0.33, 0.75, 1.5, 3.0]; // open clusters
// Planetary nebulae: difficulty comes from surface brightness, so 1–2 are the small bright ones (M57)
// and 4–5 the large faint ones (Abell, Jones, Outters).
const HOURS_BY_DIFFICULTY_PN = [1.0, 1.5, 2.5, 6.0, 25.0];

/** Least total time for a cluster, whatever the aperture: a stack needs some frames to be clean. */
const MIN_HOURS_GC = 0.75;
const MIN_HOURS_OC = 0.5;

/**
 * Focal ratio the nebula and galaxy tables are given at. On an extended object the light per pixel depends on the
 * focal ratio, not on the aperture: the time scales with (f-ratio / 5)², so a C8 at f/10 needs four times what an
 * f/5 refractor does, and twice and a half at f/6.3.
 */
const REFERENCE_F_RATIO = 5;
const MIN_F_RATIO_FACTOR = 0.4;
const MAX_F_RATIO_FACTOR = 5;

/** Least number of subs per filter: fewer cannot be stacked with outlier rejection (satellites, hot pixels). */
export const MIN_SUBS_PER_FILTER = 20;
/** Sub lengths the recipe shortens to (usual camera presets), shortest first, before adding time. */
const SHORTER_SUBS = [60, 90, 120, 180, 240, 300, 600];

/**
 * Aperture scaling factor normalised to 200 mm, for compact targets (clusters, planetary nebulae).
 * Uses exponent 1.5 (softer than the physical quadratic) to stay practical, capped
 * so the factor doesn't balloon to 8× on a 50 mm smart telescope:
 *   - GC/OC: cap 3 — resolution-limited, SNR saturates fast
 *   - PN, PPN: cap 3 — compact, high surface brightness, SNR saturates fast
 */
function apertureFactor(apertureMm: number, capFactor: number): number {
  return Math.min((200 / apertureMm) ** 1.5, capFactor);
}

const CLUSTER_MAX_APERTURE_FACTOR = 3.0;
const PN_MAX_APERTURE_FACTOR = 3.0;

/** Absolute ceiling: the faintest targets on a small aperture are several nights' work, not a season's. */
export const MAX_TOTAL_HOURS = 40.0;

/**
 * Compute total integration hours from DSO difficulty + gear. Nebulae and galaxies scale with the focal ratio,
 * clusters and planetary nebulae (compact) with the aperture. Falls back to a magnitude-band estimate when
 * difficulty is null.
 */
function computeTotalHours(dso: DSO, preset: GearPreset): number {
  const isGC = dso.type === 'GC';
  // A cluster inside a nebula (Wizard, Christmas Tree) is imaged for the nebula: nebula hours.
  const isOC = dso.type === 'OC' && !hostsNebula(dso);
  const isPN = dso.type === 'PN' || dso.type === 'PPN'; // protoplanetary nebulae are as compact
  const table = isGC
    ? HOURS_BY_DIFFICULTY_GC
    : isOC
      ? HOURS_BY_DIFFICULTY_OC
      : isPN
        ? HOURS_BY_DIFFICULTY_PN
        : HOURS_BY_DIFFICULTY_DEFAULT;
  const factor =
    isGC || isOC
      ? apertureFactor(preset.apertureMm, CLUSTER_MAX_APERTURE_FACTOR)
      : isPN
        ? apertureFactor(preset.apertureMm, PN_MAX_APERTURE_FACTOR)
        : fRatioFactor(preset);
  const floor = isGC ? MIN_HOURS_GC : isOC ? MIN_HOURS_OC : 0.15;

  if (dso.difficulty !== null) {
    const idx = Math.round(clamp(dso.difficulty, 1, 5)) - 1;
    const base = table[idx];
    return clamp(base * factor, floor, MAX_TOTAL_HOURS);
  }
  // Fallback: use magnitude band
  const band = magBand(dso.mag);
  const fallback: Record<MagBand, number> = { bright: 2.0, medium: 3.5, faint: 7.0 };
  return clamp(fallback[band] * factor, floor, MAX_TOTAL_HOURS);
}

/**
 * Whether a cluster sits in a nebula bright enough to be catalogued with it: it carries an LBN, Sharpless, van den
 * Bergh or RCW number (the Wizard is SH2-142, the Christmas Tree SH2-273).
 */
function hostsNebula(dso: DSO): boolean {
  return (dso.catalogs ?? []).some((c) => /^(LBN|SH2-|Sh2-|vdB|RCW)\s?\d/i.test(c));
}

/** Whether a cluster's nebula is an emission (HII) region: Sharpless and RCW list only those. */
function hostsEmissionNebula(dso: DSO): boolean {
  return (dso.catalogs ?? []).some((c) => /^(SH2-|Sh2-|RCW)\s?\d/i.test(c));
}

/** (f-ratio / 5)², bounded: how much longer than at f/5 an extended object takes with this setup. */
function fRatioFactor(preset: GearPreset): number {
  if (!(preset.apertureMm > 0) || !(preset.focalLengthMm > 0)) return 1;
  const fRatio = preset.focalLengthMm / preset.apertureMm;
  return clamp((fRatio / REFERENCE_F_RATIO) ** 2, MIN_F_RATIO_FACTOR, MAX_F_RATIO_FACTOR);
}

/**
 * Subs for `hours` of one filter at the preferred sub length (capped by the camera's longest sub): at least
 * {@link MIN_SUBS_PER_FILTER}, by shortening the sub to a usual length down to 60 s, then by adding time.
 */
function planFilter(name: string, hours: number, preferredSub: number, maxSub?: number): FilterRec {
  let sub = Math.min(preferredSub, maxSub ?? Infinity);
  if ((hours * 3600) / sub < MIN_SUBS_PER_FILTER) {
    const fits = SHORTER_SUBS.filter((n) => n <= sub && n <= (hours * 3600) / MIN_SUBS_PER_FILTER);
    sub = fits.length > 0 ? fits[fits.length - 1] : Math.min(SHORTER_SUBS[0], sub);
  }
  const count = Math.max(MIN_SUBS_PER_FILTER, Math.round((hours * 3600) / sub));
  return { name, subSeconds: sub, count, hours: (count * sub) / 3600 };
}

/** The recipe from its filters, with the total their hours add up to. */
function recipeOf(filters: FilterRec[], noteKeys: string[]): ImagingRecipe {
  return { filters, totalHours: filters.reduce((acc, f) => acc + f.hours, 0), noteKeys };
}

// ─── Sub-exposure suggestions ─────────────────────────────────────────────────

function lrgbSub(band: MagBand): number {
  return band === 'bright' ? 120 : band === 'medium' ? 300 : 600;
}

function nbSub(band: MagBand): number {
  return band === 'bright' ? 300 : band === 'medium' ? 600 : 900;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function recommendRecipe(dso: DSO, preset: GearPreset): ImagingRecipe {
  const band = magBand(dso.mag);
  const noteKeys: string[] = [];

  const emissionTypes: DSO['type'][] = ['EN', 'PN', 'SNR'];
  // A protoplanetary nebula shines by scattered starlight, not emission lines, whatever its name says.
  const isEmission =
    dso.type !== 'PPN' &&
    (emissionTypes.includes(dso.type) ||
      (dso.type === 'OC' && hostsEmissionNebula(dso)) ||
      (typeof dso.displayName === 'string' && /nebul|nébul/i.test(dso.displayName)));

  const totalHours = computeTotalHours(dso, preset);
  const maxSub = preset.maxSubSec;

  // Color / built-in telescopes → single session
  if (!preset.mono || preset.builtIn) {
    // Smart scope with dual-band filter on an emission target
    if (preset.hasDualBandFilter && isEmission) {
      noteKeys.push('noteDualBand');
      if (dso.type === 'PN') noteKeys.push('notePlanetaryNeb');
      return recipeOf([planFilter('Dual-Band', totalHours, nbSub(band), maxSub)], noteKeys);
    }

    noteKeys.push('noteColorCamera');
    return recipeOf([planFilter('RGB', totalHours, lrgbSub(band), maxSub)], noteKeys);
  }

  // Mono camera: choose narrowband vs LRGB based on object type

  if (isEmission) {
    // Ha + OIII + SII: 40% / 40% / 20%; a planetary nebula skips SII (rarely used) and splits Ha/OIII evenly
    const sub = nbSub(band);
    const isPN = dso.type === 'PN';
    noteKeys.push('noteNarrowband');
    if (isPN) noteKeys.push('notePlanetaryNeb');

    const share = isPN ? 0.5 : 0.4;
    const filters: FilterRec[] = [
      planFilter('Ha', totalHours * share, sub, maxSub),
      planFilter('OIII', totalHours * share, sub, maxSub),
    ];
    if (!isPN) filters.push(planFilter('SII', totalHours * 0.2, sub, maxSub));
    return recipeOf(filters, noteKeys);
  }

  // LRGB for galaxies, clusters, reflection nebulae, dark nebulae: L 50%, R 17%, G 17%, B 16%
  const sub = lrgbSub(band);
  if (dso.type === 'GC' || dso.type === 'OC') noteKeys.push('noteCluster');

  return recipeOf(
    [
      planFilter('L', totalHours * 0.5, sub, maxSub),
      planFilter('R', totalHours * 0.17, sub, maxSub),
      planFilter('G', totalHours * 0.17, sub, maxSub),
      planFilter('B', totalHours * 0.16, sub, maxSub),
    ],
    noteKeys,
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
