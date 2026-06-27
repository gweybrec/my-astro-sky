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
 * So at runtime this collapses to: keep the highlighted object, then take the
 * lowest-`priority` candidates up to the budget.
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
 * Returns the candidates to render, capped at `maxCount`. Candidates must already
 * be viewport-culled, filter-passed, and container-gated by the caller.
 */
export function selectDSOsToRender<T extends SelectableDSO>(candidates: T[], maxCount: number): T[] {
  if (candidates.length <= maxCount) return candidates;
  return candidates
    .slice()
    .sort((a, b) => {
      if (a.isHighlighted !== b.isHighlighted) return a.isHighlighted ? -1 : 1; // pin highlighted first
      return a.priority - b.priority;                                            // precomputed blue-noise order
    })
    .slice(0, maxCount);
}
