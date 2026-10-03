import type { ViewState } from './types';
import { paToCanvasAngle, canvasAngleToPa } from './sky-axes';

const DEG2RAD = Math.PI / 180;

/**
 * Orientation math for interactive FOV frames. A pinned frame stores its rotation as a
 * position angle (PA, °E of celestial north). Its on-screen rotation depends on where
 * north points in the projection at the frame's position, so these helpers convert
 * between the two — and let a position drag preserve the frame's *visible* orientation
 * (recompute the PA at the new position) instead of letting the frame spin to stay
 * north-aligned.
 *
 * The +90° offset orients the frame's top edge to north: `computeFovFrameCorners` maps
 * local "up" (−y) to the canvas angle `rotationDeg − 90`, so a frame whose top edge must
 * point along the PA direction has `rotationDeg = paCanvasAngle + 90`.
 *
 * Both helpers take the frame's `decDeg` and the live view because the screen direction of
 * north is a property of the *active* projection, not a closed form in RA — see
 * `sky-axes.ts`. In the Local Sky (zenith) view north is rotated by the parallactic angle,
 * which depends on the frame's declination and the observer, so the old RA-only formula
 * could not express it.
 */

/** Canvas rotation (deg) that displays PA `paDeg` for a frame centred at (raDeg, decDeg). */
export function paToCanvasRotationDeg(
  paDeg: number,
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'rotationDeg'>,
): number {
  return paToCanvasAngle(paDeg, raDeg, decDeg, view) / DEG2RAD + 90;
}

/** Inverse of {@link paToCanvasRotationDeg}: recover PA (°E of N, normalised [0,360)). */
export function canvasRotationToPaDeg(
  rotDeg: number,
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'rotationDeg'>,
): number {
  return canvasAngleToPa((rotDeg - 90) * DEG2RAD, raDeg, decDeg, view);
}

/**
 * Format a position angle for display: round to whole degrees and wrap into
 * [0, 360) so a value that rounds up to 360° reads as 0° (they are the same).
 */
export function formatPaDeg(paDeg: number): string {
  return `${((Math.round(paDeg) % 360) + 360) % 360}°`;
}
