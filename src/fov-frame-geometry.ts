/**
 * Pure geometry helpers for interactive FOV frames (selection / move / rotate).
 *
 * Kept separate from `sky-map.ts` (which is excluded from unit-test coverage as
 * DOM/canvas code) so the hit-testing and rotation maths can be unit-tested.
 *
 * Rotation convention matches `computeFovFrameCorners` in sky-map: a frame's
 * local axes map to canvas via the rotation matrix with `angle = rotationDeg`,
 * so local +x → (cos, sin) and local −y ("up") → (sin, −cos).
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface Pt {
  x: number;
  y: number;
}

/** Shortest distance from point (px,py) to segment a→b. */
export function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Minimum distance from a point to any edge of a closed polygon. */
export function minDistToPolygonEdges(px: number, py: number, pts: Pt[]): number {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    min = Math.min(min, distToSegment(px, py, a, b));
  }
  return min;
}

/** True if (px,py) lies within `threshold` px of any polygon edge. */
export function isNearPolygonBorder(px: number, py: number, pts: Pt[], threshold: number): boolean {
  return minDistToPolygonEdges(px, py, pts) <= threshold;
}

/** True if (px,py) is within `radius` px of handle position `h`. */
export function isNearHandle(px: number, py: number, h: Pt, radius: number): boolean {
  return Math.hypot(px - h.x, py - h.y) <= radius;
}

/**
 * Canvas position of a frame's rotate handle: pushed `distPx` beyond the frame
 * centre along the frame's local "up" (−y) direction, for the given canvas
 * rotation in degrees.
 */
export function rotateHandlePos(cx: number, cy: number, halfHPx: number, rotationDeg: number, distPx = 24): Pt {
  const angle = rotationDeg * DEG2RAD;
  const up = halfHPx + distPx; // local point (0, -up)
  return {
    x: cx + up * Math.sin(angle),
    y: cy - up * Math.cos(angle),
  };
}

/**
 * Recover the canvas rotation (degrees) such that the rotate handle points at
 * the cursor — the inverse of {@link rotateHandlePos}. Local "up" (sin θ, −cos θ)
 * must align with (mx−cx, my−cy), giving θ = atan2(dx, −dy).
 */
export function canvasRotationDegFromCursor(cx: number, cy: number, mx: number, my: number): number {
  return Math.atan2(mx - cx, -(my - cy)) * RAD2DEG;
}
