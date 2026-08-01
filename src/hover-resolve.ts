/**
 * Pure hover-target resolution, extracted from `sky-map.ts`.
 *
 * Two rules live here and neither was previously testable:
 *
 * 1. **Winner selection** — the nearest *rendered* object under the cursor wins.
 *    Objects that were found in the spatial index but are gated out of the current
 *    render pass do not count, so a tooltip never fires for something the user
 *    cannot see. A summit dot wins ties (they sit on the horizon where stars/DSOs
 *    are sparse, but a genuinely closer star still beats one).
 *
 * 2. **Sky-drift grace** — in date mode the whole sky rotates as the clock advances,
 *    so an object drifts out from under a stationary cursor and the next mousemove
 *    hit-tests empty sky. Dismissing then would drop a tooltip the user is still
 *    reading. Instead we keep it when the sky has advanced *and* the cursor is still
 *    within jitter range, refreshing the anchor each frame so the tolerance is
 *    per-frame rather than a cumulative budget spent over a long hold.
 *
 * Distances are in projection units (the same space the hit-tests measure in), so
 * they are directly comparable.
 */

/** Anchor of the currently-shown tooltip: where and when it was last resolved. */
export interface HoverAnchor {
  mx: number;
  my: number;
  simMs: number;
}

/** A candidate under the cursor, with its distance in projection units. */
export interface HoverCandidate {
  /** False when the object is in the index but gated out of this render pass. */
  rendered: boolean;
  /** Distance from the cursor in projection units. */
  dist: number;
}

export interface HoverResolveInput {
  summit: HoverCandidate | null;
  star: HoverCandidate | null;
  dso: HoverCandidate | null;
  /** Cursor position in canvas px. */
  mx: number;
  my: number;
  /** Simulated clock (ms) for this hit-test. */
  simMs: number;
  /** Anchor of the tooltip currently shown, or null if none. */
  anchor: HoverAnchor | null;
  /** A stationary-cursor jitter is a move under this many canvas px from the anchor. */
  gracePx: number;
}

/**
 * What the caller should do with the tooltip.
 *
 * - `summit` / `star` / `dso` — show that object's tooltip and adopt `anchor`.
 * - `keep`  — leave the tooltip as-is (sky drifted under a still cursor) and adopt
 *   the refreshed `anchor`.
 * - `dismiss` — hide the tooltip and clear the anchor.
 */
export type HoverResolution =
  | { kind: 'summit' | 'star' | 'dso'; anchor: HoverAnchor }
  | { kind: 'keep'; anchor: HoverAnchor }
  | { kind: 'dismiss' };

export function resolveHover(input: HoverResolveInput): HoverResolution {
  const { summit, star, dso, mx, my, simMs, anchor, gracePx } = input;

  // Unrendered candidates are treated as infinitely far, so they can never win.
  const summitDist = summit ? summit.dist : Infinity;
  const starRendered = !!star?.rendered;
  const dsoRendered = !!dso?.rendered;
  const starDist = starRendered ? star!.dist : Infinity;
  const dsoDist = dsoRendered ? dso!.dist : Infinity;

  const here: HoverAnchor = { mx, my, simMs };

  if (summit && summitDist <= starDist && summitDist <= dsoDist) {
    return { kind: 'summit', anchor: here };
  }
  if (starRendered && dsoRendered) {
    return { kind: starDist < dsoDist ? 'star' : 'dso', anchor: here };
  }
  if (dsoRendered) return { kind: 'dso', anchor: here };
  if (starRendered) return { kind: 'star', anchor: here };

  // Nothing rendered under the cursor — apply the sky-drift grace (see file header).
  const skyMoved = anchor !== null && simMs !== anchor.simMs;
  const cursorStill = anchor !== null && Math.hypot(mx - anchor.mx, my - anchor.my) <= gracePx;
  if (skyMoved && cursorStill) return { kind: 'keep', anchor: here };

  return { kind: 'dismiss' };
}
