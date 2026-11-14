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
  // ── Background (radial gradient from the projection centre outward) ──
  /** Solid base color painted first. */
  baseFill: string;
  /**
   * Radial gradient stops [offset 0..1, css color]; 0 = projection centre (the zenith in
   * local-sky mode, the pole otherwise), 1 = the map's border circle (the horizon in
   * local-sky mode). Lighter toward 1 gives the glow of the sky near the horizon.
   */
  bgStops: Array<[number, string]>;
  /** Colour just outside the border circle (around the map), reached shortly past it. */
  bgOutside: string;
  /**
   * Brightness of the Milky Way picture drawn under the stars (0 = none). Scaled by the
   * background-opacity setting relative to its default (0.5), so that slider dims it too.
   */
  milkyWayGain: number;
  /** Picture level (0..1) treated as black: cuts the faint haze around the band. */
  milkyWayBlack: number;
  /**
   * Zoom (view scale, px per projection unit) over which the Milky Way fades out: full up
   * to `from`, gone at `to`. The picture is 4096 px for 360° (~0.09° a pixel); zoomed past
   * ~1500 one of its pixels spans ~2 screen pixels where the band runs, and it turns blocky.
   */
  milkyWayFadeScale: { from: number; to: number };
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
   * Opacity of the faintest star drawn (at the current magnitude limit). Stars up to
   * `faintFadeFromMag` are fully opaque; fainter ones fade linearly down to this value,
   * so brightness reads by light as well as by size.
   */
  faintStarAlpha: number;
  /** Magnitude from which stars start fading toward {@link faintStarAlpha}. */
  faintFadeFromMag: number;
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
  /** Constellation line width in CSS px. */
  constellationLineWidth: number;
  /** Space in CSS px a constellation line leaves beyond the edge of a drawn star it meets. */
  constellationLineGap: number;
  /** Color of the constellation *name* labels (uppercase, letter-spaced). */
  constellationNameColor: string;
  /** Color of the bright-star name labels. */
  starLabelColor: string;

  // ── Moon marker (date-mode / live Moon overlay) ──
  /** Illuminated portion of the Moon disk. */
  moonLitColor: string;
  /** Unlit (shadowed) portion of the Moon disk. */
  moonShadowColor: string;
  /** Outline stroke around the Moon disk. */
  moonOutlineColor: string;

  // ── Sun/planet markers (date-mode overlay, plain colored dots) ──
  sunColor: string;
  mercuryColor: string;
  venusColor: string;
  marsColor: string;
  jupiterColor: string;
  saturnColor: string;
  uranusColor: string;
  neptuneColor: string;
  /** Shared outline stroke for all Sun/planet markers. */
  bodyOutlineColor: string;
  /** Shared name-label color for Sun/planet markers. */
  bodyLabelColor: string;

  // ── Horizon line (date mode, when an observer location is set) ──
  /** Fallback only — SkyMap prefers the live `--accent-color` CSS var so the horizon
   * line matches the current warm/cold UI theme instead of a fixed hardcoded hue. */
  horizonLineColorFallback: string;

  // ── Azimuth (alt-az) grid (date mode, when an observer location is set) ──
  /** A distinct hue from gridColor's blue family so both grids read separately when
   * shown together. */
  azGridColor: string;
  azGridLabelColor: string;
}

/**
 * Realistic dark-BLUE atmospheric sky (not flat black), with mostly-white stars
 * that carry a subtle spectral tint and a soft, colored glow — alive and twinkly.
 */
export const SKY_THEME: SkyThemeConfig = {
  // Deep blue-black base — already has a hint of atmosphere, never pure black
  baseFill: '#040810',
  bgStops: [
    [0.0, 'rgba(6, 10, 22, 0.9)'], // deep navy overhead
    [0.55, 'rgba(14, 24, 48, 0.85)'],
    [0.85, 'rgba(30, 46, 80, 0.85)'],
    [1.0, 'rgba(42, 58, 92, 0.9)'], // lighter blue glow at the horizon
  ],
  bgOutside: 'rgba(7, 12, 26, 0.6)', // dark around the map
  milkyWayGain: 0.25, // kept faint: the photos stay the main thing on the map
  milkyWayBlack: 0.1,
  milkyWayFadeScale: { from: 600, to: 2000 },

  vignette: null,
  // The default background-opacity setting (0.5) then shows the gradient at ~0.8.
  bgOpacityScale: 1.6,
  // Slight cool tint so hot stars read a touch bluer (whites clamp, stay white).
  starTint: { rMul: 0.95, gMul: 0.98, bMul: 1.05 },
  // Mostly white with only a subtle blue/orange tint on the extremes.
  starSaturation: 0.45,
  radiusScale: 0.95,
  faintStarAlpha: 0.35,
  faintFadeFromMag: 4,
  // Bright stars stay prominent when zooming in (the brightest grow most).
  brightZoomBoost: 0.28,
  glowThresholdMag: 2.5, // only the brightest stars earn a halo
  glowRadiusMul: 1.7, // small halo that hugs the star — barely there, just noticed
  glowOpacity: 0.55, // opacity tapers with brightness (set in renderStars)
  glowSaturation: 1.45, // halo is strongly tinted (orange/blue) even though the dot is white
  glowZoomSpread: 1.4, // glow blooms obviously around bright stars when zoomed in
  // Grid + constellation lines in a soft blue family
  gridColor: 'rgba(90, 130, 200, 0.35)',
  gridEquatorColor: 'rgba(120, 165, 235, 0.65)',
  gridLabelColor: 'rgba(155, 190, 240, 0.9)',
  // Teal; the sky-opacity setting (0.7 by default) dims it further on the map (~0.5 seen).
  constellationLineColor: 'rgba(100, 180, 195, 0.72)',
  constellationLineWidth: 1.4,
  constellationLineGap: 2,
  constellationNameColor: 'rgba(115, 185, 195, 0.95)',
  starLabelColor: 'rgba(195, 180, 160, 0.55)',
  // Matches --moon-lit (tokens.css) for visual consistency with the Targets-view glyph.
  moonLitColor: 'rgba(225, 230, 245, 0.92)',
  moonShadowColor: 'rgba(30, 34, 48, 0.9)',
  moonOutlineColor: 'rgba(190, 195, 215, 0.7)',
  // Evocative of each body's real-world hue, tuned for visibility against the dark sky.
  sunColor: 'rgba(255, 214, 120, 0.95)',
  mercuryColor: 'rgba(180, 175, 170, 0.95)',
  venusColor: 'rgba(240, 225, 180, 0.95)',
  marsColor: 'rgba(225, 120, 85, 0.95)',
  jupiterColor: 'rgba(220, 185, 140, 0.95)',
  saturnColor: 'rgba(225, 200, 150, 0.95)',
  uranusColor: 'rgba(150, 220, 230, 0.95)',
  neptuneColor: 'rgba(95, 130, 230, 0.95)',
  bodyOutlineColor: 'rgba(255, 255, 255, 0.6)',
  bodyLabelColor: 'rgba(220, 210, 190, 0.75)',
  horizonLineColorFallback: 'rgba(192, 120, 48, 0.65)',
  // Soft green, well clear of the grid's blue family.
  azGridColor: 'rgba(110, 200, 140, 0.35)',
  azGridLabelColor: 'rgba(150, 220, 175, 0.85)',
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

/**
 * How much of the Milky Way shows at a zoom `scale`: 1 up to `milkyWayFadeScale.from`,
 * easing out to 0 at `milkyWayFadeScale.to` (smoothstep, so it starts and ends without a jump), so its
 * picture never shows blocky.
 */
export function milkyWayZoomFade(scale: number, theme: SkyThemeConfig = SKY_THEME): number {
  const { from, to } = theme.milkyWayFadeScale;
  if (scale <= from) return 1;
  if (scale >= to) return 0;
  const x = (to - scale) / (to - from);
  return x * x * (3 - 2 * x);
}
