/**
 * The app's sky-map look: background, stars, glow, and grid/constellation tint.
 *
 * A single fixed configuration — intentionally independent of the overall UI
 * theme (warm/cold), so the sky always looks the same. DSO marker colors are not
 * part of this; they are semantic and stay as-is.
 *
 * These are the values the canvas renderer used to hardcode. See
 * `SkyMap.renderBackground` / `renderStars` / `renderGrid` /
 * `renderConstellationLines` for where each is consumed.
 */

export interface SkyThemeConfig {
  // ── Background (radial gradient from canvas center outward) ──
  /** Solid base color painted first. */
  baseFill: string;
  /** Radial gradient stops [offset 0..1, css color]; 0 = center, 1 = far corner. */
  bgStops: Array<[number, string]>;
  /** Optional darkened rim: transparent at `innerStop`, `color` at the edge. */
  vignette: { color: string; innerStop: number } | null;
  /** Multiplier on the user's background-opacity setting (1 = unchanged). */
  bgOpacityScale: number;

  // ── Stars (base color from bvToRgb → [r,g,b] 0..255) ──
  /** Per-channel multiply on star RGB (1,1,1 = unchanged). */
  starTint: { rMul: number; gMul: number; bMul: number };
  /**
   * Blends the spectral star color toward white. 1 = full spectral color as-is,
   * <1 = mostly white with a subtle tint (the natural look — most stars read white,
   * only the hottest show blue and the coolest show orange), >1 = oversaturated.
   */
  starSaturation: number;
  /** Multiply each star's pixel radius (1 = unchanged). */
  radiusScale: number;
  /**
   * How much bright stars (mag < 3) keep growing when zooming in, past the normal
   * 1.0 zoom cap. 0 = legacy behavior (cap at 1.0). Higher keeps the brightest
   * stars prominent when zoomed in.
   */
  brightZoomBoost: number;
  /** Stars brighter than this magnitude get a glow halo. */
  glowThresholdMag: number;
  /** Glow halo radius = starRadius * this. */
  glowRadiusMul: number;
  /** Center alpha of the glow halo (tapered by brightness in renderStars). */
  glowOpacity: number;
  /**
   * Saturation of the GLOW color, independent of the (near-white) star dot. Higher
   * than starSaturation gives a more colored halo — orange for warm stars, blue for
   * hot stars — without changing the star's own color. >1 oversaturates.
   */
  glowSaturation: number;
  /**
   * How much the glow halo spreads as you zoom in, on top of the star's own growth.
   * 0 = glow scales only with the star; higher = the halo extends further when
   * zoomed, so bright stars bloom obviously. The star dot itself is unaffected.
   */
  glowZoomSpread: number;

  // ── Grid + constellation lines ──
  gridColor: string;
  gridEquatorColor: string;
  gridLabelColor: string;
  constellationLineColor: string;
  /** Color of the constellation *name* labels (uppercase, faint). */
  constellationNameColor: string;
  /** Color of the bright-star name labels. */
  starLabelColor: string;
}

/**
 * Realistic dark-BLUE atmospheric sky (not flat black), with mostly-white stars
 * that carry a subtle spectral tint and a soft, colored glow — alive and twinkly.
 */
export const SKY_THEME: SkyThemeConfig = {
  // Deep blue-black base — already has a hint of atmosphere, never pure black
  baseFill: '#040810',
  bgStops: [
    [0.0, 'rgba(26, 38, 66, 0.55)'],   // soft deep-blue atmospheric glow at center
    [0.45, 'rgba(14, 22, 44, 0.5)'],   // fading blue twilight
    [0.8, 'rgba(7, 12, 26, 0.55)'],    // deepening toward the edge
    [1.0, 'rgba(3, 5, 12, 0.6)'],      // near-black blue at the far corner
  ],
  // Gentle vignette to seat photos without killing the atmospheric blue
  vignette: { color: 'rgba(1, 2, 6, 0.55)', innerStop: 0.6 },
  bgOpacityScale: 1.0,
  // Slight cool tint so hot stars read a touch bluer (whites clamp, stay white).
  starTint: { rMul: 0.95, gMul: 0.98, bMul: 1.05 },
  // Mostly white with only a subtle blue/orange tint on the extremes.
  starSaturation: 0.45,
  radiusScale: 1.1,
  // Bright stars stay prominent when zooming in (the brightest grow most).
  brightZoomBoost: 0.28,
  glowThresholdMag: 3.6,   // many stars earn a halo → dense, alive field
  glowRadiusMul: 1.7,      // small halo that hugs the star — barely there, just noticed
  glowOpacity: 0.55,       // opacity tapers with brightness (set in renderStars)
  glowSaturation: 1.45,    // halo is strongly tinted (orange/blue) even though the dot is white
  glowZoomSpread: 1.4,     // glow blooms obviously around bright stars when zoomed in
  // Grid + constellation lines in a soft blue family
  gridColor: 'rgba(90, 130, 200, 0.35)',
  gridEquatorColor: 'rgba(120, 165, 235, 0.65)',
  gridLabelColor: 'rgba(155, 190, 240, 0.9)',
  constellationLineColor: 'rgba(140, 165, 220, 0.5)',
  constellationNameColor: 'rgba(185, 170, 155, 0.4)',
  starLabelColor: 'rgba(195, 180, 160, 0.55)',
};

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Transform a base star color (from bvToRgb) by the theme's saturation + tint.
 * Saturation blends toward WHITE (not luminance grey), so stars stay bright:
 * <1 = mostly white with a subtle tint, 1 = full spectral color, >1 oversaturates.
 * Tint then multiplies per channel. Returns clamped integer RGB 0..255.
 */
export function applyStarColor(
  rgb: [number, number, number],
  theme: SkyThemeConfig,
  saturation: number = theme.starSaturation,
): [number, number, number] {
  const [r0, g0, b0] = rgb;
  const s = saturation;
  const { rMul, gMul, bMul } = theme.starTint;
  const r = (255 + (r0 - 255) * s) * rMul;
  const g = (255 + (g0 - 255) * s) * gMul;
  const b = (255 + (b0 - 255) * s) * bMul;
  return [clamp255(r), clamp255(g), clamp255(b)];
}
