/**
 * Pure cursor hit-testing for DSOs, extracted from `sky-map.ts` so the "which DSO is
 * under the cursor" decision can be unit-tested. SkyMap queries its spatial index for
 * nearby candidates and the live view; this function makes the final choice.
 */
import type { DSO, ViewState } from './types';
import { project, toCanvas, fromCanvas } from './projection';
import { angularSizeToCanvasPx } from './dso-render-math';

/**
 * Pick the DSO under (mx, my) from a set of nearby `candidates`:
 *   1. Among those whose rendered ellipse *contains* the cursor, prefer the smallest
 *      (so a compact inner object wins over a large encompassing one, e.g. inside M42).
 *   2. Otherwise fall back to the nearest centre within a tight ~20px threshold.
 * Returns null when nothing qualifies. Pixel-identical to the old inline logic.
 */
export function pickDsoAtCursor(
  candidates: DSO[], mx: number, my: number, view: ViewState,
): DSO | null {
  if (candidates.length === 0) return null;
  const projPt = fromCanvas(mx, my, view);
  const { scale } = view;

  const contained: DSO[] = [];
  for (const dso of candidates) {
    const majorArcmin = dso.majAxis ?? 1;
    const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, scale));
    const dsoProj = project(dso.ra, dso.dec);
    const dsoCanvas = toCanvas(dsoProj.x, dsoProj.y, view);
    const dx = dsoCanvas.x - mx;
    const dy = dsoCanvas.y - my;
    if (Math.sqrt(dx * dx + dy * dy) <= rx) contained.push(dso);
  }

  if (contained.length > 0) {
    contained.sort((a, b) => (a.majAxis ?? 1) - (b.majAxis ?? 1));
    return contained[0];
  }

  // Fallback: nearest centre within the original tight threshold.
  const tightThreshold = 20 / scale;
  for (const dso of candidates) {
    const dsoProj = project(dso.ra, dso.dec);
    const dx = dsoProj.x - projPt.x;
    const dy = dsoProj.y - projPt.y;
    if (Math.sqrt(dx * dx + dy * dy) <= tightThreshold) return dso;
  }

  return null;
}
