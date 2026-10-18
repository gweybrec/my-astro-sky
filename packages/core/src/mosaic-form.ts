/**
 * What the mosaic form computes (the desktop's "Nouvelle mosaïque" / "Modifier la mosaïque", fov-overlay.ts
 * buildMosaicModal, and the phone's mosaic sheet): where the mosaic sits from the objects picked, the grid that covers
 * them, its tiles, its summary, and which standalone plan frames a new mosaic stands in for.
 */
import type { DSO } from './types';
import { autoRegionForDsos, outlineFromGrid, planGrid, tileCenters } from './mosaic';
import type { GridDims } from './mosaic';
import { getDSOById } from './catalog/dso-registry';
import { angularSeparationDeg } from './sky-geometry';

export const MOSAIC_DEFAULT_OVERLAP = 20;

/** Where an existing mosaic sits, kept when it is edited with no object picked. */
export interface MosaicPlace {
  centerRa: number;
  centerDec: number;
  paDeg: number;
}

/** Centre, position angle and the grid covering the picked objects (one centres the mosaic on it, several between
 * them); with none, the edited mosaic's own place and a 1 × 1 grid. */
export function mosaicPlacement(
  targets: Array<Pick<DSO, 'ra' | 'dec' | 'majAxis' | 'minAxis' | 'pa'>>,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
  edited?: MosaicPlace,
): { center: { ra: number; dec: number }; paDeg: number; auto: GridDims } {
  if (targets.length > 0) {
    const { center, region } = autoRegionForDsos(targets, 20);
    return {
      center,
      paDeg: region.paDeg,
      auto: planGrid(tileWDeg, tileHDeg, region.wDeg, region.hDeg, overlapPct),
    };
  }
  return {
    center: edited ? { ra: edited.centerRa, dec: edited.centerDec } : { ra: 0, dec: 0 },
    paDeg: edited?.paDeg ?? 0,
    auto: planGrid(tileWDeg, tileHDeg, 0, 0, overlapPct),
  };
}

/** The overlap a form field holds, between 0 and 90 (the default when it is not a number). */
export function clampOverlap(n: number): number {
  return Number.isFinite(n) ? Math.min(90, Math.max(0, n)) : MOSAIC_DEFAULT_OVERLAP;
}

/** The tiles of a cols × rows mosaic about its centre and angle, as a plan or a free mosaic stores them. */
export function mosaicTiles(
  center: { ra: number; dec: number },
  paDeg: number,
  cols: number,
  rows: number,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
): Array<{ ra: number; dec: number; paDeg: number }> {
  return tileCenters(center, paDeg, cols, rows, tileWDeg, tileHDeg, overlapPct).map((tl) => ({
    ra: tl.ra,
    dec: tl.dec,
    paDeg: tl.paDeg,
  }));
}

/** The form's summary: "3×2 · 6 <panels> · <field>", the field formatted by the caller's `formatFov`. */
export function mosaicSummary(
  cols: number,
  rows: number,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
  panelsWord: string,
  formatFov: (wDeg: number, hDeg: number) => string,
): string {
  const { wDeg, hDeg } = outlineFromGrid(cols, rows, tileWDeg, tileHDeg, overlapPct);
  return `${cols}×${rows} · ${cols * rows} ${panelsWord} · ${formatFov(wDeg, hDeg)}`;
}

/**
 * Standalone plan frames a new mosaic stands in for: the same target, or any frame whose centre lies within the
 * mosaic's footprint. They're deleted with the mosaic's creation so only the mosaic remains.
 */
export function entriesCoveredByMosaic(
  entries: Array<{
    id: string;
    mosaicId?: string | null;
    dsoId: string | null;
    ra: number | null;
    dec: number | null;
  }>,
  dsoId: string | null,
  center: { ra: number; dec: number },
  cols: number,
  rows: number,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
): string[] {
  const { wDeg, hDeg } = outlineFromGrid(cols, rows, tileWDeg, tileHDeg, overlapPct);
  const reach = Math.max(wDeg, hDeg) / 2;
  return entries
    .filter((e) => {
      if (e.mosaicId) return false;
      if (dsoId && e.dsoId === dsoId) return true;
      const ed = e.dsoId ? getDSOById(e.dsoId) : null;
      const era = e.ra ?? ed?.ra;
      const edec = e.dec ?? ed?.dec;
      if (era == null || edec == null) return false;
      return angularSeparationDeg(center.ra, center.dec, era, edec) <= reach;
    })
    .map((e) => e.id);
}
