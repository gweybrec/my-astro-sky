/**
 * Pure canvas geometry for interactive FOV frames, extracted from `sky-map.ts` so
 * it can be unit-tested against a real projection without a canvas context. Every
 * function is a pure function of a frame plus the live {@link ViewState}: it resolves
 * a frame's anchor, rotation, corners and (for mosaics) tangent-plane outline into
 * canvas pixels. SkyMap keeps one-line delegating wrappers that pass `this.view`.
 *
 * Distinct from `fov-frame-geometry.ts`, which holds the projection-independent
 * hit-testing primitives (distance-to-segment, handle proximity, corner resize).
 */
import type { Point, ViewState } from './types';
import type { RenderableFrame } from './sky-map';
import { project, toCanvas, fromCanvas, unproject } from './projection';
import { framePointToSky } from './mosaic';
import { paToCanvasRotationDeg, canvasRotationToPaDeg } from './frame-orientation';
import { angularSizeToCanvasPx } from './dso-render-math';

const DEG2RAD = Math.PI / 180;

/** Resolved canvas geometry of a frame: corners plus centre, rotation and half-extents. */
export interface FrameGeometry {
  corners: Point[];
  cx: number;
  cy: number;
  rotDeg: number;
  halfW: number;
  halfH: number;
}

/**
 * Rotates a rectangle of half-dimensions (halfWPx × halfHPx) centred at (cx, cy)
 * by rotationDeg and returns the 4 corners clockwise from top-left.
 */
export function computeFovFrameCorners(
  halfWPx: number,
  halfHPx: number,
  cx: number,
  cy: number,
  rotationDeg: number,
): Point[] {
  const angle = rotationDeg * DEG2RAD;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const raw: Point[] = [
    { x: -halfWPx, y: -halfHPx },
    { x:  halfWPx, y: -halfHPx },
    { x:  halfWPx, y:  halfHPx },
    { x: -halfWPx, y:  halfHPx },
  ];
  return raw.map(p => ({
    x: cx + p.x * cosA - p.y * sinA,
    y: cy + p.x * sinA + p.y * cosA,
  }));
}

/** Canvas centre for a frame instance (resolved from its anchor + live view). */
export function frameAnchorCanvas(f: RenderableFrame, view: ViewState): { cx: number; cy: number } {
  if (f.anchorKind === 'sky') {
    const p = project(f.ra ?? 0, f.dec ?? 0);
    const c = toCanvas(p.x, p.y, view);
    return { cx: c.x, cy: c.y };
  }
  return { cx: (f.nx ?? 0.5) * view.width, cy: (f.ny ?? 0.5) * view.height };
}

/**
 * Canvas rotation (deg) of a pinned frame for a given position angle. The frame's
 * *up* (top edge) must point to celestial north at PA 0°, so we add 90° to the DSO
 * major-axis angle (local +x). Wraps {@link paToCanvasRotationDeg}.
 */
export function paToCanvasRotDeg(paDeg: number, raDeg: number, view: ViewState): number {
  return paToCanvasRotationDeg(paDeg, raDeg, view.rotationDeg);
}

/** Inverse of {@link paToCanvasRotDeg}: recover PA (°E of N) from a canvas rotation. */
export function canvasRotDegToPa(rotDeg: number, raDeg: number, view: ViewState): number {
  return canvasRotationToPaDeg(rotDeg, raDeg, view.rotationDeg);
}

/** Canvas rotation (deg) for a frame instance. */
export function frameCanvasRotationDeg(f: RenderableFrame, view: ViewState): number {
  if (f.anchorKind === 'sky') {
    return paToCanvasRotDeg(f.paDeg ?? 0, f.ra ?? 0, view);
  }
  return f.screenRotationDeg ?? 0;
}

export function frameGeometry(f: RenderableFrame, view: ViewState): FrameGeometry {
  // A mosaic outline hugs its tiles exactly via tangent-plane (gnomonic) geometry.
  // The same geometry is used whether it's pinned or floating (centre and PA are
  // derived from the anchor either way), so the pin/float toggle is continuous — no
  // jump — and shares the standard frame code.
  if (f.isMosaicOutline) {
    const g = mosaicOutlineGeometry(f, view);
    if (g) return g;
  }
  const { cx, cy } = frameAnchorCanvas(f, view);
  const decForSize = f.anchorKind === 'sky' ? (f.dec ?? 0) : unproject(view.centerX, view.centerY).dec;
  const halfW = angularSizeToCanvasPx(f.wDeg * 30, decForSize, view.scale);
  const halfH = angularSizeToCanvasPx(f.hDeg * 30, decForSize, view.scale);
  const rotDeg = frameCanvasRotationDeg(f, view);
  const corners = computeFovFrameCorners(halfW, halfH, cx, cy, rotDeg);
  return { corners, cx, cy, rotDeg, halfW, halfH };
}

/**
 * Sky centre + position angle of a mosaic outline. Pinned: the stored centre and PA.
 * Floating: the sky point under its screen anchor and the PA that reproduces its
 * screen rotation there — so the gnomonic geometry is continuous as the pin toggles.
 */
export function mosaicCenterPa(
  f: RenderableFrame, view: ViewState,
): { center: { ra: number; dec: number }; paDeg: number } | null {
  if (f.anchorKind === 'sky') {
    if (f.ra == null || f.dec == null) return null;
    return { center: { ra: f.ra, dec: f.dec }, paDeg: f.paDeg ?? 0 };
  }
  const { cx, cy } = frameAnchorCanvas(f, view);
  const proj = fromCanvas(cx, cy, view);
  const center = unproject(proj.x, proj.y);
  return { center, paDeg: canvasRotDegToPa(f.screenRotationDeg ?? 0, center.ra, view) };
}

/**
 * Handle geometry of a mosaic outline: its four region corners (the exact
 * tangent-plane corners that {@link mosaicOutlinePath} draws to, so handles sit on
 * the outline), plus centre, rotation and local half-extents.
 */
export function mosaicOutlineGeometry(f: RenderableFrame, view: ViewState): FrameGeometry | null {
  const cp = mosaicCenterPa(f, view);
  if (!cp) return null;
  const halfW = f.wDeg / 2, halfH = f.hDeg / 2;
  const corner = (gx: number, gy: number): Point => {
    const s = framePointToSky(cp.center, cp.paDeg, gx, gy);
    const p = project(s.ra, s.dec);
    return toCanvas(p.x, p.y, view);
  };
  // gy+ is "up" (frame north), which is computeFovFrameCorners' −y, so these map
  // to its clockwise-from-top-left corner order.
  const corners = [corner(-halfW, halfH), corner(halfW, halfH), corner(halfW, -halfH), corner(-halfW, -halfH)];
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const rotDeg = frameCanvasRotationDeg(f, view);
  const a = rotDeg * DEG2RAD, cos = Math.cos(a), sin = Math.sin(a);
  let minL = Infinity, maxL = -Infinity, minM = Infinity, maxM = -Infinity;
  for (const p of corners) {
    const l = p.x * cos + p.y * sin, m = -p.x * sin + p.y * cos;
    minL = Math.min(minL, l); maxL = Math.max(maxL, l);
    minM = Math.min(minM, m); maxM = Math.max(maxM, m);
  }
  return { corners, cx, cy, rotDeg, halfW: (maxL - minL) / 2, halfH: (maxM - minM) / 2 };
}

/**
 * Outline polyline of a mosaic: the boundary of its tangent-plane region, sampled
 * and projected so it follows the exact same geometry as the tiles (they share the
 * placement math). Curves with the projection just like the grid does — unlike a
 * straight corner-to-corner rectangle.
 */
export function mosaicOutlinePath(f: RenderableFrame, view: ViewState): Point[] | null {
  const cp = mosaicCenterPa(f, view);
  if (!cp) return null;
  const { center, paDeg } = cp;
  const halfW = f.wDeg / 2, halfH = f.hDeg / 2;
  const N = 16; // samples per edge — enough to render the curvature smoothly
  const pts: Point[] = [];
  const add = (gx: number, gy: number) => {
    const s = framePointToSky(center, paDeg, gx, gy);
    const p = project(s.ra, s.dec);
    pts.push(toCanvas(p.x, p.y, view));
  };
  for (let i = 0; i <= N; i++) add(-halfW + (2 * halfW * i) / N, halfH);   // top
  for (let i = 1; i <= N; i++) add(halfW, halfH - (2 * halfH * i) / N);    // right
  for (let i = 1; i <= N; i++) add(halfW - (2 * halfW * i) / N, -halfH);   // bottom
  for (let i = 1; i < N; i++) add(-halfW, -halfH + (2 * halfH * i) / N);   // left
  return pts;
}

/** Handles (rotation needle, pin, centre dot) are shown only while the frame is
 * large enough that its centre dot isn't crowding the edges. */
export function frameHandlesVisible(halfW: number, halfH: number): boolean {
  return Math.min(halfW, halfH) >= 12;
}

/** Canvas position of the pushpin glyph, lifted just above a frame corner. */
export function framePinGlyphPos(corner: Point, rotDeg: number): Point {
  const ang = rotDeg * DEG2RAD;
  const margin = 14; // half icon (8) + a few px gap
  return { x: corner.x + Math.sin(ang) * margin, y: corner.y - Math.cos(ang) * margin };
}
