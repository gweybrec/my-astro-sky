/**
 * Pan-invariant render budget for stars and DSOs.
 *
 * The old renderer selected the top-N objects *within the current screen rectangle*,
 * so the effective cutoff was "the magnitude / priority of the Nth object on screen
 * right now". That cutoff depended on what else was in the viewport, so panning the
 * dense centre of the sky off-screen shifted the cutoff and made objects pop into the
 * part of the screen that had not moved.
 *
 * Instead we render an object iff it is among the brightest / highest-priority
 * `targetRenderCount` objects *globally*. The target depends only on zoom (`scale`) and
 * canvas size — never on pan — so nothing appears or disappears in a screen region that
 * stays on screen. Because the on-screen count ≈ globalEligible × (screenArea / skyArea)
 * and screenArea ∝ 1/scale², the two scale² factors cancel and the on-screen density
 * stays ≈ the budget at every zoom over an average-density region (denser over the Milky
 * Way, sparser over empty sky — the accepted planetarium-like trade-off).
 *
 * The user-facing "density" sliders feed their value in as `budget`.
 */

/**
 * Calibration constant linking the density `budget` to the global eligible count.
 * Tuned in-browser so the on-screen count ≈ the slider value over an average region
 * (see docs in the plan / verification step). Stars and DSOs are tuned independently
 * because their on-sky distributions differ.
 */
export const STAR_DENSITY_K = 6;
export const DSO_DENSITY_K = 6;

/**
 * Lower clamp as a multiple of the budget: when fully zoomed out the whole visible
 * hemisphere should still show roughly `budget` objects, so the global eligible count
 * must not collapse toward zero (the scale² model over-estimates the visible sky
 * fraction once the view exceeds the border disk). ~2× budget ≈ one hemisphere's worth.
 */
export const MIN_BUDGET_MULT = 2;

/**
 * Bright-anchor magnitude floor for the area-weighted star gate: stars at least this
 * bright are always drawn regardless of the position weighting, so the brightest,
 * most-recognisable anchor stars never disappear from the thinned map centre. It is set
 * low (only the ~brightest few hundred stars) on purpose — a high floor (e.g. the
 * naked-eye limit ~6) would force the crowded centre to draw the whole naked-eye field
 * and defeat the thinning, leaving the centre as dense as before. Constellation *lines*
 * are drawn from RA/Dec independently of this loop, so they are unaffected either way;
 * only the field-star dots between the anchors are redistributed toward the edge.
 */
export const STAR_BRIGHT_FLOOR_MAG = 3;

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Area-normalisation for the area-weighted render budget (see {@link areaWeightedBudget}).
 *
 * project() is stereographic — conformal but NOT equal-area — so a set of objects that
 * is uniform per steradian renders crowded at the map centre and near-empty at the rim.
 * Multiplying each object's cutoff by `projectionAreaFactor(x,y) / AREA_NORM` instead
 * draws uniformly per unit *screen* area (fewer near centre, more toward the edge),
 * cancelling that distortion without touching the projection or the constellations.
 *
 * `AREA_NORM` is chosen as the mean area factor over the visible cap so the *total*
 * on-screen count stays ≈ the un-weighted budget (centre thins, edge fills, sum
 * preserved). For the stereographic factor (1+r²)² that cap-mean works out in closed
 * form to `sec²(θmax/2) = 1 + r_border²`, where `r_border = borderRadiusPU(borderLatDeg)`
 * — so it is exactly `1 + borderRadiusPU²` and auto-tracks the border slider. Its
 * absolute value only sets the overall count level (which the density slider /
 * auto-density absorb); the per-object factor is what makes the density uniform.
 */
export function areaNormForBorderRadius(borderRadiusPU: number): number {
  if (!isFinite(borderRadiusPU) || borderRadiusPU <= 0) return 1;
  return 1 + borderRadiusPU * borderRadiusPU;
}

/**
 * Area-weighted local budget/threshold: scale a base render `count` / priority
 * threshold by the local projection area factor, normalised by {@link areaNormForBorderRadius}.
 * Returns a float — star callers round it for a `magThresholdForCount` index; DSO
 * callers compare a priority against it directly. Falls back to `base` if `areaNorm`
 * is non-positive.
 */
export function areaWeightedBudget(base: number, areaFactor: number, areaNorm: number): number {
  if (areaNorm <= 0) return base;
  return (base * areaFactor) / areaNorm;
}

/**
 * Global eligible-object count for the current zoom and canvas size. Pure function of
 * `budget`, `scale`, `width`, `height` — independent of pan, so the resulting threshold
 * never shifts while panning at a fixed zoom.
 */
export function targetRenderCount(
  budget: number,
  scale: number,
  width: number,
  height: number,
  k: number,
  min: number,
  max: number,
): number {
  if (budget <= 0 || width <= 0 || height <= 0) return 0;
  const raw = (budget * scale * scale * k) / (width * height);
  return clamp(Math.round(raw), min, max);
}

/**
 * Magnitude cutoff for a given eligible `count`: the magnitude of the `count`-th
 * brightest star, looked up in the catalog magnitudes sorted ascending (brightest
 * first). A star renders iff `star.mag <= magThresholdForCount(...)`.
 *
 * - `count <= 0`            → -Infinity (show nothing).
 * - `count >= length`      → the faintest magnitude (show all).
 * - otherwise              → `sortedMagsAsc[count - 1]`.
 */
export function magThresholdForCount(sortedMagsAsc: number[], count: number): number {
  const n = sortedMagsAsc.length;
  if (n === 0 || count <= 0) return -Infinity;
  if (count >= n) return sortedMagsAsc[n - 1];
  return sortedMagsAsc[count - 1];
}
