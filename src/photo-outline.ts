/**
 * Pure geometry for photo outlines on the sky map: convex-polygon hit-testing
 * (which photo is under a click) and label placement along the longer edge.
 * Extracted from `sky-map.ts` so the maths is unit-testable without a canvas.
 */
import type { Point } from './types';

export interface PhotoOutline {
  name: string;
  corners: Point[];
}

/** Returns true if (px, py) is inside the convex polygon defined by pts (winding order irrelevant). */
export function pointInConvexPolygon(px: number, py: number, pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return sign !== 0;
}

/**
 * Returns 0 or 1: the index of the longer of the two adjacent edges of a
 * rectangular quad. Only two edges need checking since opposite sides are equal.
 */
export function photoLabelEdgeIndex(corners: Point[]): 0 | 1 {
  const len0 = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const len1 = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
  return len1 > len0 ? 1 : 0;
}

/**
 * Returns the canvas anchor point and rotation angle to render a label along
 * the given edge, flipping direction when the raw angle would be upside-down.
 */
export function photoLabelTransform(
  corners: Point[],
  edgeIdx: 0 | 1,
): { x: number; y: number; angle: number } {
  const p0 = corners[edgeIdx];
  const p1 = corners[(edgeIdx + 1) % corners.length];
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    // Flip and normalize so the result stays in [-π/2, π/2]
    const flipped = angle + Math.PI;
    return { x: p1.x, y: p1.y, angle: flipped > Math.PI ? flipped - 2 * Math.PI : flipped };
  }
  return { x: p0.x, y: p0.y, angle };
}

/** Topmost (last-drawn) photo whose outline contains (px, py), or null. */
export function findTopPhotoOutlineAtPoint(
  px: number,
  py: number,
  outlines: PhotoOutline[],
): string | null {
  for (let i = outlines.length - 1; i >= 0; i--) {
    if (pointInConvexPolygon(px, py, outlines[i].corners)) {
      return outlines[i].name;
    }
  }
  return null;
}
