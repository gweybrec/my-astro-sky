/**
 * Area-weighted star magnitude gate, extracted from `sky-map.ts` so the density
 * maths can be unit-tested without a canvas.
 *
 * The stereographic projection is conformal but not equal-area, so a magnitude cap
 * applied uniformly would crowd the map centre and leave the rim near-empty. Instead
 * the *count* is the cap: a pan-invariant global eligible count ({@link starAreaBudget})
 * scaled at each position by the local projection area factor ({@link starFaintLimitAt}),
 * which makes on-screen star density uniform at every density level and every zoom.
 *
 * See `render-budget.ts` for the underlying primitives and the reasoning behind them.
 */
import type { ViewState } from './types';
import { borderRadiusPU, projectionAreaFactor } from './projection';
import {
  targetRenderCount,
  magThresholdForCount,
  STAR_DENSITY_K,
  MIN_BUDGET_MULT,
  STAR_BRIGHT_FLOOR_MAG,
  areaNormForBorderRadius,
  areaWeightedBudget,
} from './render-budget';

/**
 * Shared budget context for the area-weighted star gate. `count` is the pan-invariant
 * global eligible count; the per-star limit then scales it by the local projection area
 * factor so on-screen star density is uniform despite the projection's area distortion.
 */
export interface StarAreaBudget {
  mags: number[];
  count: number;
  aNorm: number;
  edgeMag: number;
}

/**
 * Build the budget context for the current view.
 *
 * `budget` is the effective star-count budget (the density slider value, already
 * reduced by the interaction LOD); `mags` is the catalog's magnitudes sorted
 * ascending (brightest first).
 */
export function starAreaBudget(
  view: ViewState,
  borderLatDeg: number,
  budget: number,
  mags: number[],
): StarAreaBudget {
  const { scale, width, height } = view;
  // Upper bound is the catalog length, not an artificial cap: on-screen count is
  // already bounded by the field of view, so when zoomed in the magnitude gate
  // (not a count cap) decides how faint we go.
  const count = targetRenderCount(
    budget,
    scale,
    width,
    height,
    STAR_DENSITY_K,
    budget * MIN_BUDGET_MULT,
    mags.length,
  );
  const aNorm = areaNormForBorderRadius(borderRadiusPU(borderLatDeg));
  // Faintest limit anywhere on the map: at the rim the local area factor equals aNorm²
  // so the local count is count·aNorm. Used as a cheap pre-filter before projecting, and
  // as the single atlas/paint maxMag so edge-fill stars share sprites and don't fade.
  // NOTE: no separate zoom/faintness cap (computeMaxMag) is applied. A single magnitude
  // cap applied uniformly would clamp the edge — which needs *fainter* stars than the
  // centre to reach the same on-screen density — long before the centre, so raising the
  // density budget would pile new stars into the centre and never fill the edge
  // ("outside-in", not uniform). The area-weighted count IS the cap, and it already
  // scales with zoom because count ∝ scale² (targetRenderCount).
  const edgeMag = magThresholdForCount(mags, Math.round(count * aNorm));
  return { mags, count, aNorm, edgeMag };
}

/**
 * Per-position faint magnitude limit: brighter (fewer stars) near the map centre,
 * fainter (more) toward the edge, so on-screen star density stays uniform under the
 * non-equal-area stereographic projection — at every density level. Floored at
 * STAR_BRIGHT_FLOOR_MAG so the brightest anchor stars always render.
 *
 * `px`/`py` are projection-unit coordinates (not canvas pixels).
 */
export function starFaintLimitAt(px: number, py: number, b: StarAreaBudget): number {
  const A = projectionAreaFactor(px, py);
  const localCount = Math.round(areaWeightedBudget(b.count, A, b.aNorm));
  return Math.max(magThresholdForCount(b.mags, localCount), STAR_BRIGHT_FLOOR_MAG);
}

/**
 * Position-independent star magnitude limit (the un-weighted budget threshold). Used
 * where a single scalar is enough — star-label gating and the hover index's mag cap.
 * The precise per-position gate the render loop applies is {@link starFaintLimitAt}.
 */
export function starMagThreshold(b: StarAreaBudget): number {
  return Math.max(magThresholdForCount(b.mags, b.count), STAR_BRIGHT_FLOOR_MAG);
}
