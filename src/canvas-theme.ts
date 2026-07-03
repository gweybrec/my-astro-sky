/**
 * Canvas theme: every color, font, line width, dash pattern and radius that the
 * sky-map renderer used to hardcode in `ctx.*` calls, centralized as named tokens.
 *
 * Kept separate from {@link SKY_THEME} (which owns the *sky look* — background, stars,
 * glow, grid tint), because DSO marker colors are semantic and were deliberately
 * excluded there. Render code must reference these tokens; no `ctx` call should carry
 * a literal color/font/size. Values are copied verbatim from the old inline literals —
 * changing one here changes it everywhere, which is the point.
 */
import type { DSOType } from './types';

// ── Fonts ────────────────────────────────────────────────────────────────────
export const FONTS = {
  gridLabel: '11px sans-serif',
  constellationName: '11px sans-serif',
  dsoLabel: '9px sans-serif',
  starLabel: '10px sans-serif',
  frameLabel: '11px sans-serif',
} as const;

/** Grid line widths (equator drawn heavier than the regular declination circles). */
export const GRID = { lineWidth: 0.8, equatorLineWidth: 1.5 } as const;

// ── DSO markers ──────────────────────────────────────────────────────────────
// Each DSO type draws a distinct marker. `shape` decides whether the body is scaled
// to an ellipse (major/minor axis) or kept circular; the rest is optional fill,
// stroke, a globular-cluster cross, and a planetary-nebula inner ring.

export type MarkerShape = 'ellipse' | 'circle';

export interface GradientFill {
  /** Radial gradient stops [offset 0..1, css color]. */
  stops: Array<[number, string]>;
  /** Gradient outer radius: the major radius `rx` (default) or `max(rx, ry)`. */
  radiusMode?: 'rx' | 'max';
  /** Gradient inner radius as a fraction of `rx` (default 0 = solid centre). */
  innerRatio?: number;
}

export interface DsoMarkerStyle {
  /** `ellipse` applies a `scale(1, ry/rx)` to the body; `circle` draws at `rx`. */
  shape: MarkerShape;
  fill?: GradientFill;
  stroke?: { color: string; lineWidth: number; dash?: number[] };
  /** Globular cluster: a `+` across the body, drawn with the stroke style. */
  cross?: boolean;
  /** Planetary nebula: a second, smaller ring at `ratio * rx`. */
  innerCircle?: { ratio: number; color: string };
}

/** One marker style per DSO type (GxS and Gx share the galaxy look). */
export const DSO_MARKER_STYLES: Record<DSOType, DsoMarkerStyle> = {
  // Spiral / unclassified galaxy: filled ellipse, golden gradient.
  Gx: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(220, 180, 100, 0.8)'],
        [0.5, 'rgba(180, 140, 70, 0.5)'],
        [1, 'rgba(150, 100, 40, 0)'],
      ],
    },
    stroke: { color: 'rgba(220, 180, 100, 0.6)', lineWidth: 0.8 },
  },
  GxS: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(220, 180, 100, 0.8)'],
        [0.5, 'rgba(180, 140, 70, 0.5)'],
        [1, 'rgba(150, 100, 40, 0)'],
      ],
    },
    stroke: { color: 'rgba(220, 180, 100, 0.6)', lineWidth: 0.8 },
  },
  // Elliptical galaxy: rounder, bluer-white gradient (gradient spans the larger axis).
  GxE: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(210, 210, 255, 0.8)'],
        [0.5, 'rgba(160, 160, 220, 0.4)'],
        [1, 'rgba(120, 120, 180, 0)'],
      ],
      radiusMode: 'max',
    },
    stroke: { color: 'rgba(180, 180, 240, 0.5)', lineWidth: 0.8 },
  },
  // Irregular galaxy: greenish/teal, amorphous (circular, no rotation).
  GxI: {
    shape: 'circle',
    fill: {
      stops: [
        [0, 'rgba(140, 230, 180, 0.7)'],
        [0.5, 'rgba(100, 180, 140, 0.35)'],
        [1, 'rgba(60, 140, 100, 0)'],
      ],
    },
    stroke: { color: 'rgba(100, 200, 150, 0.5)', lineWidth: 0.8 },
  },
  // Open cluster: dashed circle, warm neutral.
  OC: {
    shape: 'circle',
    stroke: { color: 'rgba(200, 185, 160, 0.6)', lineWidth: 1, dash: [3, 3] },
  },
  // Globular cluster: filled circle with gradient + cross.
  GC: {
    shape: 'circle',
    fill: {
      stops: [
        [0, 'rgba(255, 220, 100, 0.7)'],
        [0.6, 'rgba(220, 160, 60, 0.4)'],
        [1, 'rgba(180, 120, 30, 0)'],
      ],
    },
    stroke: { color: 'rgba(255, 200, 80, 0.6)', lineWidth: 0.7 },
    cross: true,
  },
  // Emission nebula: reddish ellipse gradient.
  EN: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(255, 80, 80, 0.4)'],
        [0.5, 'rgba(200, 50, 80, 0.2)'],
        [1, 'rgba(180, 30, 60, 0)'],
      ],
    },
    stroke: { color: 'rgba(220, 80, 80, 0.4)', lineWidth: 0.7 },
  },
  // Reflection nebula: cool neutral ellipse.
  RN: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(100, 115, 140, 0.35)'],
        [0.5, 'rgba(80, 95, 120, 0.15)'],
        [1, 'rgba(60, 75, 100, 0)'],
      ],
    },
    stroke: { color: 'rgba(160, 175, 185, 0.45)', lineWidth: 0.7 },
  },
  // Planetary nebula: double circle, blue-cyan.
  PN: {
    shape: 'circle',
    stroke: { color: 'rgba(80, 200, 220, 0.8)', lineWidth: 1 },
    innerCircle: { ratio: 0.4, color: 'rgba(80, 200, 220, 0.5)' },
  },
  // Supernova remnant: green-teal ellipse, hollow centre (inner-radius gradient).
  SNR: {
    shape: 'ellipse',
    fill: {
      stops: [
        [0, 'rgba(80, 200, 150, 0)'],
        [0.7, 'rgba(80, 200, 150, 0.2)'],
        [1, 'rgba(60, 180, 120, 0.5)'],
      ],
      innerRatio: 0.6,
    },
    stroke: { color: 'rgba(80, 200, 150, 0.5)', lineWidth: 0.8 },
  },
  // Dark nebula: simple dark outline ellipse.
  DN: {
    shape: 'ellipse',
    stroke: { color: 'rgba(120, 120, 140, 0.5)', lineWidth: 0.7 },
  },
  // Unknown: simple circle outline.
  '?': {
    shape: 'circle',
    stroke: { color: 'rgba(160, 160, 160, 0.4)', lineWidth: 0.7 },
  },
};

/** DSO label text color per type. Galaxy subtypes (GxS/GxE/GxI) intentionally fall
 * back to {@link DEFAULT_DSO_LABEL_COLOR} — matching the original `TYPE_COLORS` map. */
export const DSO_LABEL_COLORS: Partial<Record<DSOType, string>> = {
  Gx: 'rgba(220, 180, 100, 0.8)',
  OC: 'rgba(200, 185, 160, 0.8)',
  GC: 'rgba(255, 200, 80, 0.8)',
  EN: 'rgba(220, 100, 100, 0.8)',
  RN: 'rgba(160, 175, 185, 0.75)',
  PN: 'rgba(80, 200, 220, 0.9)',
  SNR: 'rgba(80, 200, 150, 0.8)',
  DN: 'rgba(120, 120, 140, 0.6)',
  '?': 'rgba(160, 160, 160, 0.6)',
};
export const DEFAULT_DSO_LABEL_COLOR = 'rgba(160, 160, 160, 0.7)';

// ── Highlights & misc sky overlays ───────────────────────────────────────────
/** Ring drawn around a searched/highlighted DSO or star (shared accent orange). */
export const HIGHLIGHT_RING = {
  color: 'rgba(192, 120, 48, 0.85)',
  lineWidth: 2,
  padPx: 4,
} as const;

/** Astrophoto outline + its edge label (same accent orange, softer stroke). */
export const PHOTO_OUTLINE = {
  stroke: 'rgba(192, 120, 48, 0.55)',
  label: 'rgba(192, 120, 48, 0.85)',
  lineWidth: 1.5,
  dash: [6, 4] as number[],
} as const;

/** The border ring around the visible hemisphere disc. */
export const BORDER_RING = { color: 'rgba(200, 185, 168, 0.3)', lineWidth: 1.5 } as const;

/** The horizon curve drawn in date mode when an observer location is set. */
export const HORIZON_LINE = { lineWidth: 1.5 } as const;

/** Circular background disc + radius for a mosaic tile's delete/add button. */
export const TILE_BUTTON = { bg: 'rgba(15, 15, 18, 0.78)', radius: 11 } as const;

// ── FOV frame UI ─────────────────────────────────────────────────────────────
// Frames prefer live CSS variables (--fov-frame-stroke, --accent-color, …); these
// are the fallbacks + the structural sizes/dashes for handles and overlays.
export const FRAME = {
  strokeFallback: 'rgba(220,60,60,0.85)',
  labelFallback: 'rgba(220,90,90,0.9)',
  dangerFallback: '#cc7777',
  lineWidth: 1.5,
  lineWidthActive: 2,
  dashOutline: [8, 4] as number[],
  dashDraft: [6, 4] as number[],
  handleRadius: 5,
  moveDotRadius: 4,
  cornerHalf: 3,
  rotateNeedleLen: 24,
  pinSize: 16,
  snapDotRadius: 5,
  /** Elastic snap line: width = base + tension*add; alpha = 0.5 + 0.5*tension. */
  elasticWidthBase: 1.5,
  elasticWidthTension: 1.5,
  /** Hide the frame's name label when its longest edge is shorter than this (px). */
  labelMinEdgePx: 48,
} as const;
