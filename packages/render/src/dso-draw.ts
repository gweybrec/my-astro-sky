/**
 * Pure DSO marker drawing, extracted from `sky-map.ts`'s `renderDSOs` switch. The
 * per-type look (shape, fill gradient, stroke, cross, inner ring) is data in
 * {@link DSO_MARKER_STYLES}; this walks that data. The caller sets up the transform
 * (translate to the DSO centre, rotate to its position angle, set globalAlpha) and
 * calls `drawDsoMarker` with the major/minor radii in pixels.
 *
 * For an ellipse marker the body is drawn with `scale(1, ry/rx)` around the pre-scaled
 * `arc(0,0,rx)` and then unscaled; a circle marker skips the scale. The gradient fill is
 * a pre-drawn disc stretched to the body (see fillSprite).
 */
import type { DSOType } from '@myastrosky/core/types';
import {
  DSO_MARKER_STYLES,
  HIGHLIGHT_RING,
  type GradientFill,
} from '@myastrosky/core/canvas-theme';

const TWO_PI = Math.PI * 2;

/** Diameters in pixels of the pre-drawn fills; a marker uses the smallest one at least its own size. */
const FILL_SPRITE_SIZES = [8, 16, 32, 64, 128, 256];
/** The pre-drawn fills of each style, by index in FILL_SPRITE_SIZES; null where no 2D context could be made. */
const fillSprites = new Map<GradientFill, (HTMLCanvasElement | null)[]>();

/**
 * The fill of `fill` drawn once on a disc that touches the edges of a square canvas, at least `diameter` pixels
 * across; or null when the marker is larger than every size. A gradient fill costs the GPU far more than stretching a
 * picture: ~1,500 gradient markers took ~40 ms a frame on a desktop's integrated graphics.
 */
function fillSprite(fill: GradientFill, diameter: number): HTMLCanvasElement | null {
  const i = FILL_SPRITE_SIZES.findIndex((d) => d >= diameter);
  if (i < 0) return null;
  let sprites = fillSprites.get(fill);
  if (!sprites) fillSprites.set(fill, (sprites = []));
  if (sprites[i] === undefined) {
    const d = FILL_SPRITE_SIZES[i];
    const canvas = document.createElement('canvas');
    canvas.width = d;
    canvas.height = d;
    const sctx = canvas.getContext('2d');
    if (sctx) {
      const r = d / 2;
      const grad = sctx.createRadialGradient(r, r, (fill.innerRatio ?? 0) * r, r, r, r);
      for (const [offset, color] of fill.stops) grad.addColorStop(offset, color);
      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.arc(r, r, r, 0, TWO_PI);
      sctx.fill();
    }
    sprites[i] = sctx ? canvas : null;
  }
  return sprites[i];
}

/** Whether `fill` ends on a transparent colour at its edge (`rgba(…, 0)`), so its picture has no visible edge. */
function fadesOut(fill: GradientFill): boolean {
  const last = fill.stops[fill.stops.length - 1];
  return fill.stops.length > 1 && last[0] === 1 && /,\s*0\s*\)$/.test(last[1]);
}

/** Draw a DSO marker of the given type at the origin (caller has translated/rotated). */
export function drawDsoMarker(
  ctx: CanvasRenderingContext2D,
  type: DSOType,
  rx: number,
  ry: number,
): void {
  const s = DSO_MARKER_STYLES[type] ?? DSO_MARKER_STYLES['?'];
  const ellipse = s.shape === 'ellipse';

  // The gradient stretched with the body is the pre-drawn disc stretched the same way. Not when it reaches past the
  // body (radiusMode 'max' with ry > rx), nor when its edge is visible: stretching a picture softens a visible edge.
  const sprite =
    s.fill && fadesOut(s.fill) && (s.fill.radiusMode !== 'max' || ry <= rx)
      ? fillSprite(s.fill, 2 * (ellipse ? Math.max(rx, ry) : rx))
      : null;
  if (sprite) {
    const h = ellipse ? ry : rx;
    ctx.drawImage(sprite, -rx, -h, 2 * rx, 2 * h);
  } else if (s.fill) {
    if (s.fill.stops.length === 1) {
      ctx.fillStyle = s.fill.stops[0][1];
    } else {
      const outer = s.fill.radiusMode === 'max' ? Math.max(rx, ry) : rx;
      const inner = (s.fill.innerRatio ?? 0) * rx;
      const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      for (const [offset, color] of s.fill.stops) grad.addColorStop(offset, color);
      ctx.fillStyle = grad;
    }
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
    ctx.moveTo(-rx, 0);
    ctx.lineTo(rx, 0);
    ctx.moveTo(0, -rx);
    ctx.lineTo(0, rx);
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
