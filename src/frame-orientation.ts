import { dsoCanvasAngleForHighlight, canvasAngleToPADeg } from './dso-highlight';

const DEG2RAD = Math.PI / 180;

/**
 * Orientation math for interactive FOV frames. A pinned frame stores its
 * rotation as a position angle (PA, °E of celestial north). Its on-screen
 * rotation depends on where north points in the projection at the frame's RA,
 * so these helpers convert between the two — and let a position drag preserve
 * the frame's *visible* orientation (recompute the PA at the new RA) instead of
 * letting the frame spin to stay north-aligned.
 *
 * The +90° offset orients the frame's top edge to north: the underlying
 * highlight angle orients a DSO's major axis (local +x), which is 90° from up.
 */

/** Canvas rotation (deg) that displays PA `paDeg` at `raDeg` under map rotation `viewRotationDeg`. */
export function paToCanvasRotationDeg(
  paDeg: number,
  raDeg: number,
  viewRotationDeg: number,
): number {
  return dsoCanvasAngleForHighlight(paDeg, raDeg, viewRotationDeg) / DEG2RAD + 90;
}

/** Inverse of {@link paToCanvasRotationDeg}: recover PA (°E of N, normalised [0,360)). */
export function canvasRotationToPaDeg(
  rotDeg: number,
  raDeg: number,
  viewRotationDeg: number,
): number {
  return canvasAngleToPADeg((rotDeg - 90) * DEG2RAD, raDeg, viewRotationDeg);
}

/**
 * Format a position angle for display: round to whole degrees and wrap into
 * [0, 360) so a value that rounds up to 360° reads as 0° (they are the same).
 */
export function formatPaDeg(paDeg: number): string {
  return `${((Math.round(paDeg) % 360) + 360) % 360}°`;
}
