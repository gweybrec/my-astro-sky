/**
 * Mapping between the density sliders' raw position and the actual star/DSO density
 * budget fed to the renderer (see render-budget.ts).
 *
 * The slider is non-linear (ease-in / exponential): moving left from the maximum drops
 * the budget rapidly (coarse), and the change becomes gentle near the bottom (fine), so
 * low densities are easy to fine-tune while the top of the slider spans a very wide,
 * sparsely-needed range. The maximum budget is a fixed, unlabelled bound — the user sees
 * only the thumb position, not a number. At the maximum, DSOs/stars cover the whole map.
 *
 * Curve: budget = max · (e^{k·u} − 1) / (e^k − 1), with u = pos / SLIDER_STEPS.
 * This hits 0 at u=0 and `max` at u=1; `k` controls how steep the top is. With k=3 and
 * max=5000 the thumb steps roughly 5000 → 3600 → 2600 → 1900 → 1300 → 900 … from right
 * to left.
 */

/** Hard upper bounds for the density budgets (not shown to the user). */
export const STAR_DENSITY_MAX = 5000;
export const DSO_DENSITY_MAX = 5000;

/**
 * Fixed star budget used in auto mode: enough to draw the constellation figures and the
 * bright naming stars, kept constant so the star field never pops while moving/zooming.
 * In auto mode the DSO budget is the performance lever (auto-tuned) and stars stay put.
 */
export const AUTO_STAR_BUDGET = 250;

/** Raw <input type="range"> resolution: position runs 0..SLIDER_STEPS. */
export const SLIDER_STEPS = 1000;

/** Curvature: higher = steeper near the max (more rapid change there). */
const CURVE_K = 3;
const EXP_K = Math.exp(CURVE_K);

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Raw slider position (0..SLIDER_STEPS) → density budget. Exponential ease-in: steep
 * near u=1 (coarse, rapid change), shallow near u=0 (fine).
 */
export function sliderPosToBudget(pos: number, max: number): number {
  const u = clamp01(pos / SLIDER_STEPS);
  return Math.round((max * (Math.exp(CURVE_K * u) - 1)) / (EXP_K - 1));
}

/** Inverse: density budget → raw slider position (0..SLIDER_STEPS). */
export function budgetToSliderPos(budget: number, max: number): number {
  const b = clamp01(budget / max);
  const u = Math.log(1 + b * (EXP_K - 1)) / CURVE_K;
  return Math.round(u * SLIDER_STEPS);
}

/**
 * First-launch density guess from a rough hardware-capability score. This is only a
 * starting point for the very first render — once the map renders, the auto-density
 * controller (see SkyMap.adaptAutoDensity) measures real frame time and converges on
 * the right budget for the machine, so this just keeps the first impression reasonable.
 *
 * The score blends CPU cores and RAM (each saturating well before the high end) and
 * halves it on mobile. It maps onto modest budgets — deliberately conservative, since
 * over-shooting the first frame is more jarring than starting a touch sparse.
 *
 * Pure (no `navigator`) so it is unit-testable; see {@link detectInitialDensity}.
 */
export function estimateInitialDensity(cores: number, memGB: number, mobile: boolean): { star: number; dso: number } {
  const coreScore = clamp01((cores - 2) / (12 - 2)); // 2 cores → 0, 12+ → 1
  const memScore = clamp01((memGB - 2) / (16 - 2));   // 2 GB → 0, 16+ → 1
  let score = 0.5 * coreScore + 0.5 * memScore;
  if (mobile) score *= 0.4;
  const lerp = (lo: number, hi: number) => Math.round(lo + (hi - lo) * score);
  return { star: lerp(600, 3500), dso: lerp(250, 1500) };
}

/** {@link estimateInitialDensity} wired to the runtime's hardware hints. */
export function detectInitialDensity(): { star: number; dso: number } {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  const cores = nav.hardwareConcurrency || 4;
  const memGB = nav.deviceMemory || 4;
  const mobile = nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || '');
  return estimateInitialDensity(cores, memGB, mobile);
}
