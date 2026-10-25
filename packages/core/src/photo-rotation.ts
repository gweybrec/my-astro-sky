import type { ManualPlacement, PhotoCorrespondence, QuarterTurns } from './types';

/** What of a photo is measured in its pixels, and so changes when the picture is turned. */
export interface PhotoPixelFrame {
  width: number;
  height: number;
  correspondences: PhotoCorrespondence[];
  manualPlacement?: ManualPlacement | null;
}

/** How many quarters to the right a photo is shown turned (0 when it is not). */
export function quarterTurnsOf(photo: { quarterTurns?: number | null }): QuarterTurns {
  const turns = photo.quarterTurns;
  return turns === 1 || turns === 2 || turns === 3 ? turns : 0;
}

/**
 * The photo as it is shown: its picture file is never turned, only shown turned `quarterTurns` times, so a screen that
 * shows it flat works with this frame (size, matched stars, hand placement turned with the picture) and turns the
 * picture by `quarterTurns × 90°`. The result has no `quarterTurns`: it is not turned twice.
 */
export function photoAsShown<P extends PhotoPixelFrame & { quarterTurns?: QuarterTurns }>(
  photo: P,
): P {
  let shown = photo;
  for (let i = 0; i < quarterTurnsOf(photo); i++) shown = rotatePhotoRight(shown);
  const { quarterTurns: _turns, ...rest } = shown;
  return rest as P;
}

/**
 * A photo turned a quarter to the right (clockwise): the pixel (x, y) of a
 * W × H picture becomes (H − y, x) of an H × W one. The matched stars move with their pixels, so a solved photo
 * keeps its place on the sky; a hand placement keeps it by turning its angle back a quarter (forward with one
 * mirror, which reverses the turn). Points of interest and objects are on the sky and do not change.
 */
export function rotatePhotoRight<P extends PhotoPixelFrame>(photo: P): P {
  const { width: w, height: h } = photo;
  const placement = photo.manualPlacement;
  const mirrored = !!placement && placement.mirrorX !== placement.mirrorY;
  return {
    ...photo,
    width: h,
    height: w,
    correspondences: photo.correspondences.map((c) => ({
      ...c,
      photoX: h - c.photoY,
      photoY: c.photoX,
    })),
    manualPlacement: placement
      ? {
          ...placement,
          rotationDeg: normalizeDeg(placement.rotationDeg + (mirrored ? 90 : -90)),
        }
      : placement,
  };
}

/** An angle in (−180, 180]. */
function normalizeDeg(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}
