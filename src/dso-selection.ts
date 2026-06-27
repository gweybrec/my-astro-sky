/**
 * Pure, canvas-free helper that decides which DSOs to draw when the viewport
 * holds more than the render budget allows.
 *
 * The expensive parts of DSO selection are precomputed into the catalog at build
 * time (see scripts/add-ratings.mjs and scripts/generate-dso.mjs):
 *   - `priority`: a rating-weighted progressive blue-noise rank (lower = drawn
 *     first) that bakes in the on-sky spatial spread, so any top-N prefix is well
 *     distributed for any budget.
 *   - `containerId` + the container-size gate (applied by the caller before this
 *     helper runs) suppress inner objects until their container renders large
 *     enough on screen.
 *
 * So at runtime this collapses to: keep the highlighted object, then keep every
 * candidate whose `priority` is below a zoom-derived threshold. The threshold is a pure
 * function of zoom + canvas size (see render-budget.ts), NOT of the current viewport
 * contents, so DSOs never pop into a screen region that stays on screen while panning.
 */

/** Pixel radius a container must render at before its inner objects are shown. */
export const DSO_CONTAINER_VISIBLE_RADIUS_PX = 18;

export interface SelectableDSO {
  id: string;
  /** Precomputed render order; lower = drawn first. */
  priority: number;
  /** Highlighted/searched object — always kept, regardless of budget. */
  isHighlighted: boolean;
}

/**
 * Returns the candidates to render: the highlighted object (always) plus every
 * candidate whose `priority` is below `priorityThreshold`. Candidates must already be
 * viewport-culled, filter-passed, and container-gated by the caller. Input order is
 * preserved (no sort), and the test is per-candidate, so the result for a given
 * candidate never depends on what else is in view.
 */
export function selectDSOsToRender<T extends SelectableDSO>(candidates: T[], priorityThreshold: number): T[] {
  return candidates.filter(c => c.isHighlighted || c.priority < priorityThreshold);
}
