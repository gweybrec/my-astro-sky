/**
 * Pure DSO marker drawing, extracted from `sky-map.ts`'s `renderDSOs` switch. The
 * per-type look (shape, fill gradient, stroke, cross, inner ring) is data in
 * {@link DSO_MARKER_STYLES}; this walks that data. The caller sets up the transform
 * (translate to the DSO centre, rotate to its position angle, set globalAlpha) and
 * calls `drawDsoMarker` with the major/minor radii in pixels.
 *
 * Pixel-identical to the old inline `switch`: for an ellipse marker the body is drawn
 * with `scale(1, ry/rx)` around the pre-scaled `arc(0,0,rx)` and then unscaled; a
 * circle marker skips the scale.
 */
import type { DSOType } from './types';
import { DSO_MARKER_STYLES, HIGHLIGHT_RING } from './canvas-theme';

const TWO_PI = Math.PI * 2;

/** Draw a DSO marker of the given type at the origin (caller has translated/rotated). */
export function drawDsoMarker(ctx: CanvasRenderingContext2D, type: DSOType, rx: number, ry: number): void {
  const s = DSO_MARKER_STYLES[type] ?? DSO_MARKER_STYLES['?'];
  const ellipse = s.shape === 'ellipse';

  if (s.fill) {
    const outer = s.fill.radiusMode === 'max' ? Math.max(rx, ry) : rx;
    const inner = (s.fill.innerRatio ?? 0) * rx;
    const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    for (const [offset, color] of s.fill.stops) grad.addColorStop(offset, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ellipse) ctx.scale(1, ry / rx);
    ctx.arc(0, 0, rx, 0, TWO_PI);
    ctx.fill();
    if (ellipse) ctx.scale(1, rx / ry);
  }

  if (s.stroke) {
    ctx.strokeStyle = s.stroke.color;
    ctx.lineWidth = s.stroke.lineWidth;
    if (s.stroke.dash) ctx.setLineDash(s.stroke.dash);
    ctx.beginPath();
    if (ellipse) ctx.scale(1, ry / rx);
    ctx.arc(0, 0, rx, 0, TWO_PI);
    ctx.stroke();
    if (ellipse) ctx.scale(1, rx / ry);
    if (s.stroke.dash) ctx.setLineDash([]);
  }

  // Globular-cluster cross, drawn with the current (stroke) style.
  if (s.cross) {
    ctx.beginPath();
    ctx.moveTo(-rx, 0); ctx.lineTo(rx, 0);
    ctx.moveTo(0, -rx); ctx.lineTo(0, rx);
    ctx.stroke();
  }

  // Planetary-nebula inner ring (keeps the outer stroke's line width).
  if (s.innerCircle) {
    ctx.strokeStyle = s.innerCircle.color;
    ctx.beginPath();
    ctx.arc(0, 0, rx * s.innerCircle.ratio, 0, TWO_PI);
    ctx.stroke();
  }
}

/** Draw the highlight ring around a searched DSO (caller has translated/rotated). */
export function drawDsoHighlightRing(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  ctx.strokeStyle = HIGHLIGHT_RING.color;
  ctx.lineWidth = HIGHLIGHT_RING.lineWidth;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.scale(1, ry / rx);
  ctx.arc(0, 0, rx + HIGHLIGHT_RING.padPx, 0, TWO_PI);
  ctx.stroke();
  ctx.scale(1, rx / ry);
}
