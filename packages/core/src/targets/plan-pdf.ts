import { outlineFromGrid } from '../mosaic';
import { maxAltDuringWindow, sampleAltCurve, type AltSample } from '../sky-geometry';
import type { DSO } from '../types';
import type { ObservationWindow, Plan } from '../domain/plans';
import { moonSeparationAt } from './night';
import { customLocationDso, type PlanNight, type PlanTargetLookups } from './plan';

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
 * The pages of a plan's PDF: its standalone targets in the plan's order (`night.infos`), each with its observation
 * windows, then one page per mosaic (trajectory from its centre, framed tile grid) when the plan's setup gives the tile
 * size (`tile`). The Moon overlay of the night goes on every page.
 */
export function buildPlanPdfTargets(
  plan: Pick<Plan, 'entries' | 'mosaics'>,
  night: Pick<PlanNight, 'loc' | 'win' | 'moon' | 'infos'>,
  tile: { wDeg: number; hDeg: number } | null,
  lookups: PlanTargetLookups,
): PlanPdfTarget[] {
  const { loc, win, moon } = night;
  const moonShared = moon
    ? { moonCurve: moon.curve, moonPhaseIndex: moon.phaseIndex, moonIllum: moon.illum }
    : {};

  const targets: PlanPdfTarget[] = night.infos.map((i) => ({
    dso: i.dso,
    bestTimeUtc: i.bestTimeUtc,
    maxAltDeg: i.maxAltDeg,
    curve: i.curve,
    nightWin: win,
    mosaic: null,
    observationWindows: plan.entries.find((e) => e.id === i.entryId)?.observationWindows ?? [],
    ...moonShared,
    moonSepDeg: moon ? i.moonSepDeg : null,
  }));

  if (!tile) return targets;
  for (const m of plan.mosaics ?? []) {
    const tiles = plan.entries
      .filter((en) => en.mosaicId === m.id && en.ra != null && en.dec != null)
      .map((en) => ({ ra: en.ra as number, dec: en.dec as number }));
    const { maxAltDeg, atDate } = maxAltDuringWindow(
      m.centerRa,
      m.centerDec,
      loc.latDeg,
      loc.lonDeg,
      win.start,
      win.end,
      10,
    );
    const curve = sampleAltCurve(
      m.centerRa,
      m.centerDec,
      loc.latDeg,
      loc.lonDeg,
      win.start,
      win.end,
      10,
    );
    const realDso = m.dsoId ? lookups.getDsoById(m.dsoId) : undefined;
    const dso =
      realDso ??
      customLocationDso(
        `mosaic:${m.id}`,
        m.centerRa,
        m.centerDec,
        lookups.customLabel(m.centerRa, m.centerDec),
      );
    if (!realDso && m.name) dso.displayName = m.name;
    const env = outlineFromGrid(m.cols, m.rows, tile.wDeg, tile.hDeg, m.overlapPct);
    targets.push({
      dso,
      bestTimeUtc: atDate,
      maxAltDeg,
      curve,
      nightWin: win,
      mosaic: { wDeg: env.wDeg, hDeg: env.hDeg, paDeg: m.paDeg, tiles },
      ...moonShared,
      moonSepDeg: moon ? moonSeparationAt(m.centerRa, m.centerDec, atDate) : null,
    });
  }
  return targets;
}
