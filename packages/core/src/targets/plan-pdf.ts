import { outlineFromGrid } from '../mosaic';
import type { AltSample } from '../sky-geometry';
import type { DSO } from '../types';
import type { ObservationWindow, Plan } from '../domain/plans';
import type { PlanNight } from './plan';

/** One page of a plan's PDF: a standalone target or a mosaic. */
export interface PlanPdfTarget {
  dso: DSO;
  bestTimeUtc: Date;
  maxAltDeg: number;
  curve: AltSample[];
  nightWin: { start: Date; end: Date };
  /** When set, this entry is a mosaic: the framed view draws the tile grid and
   *  the overview marks the envelope footprint instead of a single FOV frame. */
  mosaic?: {
    wDeg: number;
    hDeg: number;
    paDeg: number;
    tiles: { ra: number; dec: number }[];
  } | null;
  /** User-drawn observation windows on this target's trajectory (may be empty). */
  observationWindows?: ObservationWindow[];
  /** Moon overlay (identical across pages); omitted when the moon toggle is off. */
  moonCurve?: AltSample[];
  moonPhaseIndex?: number;
  moonIllum?: number;
  /** Moon–target angular separation (°) at the imaging time, or null. */
  moonSepDeg?: number | null;
}

/**
 * The pages of a plan's PDF, in the plan's order (`night.infos`): a standalone target with its observation windows, a
 * mosaic with its framed tile grid when the plan's setup gives the tile size (`tile`; without it a mosaic has no page).
 * The Moon overlay of the night goes on every page.
 */
export function buildPlanPdfTargets(
  plan: Pick<Plan, 'entries' | 'mosaics'>,
  night: Pick<PlanNight, 'win' | 'moon' | 'infos'>,
  tile: { wDeg: number; hDeg: number } | null,
): PlanPdfTarget[] {
  const { win, moon } = night;
  const moonShared = moon
    ? { moonCurve: moon.curve, moonPhaseIndex: moon.phaseIndex, moonIllum: moon.illum }
    : {};
  const targets: PlanPdfTarget[] = [];
  for (const i of night.infos) {
    const page = {
      dso: i.dso,
      bestTimeUtc: i.bestTimeUtc,
      maxAltDeg: i.maxAltDeg,
      curve: i.curve,
      nightWin: win,
      ...moonShared,
      moonSepDeg: moon ? i.moonSepDeg : null,
    };
    const m = i.mosaicId ? (plan.mosaics ?? []).find((x) => x.id === i.mosaicId) : undefined;
    if (!m) {
      const entry = plan.entries.find((e) => e.id === i.entryId);
      targets.push({ ...page, mosaic: null, observationWindows: entry?.observationWindows ?? [] });
      continue;
    }
    if (!tile) continue;
    const tiles = plan.entries
      .filter((en) => en.mosaicId === m.id && en.ra != null && en.dec != null)
      .map((en) => ({ ra: en.ra as number, dec: en.dec as number }));
    const env = outlineFromGrid(m.cols, m.rows, tile.wDeg, tile.hDeg, m.overlapPct);
    targets.push({ ...page, mosaic: { wDeg: env.wDeg, hDeg: env.hDeg, paDeg: m.paDeg, tiles } });
  }
  return targets;
}
