/**
 * Rule-based filter + integration time recommendations for a DSO/gear pair.
 * These are heuristic "ballpark" estimates, not radiometric calculations.
 */

import type { DSO } from './types';
import type { GearPreset } from './gear-presets';

export interface FilterRec {
  name: string;       // 'Ha', 'OIII', 'SII', 'L', 'R', 'G', 'B', 'RGB'
  subSeconds: number; // recommended sub-exposure in seconds
  count: number;      // recommended number of subs
  hours: number;      // total hours for this filter
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
 * Base total integration hours at 200 mm reference aperture, indexed by
 * difficulty 1–5 (difficulty 1 = trivially easy, 5 = expert).
 *
 * Clusters use lower tables because they are resolution-limited rather than
 * SNR-limited: stacking more frames on a compact, bright cluster yields
 * diminishing returns much faster than it does for a faint diffuse nebula.
 */
const HOURS_BY_DIFFICULTY_DEFAULT = [0.25, 0.75, 2.5, 4.0, 8.0]; // large nebulae (EN, SNR, RN, DN)
const HOURS_BY_DIFFICULTY_GC = [0.25, 0.50, 1.0, 2.0, 4.0]; // globular clusters
const HOURS_BY_DIFFICULTY_OC = [0.15, 0.33, 0.75, 1.5, 3.0]; // open clusters
const HOURS_BY_DIFFICULTY_PN = [0.15, 0.33, 0.75, 1.5, 3.0]; // planetary nebulae

/**
 * Aperture scaling factor normalised to 200 mm.
 * Uses exponent 1.5 (softer than the physical quadratic) to stay practical.
 * Every type family has a cap so the factor doesn't balloon to 8× on a 50 mm
 * smart telescope and produce absurd multi-hour recommendations:
 *   - GC/OC: cap 3 — resolution-limited, SNR saturates fast
 *   - PN: cap 3 — compact, high surface brightness, SNR saturates fast
 *   - Galaxies: cap 4 — benefit from more time than clusters, but not 8×
 *   - EN/SNR/RN/DN/?: cap 5 — large diffuse targets do scale more, but still bounded
 */
function apertureFactor(apertureMm: number, capFactor: number): number {
  return Math.min((200 / apertureMm) ** 1.5, capFactor);
}

const CLUSTER_MAX_APERTURE_FACTOR = 3.0;
const PN_MAX_APERTURE_FACTOR = 3.0;
const GX_MAX_APERTURE_FACTOR = 4.0;
const EN_MAX_APERTURE_FACTOR = 5.0; // EN, SNR, RN, DN, unknown

/** Absolute ceiling — no single-session recommendation should exceed one long night. */
const MAX_TOTAL_HOURS = 6.0;

/**
 * Compute total integration hours from DSO difficulty + gear aperture.
 * Falls back to a magnitude-band estimate when difficulty is null.
 */
function computeTotalHours(dso: DSO, apertureMm: number): number {
  const isGC = dso.type === 'GC';
  const isOC = dso.type === 'OC';
  const isPN = dso.type === 'PN';
  const isGx =
    dso.type === 'GxS' || dso.type === 'GxE' || dso.type === 'GxI' || dso.type === 'Gx';
  const table = isGC
    ? HOURS_BY_DIFFICULTY_GC
    : isOC
      ? HOURS_BY_DIFFICULTY_OC
      : isPN
        ? HOURS_BY_DIFFICULTY_PN
        : HOURS_BY_DIFFICULTY_DEFAULT;
  const aFactorCap =
    isGC || isOC
      ? CLUSTER_MAX_APERTURE_FACTOR
      : isPN
        ? PN_MAX_APERTURE_FACTOR
        : isGx
          ? GX_MAX_APERTURE_FACTOR
          : EN_MAX_APERTURE_FACTOR;
  const aFactor = apertureFactor(apertureMm, aFactorCap);

  if (dso.difficulty !== null) {
    const idx = Math.round(clamp(dso.difficulty, 1, 5)) - 1;
    const base = table[idx];
    return clamp(base * aFactor, 0.15, MAX_TOTAL_HOURS);
  }
  // Fallback: use magnitude band
  const band = magBand(dso.mag);
  const fallback: Record<MagBand, number> = { bright: 1.5, medium: 3.5, faint: 7.0 };
  return clamp(fallback[band] * aFactor, 0.15, MAX_TOTAL_HOURS);
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
  const isEmission =
    emissionTypes.includes(dso.type) ||
    (typeof dso.displayName === 'string' &&
      /nebul|nébul/i.test(dso.displayName));

  // Color / built-in telescopes → single session
  if (!preset.mono || preset.builtIn) {
    const totalHours = computeTotalHours(dso, preset.apertureMm);

    // Smart scope with dual-band filter on an emission target
    if (preset.hasDualBandFilter && isEmission) {
      const subSec = Math.min(nbSub(band), preset.maxSubSec ?? Infinity);
      const count = Math.round((totalHours * 3600) / subSec);
      noteKeys.push('noteDualBand');
      if (dso.type === 'PN') noteKeys.push('notePlanetaryNeb');
      return {
        filters: [{ name: 'Dual-Band', subSeconds: subSec, count, hours: totalHours }],
        totalHours,
        noteKeys,
      };
    }

    const subSec = Math.min(lrgbSub(band), preset.maxSubSec ?? Infinity);
    const count = Math.round((totalHours * 3600) / subSec);
    noteKeys.push('noteColorCamera');
    return {
      filters: [{ name: 'RGB', subSeconds: subSec, count, hours: totalHours }],
      totalHours,
      noteKeys,
    };
  }

  // Mono camera: choose narrowband vs LRGB based on object type

  const totalHours = computeTotalHours(dso, preset.apertureMm);

  if (isEmission) {
    // Ha + OIII + SII (optionally)
    const sub = nbSub(band);

    // Distribute: Ha 40%, OIII 40%, SII 20%
    const haH = totalHours * 0.4;
    const oiiiH = totalHours * 0.4;
    const siiH = totalHours * 0.2;
    const haCount = Math.round((haH * 3600) / sub);
    const oiiiCount = Math.round((oiiiH * 3600) / sub);
    const siiCount = Math.round((siiH * 3600) / sub);

    noteKeys.push('noteNarrowband');
    if (dso.type === 'PN') noteKeys.push('notePlanetaryNeb');

    const filters: FilterRec[] = [
      { name: 'Ha', subSeconds: sub, count: haCount, hours: haH },
      { name: 'OIII', subSeconds: sub, count: oiiiCount, hours: oiiiH },
    ];
    if (dso.type !== 'PN') {
      // SII rarely used for planetary nebulae
      filters.push({ name: 'SII', subSeconds: sub, count: siiCount, hours: siiH });
    }

    return { filters, totalHours, noteKeys };
  }

  // LRGB for galaxies, clusters, reflection nebulae, dark nebulae
  const sub = lrgbSub(band);

  // Distribute: L 50%, R 17%, G 17%, B 16%
  const lH = totalHours * 0.5;
  const rH = totalHours * 0.17;
  const gH = totalHours * 0.17;
  const bH = totalHours * 0.16;
  const lCount = Math.round((lH * 3600) / sub);
  const rCount = Math.round((rH * 3600) / sub);
  const gCount = Math.round((gH * 3600) / sub);
  const bCount = Math.round((bH * 3600) / sub);

  if (dso.type === 'GC' || dso.type === 'OC') noteKeys.push('noteCluster');

  return {
    filters: [
      { name: 'L', subSeconds: sub, count: lCount, hours: lH },
      { name: 'R', subSeconds: sub, count: rCount, hours: rH },
      { name: 'G', subSeconds: sub, count: gCount, hours: gH },
      { name: 'B', subSeconds: sub, count: bCount, hours: bH },
    ],
    totalHours,
    noteKeys,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
