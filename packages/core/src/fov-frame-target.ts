/**
 * Derive the target DSO of a plan-entry frame from the set of DSOs that fall
 * inside the frame. Pure (no canvas/Vue deps) so the rule is unit-testable in
 * isolation.
 *
 * Rule: the DSO nearest the frame centre wins; if no DSO is inside the frame the
 * entry is a "custom location" (null) — it keeps only its ra/dec, with no
 * catalogued object. There is deliberately no stickiness toward the previous
 * target: the object closest to the centre always wins, so a frame re-centred on
 * a new object adopts it even if the old target is still clipped in a corner.
 *
 * Note: when a frame is snapped to a DSO (the anchor toggle is on), the caller
 * saves that snapped object directly and does not consult this function — the
 * centre *is* the target by construction.
 *
 * @param dsosInFrameByDistance ids of DSOs inside the frame, sorted nearest-to-centre first
 */
export function frameTargetDso(dsosInFrameByDistance: string[]): string | null {
  return dsosInFrameByDistance[0] ?? null;
}
