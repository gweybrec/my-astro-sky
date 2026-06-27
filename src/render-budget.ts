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

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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
