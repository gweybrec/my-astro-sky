/**
 * Pure camera/view maths for the sky map, extracted from `sky-map.ts` so the
 * zoom-about-cursor anchoring and the navigate animation curve can be unit-tested
 * without a canvas. SkyMap owns the mutable `view` and the rAF loop; it calls these
 * to compute the next view values.
 */
import type { ViewState } from './types';
import { fromCanvas } from './projection';

/** easeInOutCubic on t∈[0,1]. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Adaptive navigate duration (ms): a floor of 300ms, plus more time for a longer
 * pan (`normalizedDist`∈[0,1]) and for a larger zoom change (`zoomRatio`≥1),
 * clamped to 1200ms. Mirrors the original formula exactly.
 */
export function navigateDurationMs(normalizedDist: number, zoomRatio: number): number {
  return Math.max(300, Math.min(1200,
    300 + normalizedDist * 600 + Math.log2(Math.max(1, zoomRatio)) * 200,
  ));
}

/** Distance/zoom inputs for {@link navigateDurationMs} from a start view + target. */
export function navigateProfile(
  view: ViewState, targetX: number, targetY: number, targetScale: number,
): { normalizedDist: number; zoomRatio: number } {
  const dx = targetX - view.centerX;
  const dy = targetY - view.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const viewExtent = Math.max(view.width, view.height) / view.scale;
  const normalizedDist = Math.min(dist / Math.max(viewExtent, 0.001), 1);
  const zoomRatio = Math.max(targetScale / view.scale, view.scale / targetScale);
  return { normalizedDist, zoomRatio };
}

/** New scale + centre after a zoom by `factor` that keeps the projection point under
 * (mx, my) anchored beneath the cursor. Scale is clamped to [minScale, maxScale]. */
export function zoomAboutPoint(
  view: ViewState, mx: number, my: number, factor: number, minScale: number, maxScale: number,
): { scale: number; centerX: number; centerY: number } {
  const before = fromCanvas(mx, my, view);
  const scale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
  const after = fromCanvas(mx, my, { ...view, scale });
  return {
    scale,
    centerX: view.centerX + before.x - after.x,
    centerY: view.centerY + before.y - after.y,
  };
}
