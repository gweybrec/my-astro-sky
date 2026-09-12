/**
 * Draw a photo-detail "show DSOs" overlay: DSO outlines using the sky map's own
 * per-type shapes and hues (`DSO_MARKER_STYLES`), but outline-only — no fill, and a
 * boosted stroke opacity/width so an outline stays legible over a bright photo
 * instead of the sky map's own fill+thin-stroke look, which reads as barely visible
 * on a photo's raster background. Labels are laid out by {@link placeLabel}
 * (`src/dso-label-placement.ts`, ported from the sibling Android app's
 * label-placement algorithm) and then clamped to stay inside the photo's own
 * visible area, since the canvas silently clips anything drawn past its own bounds —
 * without the clamp, a DSO near the bottom/side edge (visible as a half-circle) would
 * have its label pushed off-canvas and never drawn at all.
 *
 * Split into a pure layout step ({@link computePhotoDsoOverlayLayout}, unit-testable
 * with a stub text measurer) and a thin canvas-drawing step
 * ({@link renderPhotoDsoOverlay}) — the same split `sky-scene-render.ts` uses between
 * `renderDSOs`/`renderDSOLabels` and the pure helpers in `dso-draw.ts`/`dso-label.ts`.
 *
 * Outlines scale with the photo's own display size (their radii are converted from
 * photo pixels via `dispScale`, so a nebula's on-screen outline tracks the image at
 * every zoom level); label text stays a fixed on-screen size regardless of zoom —
 * mirrors the sibling app's `AnnotationOverlay.kt`: "Outlines scale with the zoom;
 * labels do not."
 */
import type { DSO, DSOType } from './types';
import type { PhotoDsoPlacement } from './dso-catalog';
import { placeLabel, type Rect, type Clearance, type Size } from './dso-label-placement';
import { formatCatalogId } from './dso-label';
import { DSO_MARKER_STYLES, DSO_LABEL_COLORS, DEFAULT_DSO_LABEL_COLOR } from './canvas-theme';

const MIN_RADIUS_PX = 2;
/** Breathing room between a label and the outline it clears. The label-clearance
 * math (`ellipseLabelClearance`/`ellipseBoundExtent`) finds the true tightest
 * distance to the marker's own mathematical boundary; this is what's left over for
 * the stroke's own line width and general legibility on top of that — 3px measured
 * flush against the exact curve read as touching in practice. */
const LABEL_GAP_PX = 5;
/** Bolder and a touch larger than the sky map's own `FONTS.dsoLabel` (9px, regular) —
 * a photo overlay is read at arm's length over a busy raster image, where the sky
 * map's thin small label became hard to pick out. Not shared with `canvas-theme.ts`
 * since that font also drives the sky map's own, unrelated, label density.
 *
 * Exported so the caller's `measureLabelWidth` can set it before measuring — the
 * layout step (`computePhotoDsoOverlayLayout`) runs, and measures label widths,
 * *before* `renderPhotoDsoOverlay` ever sets `ctx.font` itself. Measuring against
 * whatever font the canvas happened to have (its default, `10px sans-serif`) instead
 * of this bold 11px one under-measured every label's width, which fed directly into
 * `ellipseLabelClearance`'s footprint and under-cleared a tilted ellipse's outline. */
export const LABEL_FONT = 'bold 11px sans-serif';
const LABEL_HEIGHT_PX = 13;
/** Stroke opacity/width for the outline-only photo overlay — well above the sky
 * map's own (0.4–0.8 alpha, 0.7–1px), which reads as barely visible over a photo. */
const OUTLINE_ALPHA = 0.95;
const MIN_LINE_WIDTH_PX = 1.5;

export interface PhotoDsoOverlayItem {
  dso: DSO;
  screenX: number;
  screenY: number;
  rx: number;
  ry: number;
  angleDeg: number;
  label: string;
  labelBox: Rect;
}

/** Replace an `rgba(r, g, b, a)` color's alpha; returns the input unchanged if it
 * doesn't match that shape (defensive — every `DSO_MARKER_STYLES` entry does). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) return color;
  const [r, g, b] = m[1].split(',').map((s) => s.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Sample count for {@link ellipseBoundExtent}'s numeric search — no simple closed
 * form once the boundary is restricted to a span. Coarser than it looks: the loop
 * also interpolates the exact crossing points where the boundary enters/leaves the
 * span, so this only has to be fine enough to bracket each crossing once, not to
 * land a sample inside every possible (narrow) span outright. */
const ELLIPSE_SAMPLES = 360;

/**
 * How far a rotated ellipse's boundary reaches along `targetAxis`, maximised over
 * only the points whose *other* axis coordinate falls within `[-halfSpan, halfSpan]`
 * — i.e. how deep the ellipse intrudes underneath (or above) a label of a given
 * half-width, or beside one of a given half-height, so the label's whole footprint
 * clears the tilted outline rather than just the single point directly below its
 * centre. Evaluating this at `halfSpan = 0` (a single point, not a real label) is
 * what undershot before: NGC4725's "5" clipped the outline because the label's other
 * end sat over a part of the tilted ellipse that reaches further down than its
 * centre line does — evaluating over the label's actual footprint, not just its
 * centre point, is what a *margin* has to account for. Point-symmetric through the
 * centre, so one value serves both directions on that axis (down and up, or right
 * and left).
 *
 * Walks the boundary in fixed steps, taking the max `target` over samples that
 * already satisfy the span, *and* linearly interpolating the exact crossing point
 * wherever a step's `bound` coordinate passes `±halfSpan` between two samples. The
 * interpolation is what keeps this correct for a narrow span relative to the sample
 * spacing (checking only raw samples can miss a real crossing entirely — including a
 * `halfSpan` of exactly 0, where floating-point noise means no sample ever lands
 * precisely at the boundary) rather than requiring an ever-finer sample count.
 */
export function ellipseBoundExtent(
  rx: number,
  ry: number,
  angleDeg: number,
  targetAxis: 'x' | 'y',
  halfSpan: number,
): number {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const at = (t: number): { bound: number; target: number } => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    const x = ex * cos - ey * sin;
    const y = ex * sin + ey * cos;
    return targetAxis === 'y' ? { bound: x, target: y } : { bound: y, target: x };
  };

  let maxExtent = 0;
  let prev = at(0);
  for (let i = 1; i <= ELLIPSE_SAMPLES; i++) {
    const cur = at((i / ELLIPSE_SAMPLES) * Math.PI * 2);
    if (Math.abs(cur.bound) <= halfSpan) maxExtent = Math.max(maxExtent, Math.abs(cur.target));
    for (const edge of halfSpan === 0 ? [0] : [halfSpan, -halfSpan]) {
      const prevSide = prev.bound - edge;
      const curSide = cur.bound - edge;
      if (prevSide === 0) {
        maxExtent = Math.max(maxExtent, Math.abs(prev.target));
      } else if (prevSide * curSide < 0) {
        const frac = prevSide / (prevSide - curSide);
        const interpTarget = prev.target + frac * (cur.target - prev.target);
        maxExtent = Math.max(maxExtent, Math.abs(interpTarget));
      }
    }
    prev = cur;
  }
  return maxExtent;
}

/**
 * Label clearance on each axis for a marker of size `rx`×`ry` rotated by `angleDeg`,
 * accounting for the label's own footprint (`labelSize`) — see
 * {@link ellipseBoundExtent}. `clearance.y` (used for a below/above placement) is
 * evaluated over the label's half-*width*, since that's the span it occupies on the
 * object's x-axis; `clearance.x` (a side placement) over its half-*height*.
 */
export function ellipseLabelClearance(
  rx: number,
  ry: number,
  angleDeg: number,
  labelSize: Size,
): Clearance {
  return {
    y: ellipseBoundExtent(rx, ry, angleDeg, 'y', labelSize.width / 2),
    x: ellipseBoundExtent(rx, ry, angleDeg, 'x', labelSize.height / 2),
  };
}

/**
 * Pure layout step: screen position + ellipse radii (scaled from photo pixels to
 * display pixels) and non-overlapping label boxes, clamped to stay within
 * `viewport`, for every placement. Processed brightest/largest first so the most
 * important object keeps its preferred label spot — the tie-break the sibling app's
 * `SkyCatalogue.within` uses.
 *
 * `viewport` is in the same "image-relative CSS px" space as `placements` once
 * scaled by `dispScale` — not necessarily `[0,0]`-anchored. When the photo is zoomed
 * past its container, the container clips it via `overflow: hidden`, so the caller
 * must pass the *visible* sub-rectangle (the intersection of the image's own bounds
 * with its clipping container), not the full (possibly far larger, partly
 * off-screen) image bounds — otherwise a label "clamped" here can still land in a
 * region that is itself scrolled out of view.
 */
export function computePhotoDsoOverlayLayout(
  placements: PhotoDsoPlacement[],
  dispScale: number,
  measureLabelWidth: (text: string) => number,
  viewport: Rect,
): PhotoDsoOverlayItem[] {
  const ordered = [...placements].sort((p1, p2) => {
    const mag1 = p1.dso.mag ?? 99;
    const mag2 = p2.dso.mag ?? 99;
    if (mag1 !== mag2) return mag1 - mag2;
    return (p2.dso.majAxis ?? 0) - (p1.dso.majAxis ?? 0);
  });

  const occupied: Rect[] = [];
  const items: PhotoDsoOverlayItem[] = [];
  for (const p of ordered) {
    const screenX = p.x * dispScale;
    const screenY = p.y * dispScale;
    const rx = Math.max(MIN_RADIUS_PX, (p.majorPx / 2) * dispScale);
    const ry = Math.max(MIN_RADIUS_PX, (p.minorPx / 2) * dispScale);
    const label = formatCatalogId(p.displayId, p.dso);
    const width = measureLabelWidth(label);
    const labelSize: Size = { width, height: LABEL_HEIGHT_PX };
    const clearance = ellipseLabelClearance(rx, ry, p.angleDeg, labelSize);
    const box = clampToViewport(
      placeLabel({ x: screenX, y: screenY }, clearance, labelSize, LABEL_GAP_PX, occupied),
      viewport,
    );
    occupied.push(box);
    items.push({
      dso: p.dso,
      screenX,
      screenY,
      rx,
      ry,
      angleDeg: p.angleDeg,
      label,
      labelBox: box,
    });
  }
  return items;
}

/** Slide a label box back inside the viewport rect when it would otherwise land past
 * an edge — a DSO near the border (visible on the photo as a partial circle) must
 * still get a visible label rather than one silently clipped by the canvas's own
 * bounds. `viewport` need not start at the origin (see {@link computePhotoDsoOverlayLayout}). */
function clampToViewport(box: Rect, viewport: Rect): Rect {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const maxLeft = Math.max(viewport.left, viewport.right - width);
  const maxTop = Math.max(viewport.top, viewport.bottom - height);
  const left = Math.min(Math.max(box.left, viewport.left), maxLeft);
  const top = Math.min(Math.max(box.top, viewport.top), maxTop);
  return { left, top, right: left + width, bottom: top + height };
}

/** Draw one outline-only marker (no fill), matching the sky map's per-type shape and
 * hue at a boosted, consistently visible opacity/line width. */
function drawOutlineMarker(
  ctx: CanvasRenderingContext2D,
  type: DSOType,
  rx: number,
  ry: number,
): void {
  const s = DSO_MARKER_STYLES[type] ?? DSO_MARKER_STYLES['?'];
  const ellipse = s.shape === 'ellipse';
  const color = withAlpha(s.stroke?.color ?? DEFAULT_DSO_LABEL_COLOR, OUTLINE_ALPHA);

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH_PX, s.stroke?.lineWidth ?? MIN_LINE_WIDTH_PX);
  if (s.stroke?.dash) ctx.setLineDash(s.stroke.dash);
  ctx.beginPath();
  if (ellipse) ctx.scale(1, ry / rx);
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.stroke();
  if (ellipse) ctx.scale(1, rx / ry);
  if (s.stroke?.dash) ctx.setLineDash([]);

  // Deliberately just the single outer outline here (unlike the sky map's own
  // drawDsoMarker) — no globular-cluster cross, no planetary-nebula inner ring, no
  // fill of any kind — per user request.
}

/**
 * Draw outlines then labels for a laid-out overlay — two passes, so a later object's
 * outline can never cross an earlier object's name.
 */
export function renderPhotoDsoOverlay(
  ctx: CanvasRenderingContext2D,
  items: PhotoDsoOverlayItem[],
): void {
  for (const item of items) {
    ctx.save();
    ctx.translate(item.screenX, item.screenY);
    ctx.rotate((item.angleDeg * Math.PI) / 180);
    drawOutlineMarker(ctx, item.dso.type, item.rx, item.ry);
    ctx.restore();
  }

  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'top';
  for (const item of items) {
    ctx.fillStyle = DSO_LABEL_COLORS[item.dso.type] ?? DEFAULT_DSO_LABEL_COLOR;
    ctx.fillText(item.label, item.labelBox.left, item.labelBox.top);
  }
  ctx.textBaseline = 'alphabetic';
}
