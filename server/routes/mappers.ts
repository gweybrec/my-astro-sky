import type { PlanEntryRow, PlanMosaicRow } from '../db.js';
import type { PlanEntry, PlanMosaic, ObservationWindow } from '@myastrosky/core/domain/plans';

/** Allowed plan objects-list sort keys (mirrors client PlanSortKey). */
export const PLAN_SORT_KEYS = [
  'transit',
  'altitude',
  'rating',
  'magnitude',
  'size',
  'name',
  'difficulty',
  'window',
] as const;

export function planEntryToApi(e: PlanEntryRow): PlanEntry {
  let observationWindows: ObservationWindow[] = [];
  try {
    observationWindows = JSON.parse(e.observation_windows ?? '[]');
  } catch {
    observationWindows = [];
  }
  return {
    id: e.id,
    dsoId: e.dso_id ?? null,
    position: e.position,
    paDeg: e.pa_deg ?? null,
    ra: e.ra ?? null,
    dec: e.dec ?? null,
    notes: e.notes ?? null,
    mosaicId: e.mosaic_id ?? null,
    mosaicWDeg: e.mosaic_w_deg ?? null,
    mosaicHDeg: e.mosaic_h_deg ?? null,
    observationWindows,
  };
}

export function planMosaicToApi(m: PlanMosaicRow): PlanMosaic {
  return {
    id: m.id,
    dsoId: m.dso_id ?? null,
    name: m.name ?? null,
    centerRa: m.center_ra,
    centerDec: m.center_dec,
    paDeg: m.pa_deg,
    overlapPct: m.overlap_pct,
    cols: m.cols,
    rows: m.rows,
    position: m.position,
  };
}
