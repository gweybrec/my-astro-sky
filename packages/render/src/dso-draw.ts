/**
 * Pure DSO marker drawing, extracted from `sky-map.ts`'s `renderDSOs` switch. The
 * per-type look (shape, fill gradient, stroke, cross, inner ring) is data in
 * {@link DSO_MARKER_STYLES}; this walks that data. A marker's body fill is drawn by
 * `drawDsoMarkerFill`, after the caller sets up the transform (translate to the DSO
 * centre, rotate to its position angle, set globalAlpha), with the major/minor radii in
 * pixels. Its outlines go to a `DsoOutlines`, which strokes those of every marker at the end.
 *
 * For an ellipse marker the body is drawn with `scale(1, ry/rx)` around the pre-scaled
 * `arc(0,0,rx)` and then unscaled; a circle marker skips the scale. The gradient fill is
 * a pre-drawn disc stretched to the body (see fillSprite).
 */
import type { DSOType } from '@myastrosky/core/types';
import {
  DSO_MARKER_STYLES,
  HIGHLIGHT_RING,
  type DsoMarkerStyle,
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

/** The marker style of a DSO type. */
function styleOf(type: DSOType): DsoMarkerStyle {
  return DSO_MARKER_STYLES[type] ?? DSO_MARKER_STYLES['?'];
}

/** Whether a DSO type's marker has a body fill (drawn by drawDsoMarkerFill); its outline is drawn by DsoOutlines. */
export function dsoMarkerHasFill(type: DSOType): boolean {
  return styleOf(type).fill !== undefined;
}

/**
 * Draw the body fill of a DSO marker of the given type at the origin (caller has translated/rotated). `pixelScale`:
 * canvas pixels per unit of the context's base transform (the device pixel ratio, an export's scale), so the pre-drawn
 * fill is chosen by the marker's size in canvas pixels and is not shown enlarged on a high-density screen.
 */
export function drawDsoMarkerFill(
  ctx: CanvasRenderingContext2D,
  type: DSOType,
  rx: number,
  ry: number,
  pixelScale = 1,
): void {
  const s = styleOf(type);
  const ellipse = s.shape === 'ellipse';

  // The gradient stretched with the body is the pre-drawn disc stretched the same way. Not when it reaches past the
  // body (radiusMode 'max' with ry > rx), nor when its edge is visible: stretching a picture softens a visible edge.
  const sprite =
    s.fill && fadesOut(s.fill) && (s.fill.radiusMode !== 'max' || ry <= rx)
      ? fillSprite(s.fill, 2 * (ellipse ? Math.max(rx, ry) : rx) * pixelScale)
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
}

/** One stroke of DsoOutlines: a colour, a width, a dash and an opacity, and the shapes drawn with them. */
interface OutlineGroup {
  color: string;
  lineWidth: number;
  dash: number[];
  alpha: number;
  /** Ellipses, five numbers each: centre x, y, radii rx, ry, rotation. */
  ellipses: number[];
  /** Globular-cluster crosses, four numbers each: centre x, y, half-length, rotation. */
  crosses: number[];
}

/**
 * The outlines of a frame's DSO markers (outline, globular-cluster cross, planetary-nebula inner ring), in canvas
 * pixels, stroked together by draw(): one stroke per style and opacity rather than one per marker. Stroking ~1,500
 * outlines one by one took ~25 ms a frame of a desktop's integrated graphics; grouped, ~8 ms for every one of them.
 * The opacity is rounded to steps of 1/20 so the markers share few groups.
 */
export class DsoOutlines {
  private groups = new Map<string, OutlineGroup>();

  /** Adds the outlines of a marker centred at (x, y) and turned by `angle` (radians), at opacity `alpha`. */
  add(
    type: DSOType,
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    alpha: number,
  ): void {
    const s = styleOf(type);
    const a = Math.round(alpha * 20) / 20;
    // Nearly transparent (the sky opacity at 0, say): drawn as before, it would not show.
    if (a === 0) return;
    if (s.stroke) {
      const g = this.group(`${type}|${a}`, s.stroke.color, s.stroke.lineWidth, s.stroke.dash, a);
      g.ellipses.push(x, y, rx, s.shape === 'ellipse' ? ry : rx, angle);
      if (s.cross) g.crosses.push(x, y, rx, angle);
    }
    if (s.innerCircle) {
      const r = rx * s.innerCircle.ratio;
      const lineWidth = s.stroke?.lineWidth ?? 1;
      this.group(`${type}|inner|${a}`, s.innerCircle.color, lineWidth, undefined, a).ellipses.push(
        x,
        y,
        r,
        r,
        0,
      );
    }
  }

  private group(
    key: string,
    color: string,
    lineWidth: number,
    dash: number[] | undefined,
    alpha: number,
  ) {
    let g = this.groups.get(key);
    if (!g) {
      g = { color, lineWidth, dash: dash ?? [], alpha, ellipses: [], crosses: [] };
      this.groups.set(key, g);
    }
    return g;
  }

  /** Strokes every outline added, then forgets them. Leaves the context's opacity and dash as it found them. */
  draw(ctx: CanvasRenderingContext2D): void {
    const prevAlpha = ctx.globalAlpha;
    for (const g of this.groups.values()) {
      ctx.globalAlpha = g.alpha;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.lineWidth;
      ctx.setLineDash(g.dash);
      ctx.beginPath();
      const e = g.ellipses;
      for (let i = 0; i < e.length; i += 5) {
        // Start each ellipse on its own: ellipse() would otherwise join it to the previous one with a line.
        ctx.moveTo(e[i] + e[i + 2] * Math.cos(e[i + 4]), e[i + 1] + e[i + 2] * Math.sin(e[i + 4]));
        ctx.ellipse(e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4], 0, TWO_PI);
      }
      const c = g.crosses;
      for (let i = 0; i < c.length; i += 4) {
        // The cross's two arms, (±r, 0) and (0, ±r) turned by the rotation.
        const dx = c[i + 2] * Math.cos(c[i + 3]);
        const dy = c[i + 2] * Math.sin(c[i + 3]);
        ctx.moveTo(c[i] - dx, c[i + 1] - dy);
        ctx.lineTo(c[i] + dx, c[i + 1] + dy);
        ctx.moveTo(c[i] + dy, c[i + 1] - dx);
        ctx.lineTo(c[i] - dy, c[i + 1] + dx);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = prevAlpha;
    this.groups.clear();
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
