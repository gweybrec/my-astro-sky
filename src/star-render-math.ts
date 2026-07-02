/**
 * Pure star-rendering maths, extracted from `sky-map.ts` so the size/colour/glow
 * derivation can be unit-tested without a canvas. Everything here is a pure
 * function of (mag, bv, scale, maxMag, theme). The actual pixel-pushing
 * (`paintStar`, sprite atlas) stays in the renderer since it needs a 2D context.
 */
import { SKY_THEME, applyStarColor } from './sky-themes';

/** B-V colour index → RGB (0-255). Neutral-white at the B-V≈0.4 white point,
 * ramping blue toward −0.4 and orange/red toward 2.0. */
export function bvToRgb(bv: number): [number, number, number] {
  bv = Math.max(-0.4, Math.min(2.0, bv));

  let r: number, g: number, b: number;

  if (bv < 0.4) {
    // Hot stars: neutral white at the white point (B-V ≈ 0.4), increasingly
    // blue toward B-V = -0.4. This makes B/A-type stars (Rigel, Vega) read as
    // proper blue-white instead of pure white.
    const t = (0.4 - bv) / 0.8; // 0 at bv=0.4, 1 at bv=-0.4
    r = 1.0 - 0.45 * t;
    g = 1.0 - 0.17 * t;
    b = 1.0;
  } else if (bv < 0.8) {
    const t = (bv - 0.4) / 0.4;
    r = 1.0;
    g = 1.0 - 0.12 * t;
    b = 1.0 - 0.32 * t;
  } else if (bv < 1.2) {
    const t = (bv - 0.8) / 0.4;
    r = 1.0;
    g = 0.88 - 0.13 * t;
    b = 0.68 - 0.20 * t;
  } else {
    const t = Math.min((bv - 1.2) / 0.8, 1);
    r = 1.0;
    g = 0.75 - 0.13 * t;
    b = 0.48 - 0.16 * t;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** How much stars may grow when zooming in, like looking through a telescope. */
export const STAR_ZOOM_CAP = 2.2;

export function starRadius(mag: number, scale: number, brightZoomBoost = 0): number {
  // Floors are low enough that the faintest stars keep shrinking with magnitude
  // instead of bottoming out at one uniform size (paintStar's radial gradient
  // stays round at any radius, so a low floor doesn't risk a "square" look).
  const base = Math.max(0.3, 3.5 - mag * 0.5);
  // Stars grow when zooming in (telescope-like), up to a cap so they don't take
  // over the view. Bright stars (mag < 3) get a higher cap so they stay prominent
  // when zoomed in (Stellarium-like); the brightest grow the most.
  const cap = STAR_ZOOM_CAP + (mag < 3 ? (3 - mag) * brightZoomBoost : 0);
  const zoomFactor = Math.min(cap, Math.sqrt(scale / 400));
  return Math.max(0.9, base * zoomFactor);
}

export function computeMaxMag(scale: number): number {
  const raw = 6 + Math.log2(scale / 200);
  return Math.max(6, raw);
}

// Snap a zoom scale to a ~6% multiplicative grid. The star sprite atlas is keyed on
// this (not the raw scale), so a continuous zoom only rebuilds the atlas when it
// crosses a bucket — a handful of times across the whole range instead of every
// frame. Sprites end up at most ~3% off their exact size mid-zoom (imperceptible in
// motion, snapped exact at bucket boundaries), with no drawImage rescaling.
export const ATLAS_SCALE_STEP = Math.log(1.06);
export function atlasScaleBucket(scale: number): number {
  return Math.exp(Math.round(Math.log(scale) / ATLAS_SCALE_STEP) * ATLAS_SCALE_STEP);
}

// ─── Star painting inputs (shared by the live draw and the sprite cache) ─────
// Resolved per-star drawing inputs. Everything here is a pure function of
// (mag, bv, scale, maxMag, theme), so two stars with the same quantized mag/bv
// share one sprite (see renderStars' atlas).
export interface StarPaint {
  radius: number;
  r: number; g: number; b: number;   // dot colour
  soft: number;                       // soft-rim fraction of the radius
  glowAlpha: number;
  glowR: number;                      // glow extent in px (0 when no glow)
  coreEdge: number;
  solidUntil: number;
  gr: number; gg: number; gb: number; // glow colour
}

export function computeStarPaint(
  mag: number, bv: number, scale: number, maxMag: number,
  theme: typeof SKY_THEME, established = false,
): StarPaint {
  const radius = starRadius(mag, scale, theme.brightZoomBoost) * theme.radiusScale;
  const spectral = bvToRgb(bv);
  const [r, g, b] = applyStarColor(spectral, theme);
  // 1 when well below the limit, ramping to 0 right at it (just-appearing stars).
  const estab = established ? 1 : Math.min(1, Math.max(0, (maxMag - mag) / 1.5));
  const soft = 0.3 + 0.4 * (1 - estab);
  const glowBright = mag < theme.glowThresholdMag
    ? Math.min(1, Math.max(0, (theme.glowThresholdMag - mag) / theme.glowThresholdMag))
    : 0;
  const glowAlpha = theme.glowOpacity * glowBright;
  let glowR = 0, coreEdge = 0, solidUntil = 0, gr = r, gg = g, gb = b;
  if (glowAlpha > 0.01) {
    const glow = applyStarColor(spectral, theme, theme.glowSaturation);
    gr = glow[0]; gg = glow[1]; gb = glow[2];
    const glowZoom = 1 + theme.glowZoomSpread * Math.max(0, Math.min(3, Math.sqrt(scale / 400)) - 1);
    glowR = radius * theme.glowRadiusMul * glowZoom;
    coreEdge = radius / glowR;            // dot edge as a fraction of glowR
    solidUntil = coreEdge * (1 - soft);   // fully opaque out to here
  }
  return { radius, r, g, b, soft, glowAlpha, glowR, coreEdge, solidUntil, gr, gg, gb };
}
