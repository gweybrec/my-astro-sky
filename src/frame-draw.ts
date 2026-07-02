/**
 * Pure canvas painters for interactive FOV frames, extracted from `sky-map.ts`'s
 * `renderFovInstances` / `renderFovFrames`. Each takes resolved geometry + a color and
 * reads sizes/dashes from the {@link FRAME} tokens. The renderer keeps the per-frame
 * logic (which handles are visible, active/tile state) and calls these. Not unit-tested
 * (canvas), but isolating them shrinks the renderer and removes the last hardcoded
 * frame colors/sizes. Behavior is byte-identical to the old inline code.
 */
import type { Point } from './types';
import { photoLabelEdgeIndex, photoLabelTransform } from './photo-outline';
import { rotateHandlePos } from './fov-frame-geometry';
import { drawPinGlyph } from './sky-draw';
import { FRAME, FONTS } from './canvas-theme';

const DEG2RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** Stroke a closed polyline (frame outline / mosaic perimeter). Caller sets the style. */
export function drawFramePolyline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.stroke();
}

/** Draw a name label along the longest edge of a rectangle, kept upright. */
export function drawEdgeLabel(ctx: CanvasRenderingContext2D, corners: Point[], text: string, color: string): void {
  ctx.setLineDash([]);
  ctx.font = FONTS.frameLabel;
  ctx.fillStyle = color;
  const edgeIdx = photoLabelEdgeIndex(corners);
  const lbl = photoLabelTransform(corners, edgeIdx);
  ctx.save();
  ctx.translate(lbl.x, lbl.y);
  ctx.rotate(lbl.angle);
  ctx.fillText(text, 4, -5);
  ctx.restore();
}

export interface HandleFlags {
  movable: boolean;
  pinnable: boolean;
  resizable: boolean;
  /** Pin glyph filled when the frame is sky-anchored. */
  anchorSky: boolean;
}

export interface FrameHandleGeometry {
  corners: Point[];
  cx: number;
  cy: number;
  rotDeg: number;
  halfH: number;
}

/** Draw the active frame's handles: rotate needle + dot, move dot, pin glyph, corner squares. */
export function drawFrameHandles(
  ctx: CanvasRenderingContext2D, geo: FrameHandleGeometry, flags: HandleFlags, color: string, pinPos: Point,
): void {
  const ang = geo.rotDeg * DEG2RAD;
  const topMidX = geo.cx + geo.halfH * Math.sin(ang);
  const topMidY = geo.cy - geo.halfH * Math.cos(ang);
  const h = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, FRAME.rotateNeedleLen);
  ctx.strokeStyle = color;
  ctx.lineWidth = FRAME.lineWidth;
  ctx.beginPath();
  ctx.moveTo(topMidX, topMidY);
  ctx.lineTo(h.x, h.y);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(h.x, h.y, FRAME.handleRadius, 0, TWO_PI);
  ctx.fill();
  if (flags.movable) {
    // Move handle (centre dot).
    ctx.beginPath();
    ctx.arc(geo.cx, geo.cy, FRAME.moveDotRadius, 0, TWO_PI);
    ctx.fill();
  }
  if (flags.pinnable) {
    // Pin toggle glyph: pushpin lifted just above the top-right corner.
    drawPinGlyph(ctx, pinPos, flags.anchorSky, color);
  }
  if (flags.resizable) {
    // Corner resize handles (small squares) — drag to extend into a mosaic.
    ctx.fillStyle = color;
    for (const c of geo.corners) ctx.fillRect(c.x - FRAME.cornerHalf, c.y - FRAME.cornerHalf, FRAME.cornerHalf * 2, FRAME.cornerHalf * 2);
  }
}

/** Rubber-band preview of a drag-to-extend resize in progress. */
export function drawResizeDraftRect(ctx: CanvasRenderingContext2D, corners: Point[], color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = FRAME.lineWidth;
  ctx.setLineDash(FRAME.dashDraft);
  drawFramePolyline(ctx, corners);
  ctx.restore();
}

/**
 * Elastic snap line from the frame centre (cursor) to the pending DSO centre. It
 * tightens (brighter + thicker) as `tension` (0..1) approaches the break threshold,
 * and a ring marks the snap target.
 */
export function drawElasticSnapLine(
  ctx: CanvasRenderingContext2D, from: Point, to: Point, tension: number, color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.5 + 0.5 * tension;
  ctx.lineWidth = FRAME.elasticWidthBase + FRAME.elasticWidthTension * tension;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // Ring marking the snap target at the DSO centre.
  ctx.lineWidth = FRAME.lineWidth;
  ctx.beginPath();
  ctx.arc(to.x, to.y, FRAME.snapDotRadius, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}
