/**
 * GearPreset — computed representation consumed by the recommender and recipe engine.
 * Built dynamically from a telescope + camera + optional accessory selection; not
 * stored or edited by the user directly.
 */

export interface GearPreset {
  /** Objective aperture in mm */
  apertureMm: number;
  /** Effective focal length in mm (after reducer/barlow) */
  focalLengthMm: number;
  /** Sensor width in mm */
  sensorWidthMm: number;
  /** Sensor height in mm */
  sensorHeightMm: number;
  /** Pixel size in µm */
  pixelSizeUm: number;
  /** true = monochrome sensor (can use narrowband Ha/OIII/SII) */
  mono: boolean;
  /** true = integrated/smart telescope (camera not user-configurable) */
  builtIn: boolean;
  /** true = scope has a built-in dual-band (Hα+OIII) filter it can engage */
  hasDualBandFilter: boolean;
  /** Maximum sub-exposure enforced by the telescope firmware (smart scopes only) */
  maxSubSec?: number;
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

/** Field of view in degrees { wDeg, hDeg } — uses accurate arc-tangent formula */
export function fovDeg(p: GearPreset): { wDeg: number; hDeg: number } {
  const wDeg = 2 * Math.atan(p.sensorWidthMm / (2 * p.focalLengthMm)) * (180 / Math.PI);
  const hDeg = 2 * Math.atan(p.sensorHeightMm / (2 * p.focalLengthMm)) * (180 / Math.PI);
  return { wDeg, hDeg };
}

/** Pixel scale in arcseconds/pixel */
export function pixelScaleArcsec(p: GearPreset): number {
  return (p.pixelSizeUm / 1000 / p.focalLengthMm) * (180 / Math.PI) * 3600;
}

/**
 * Smallest separation the setup can actually record, in arcseconds — the coarser of the
 * aperture diffraction limit (Dawes, 116/D mm) and ~2× the pixel scale (need a couple of
 * pixels across the gap to separate two stars). Used to gate double-star ratings.
 */
export function resolvingLimitArcsec(p: GearPreset): number {
  const diffraction = p.apertureMm > 0 ? 116 / p.apertureMm : Infinity;
  return Math.max(diffraction, 2 * pixelScaleArcsec(p));
}

/** Formats a FOV as "24'" or "1.5°", width × height */
export function formatFov(wDeg: number, hDeg: number): string {
  const fmt = (d: number) => (d >= 1 ? `${d.toFixed(1)}°` : `${(d * 60).toFixed(0)}'`);
  return `${fmt(wDeg)} × ${fmt(hDeg)}`;
}

/** Short label used on the sky map frame: "1280 mm · FOV 24' × 18' · 1.0″/px" */
export function formatGearFovLabel(p: GearPreset): string {
  const fov = fovDeg(p);
  const scale = pixelScaleArcsec(p);
  const fl = p.focalLengthMm.toFixed(0);
  return `${fl} mm · FOV ${formatFov(fov.wDeg, fov.hDeg)} · ${scale.toFixed(1)}″/px`;
}

/** Canvas label drawn on the FOV frame: "My Setup · 2.1° × 1.4°" */
export function formatSetupCanvasLabel(name: string, wDeg: number, hDeg: number): string {
  return `${name} · ${formatFov(wDeg, hDeg)}`;
}

/**
 * Visual limiting magnitude (Pogson):
 *   magLimit = 2 + 5·log10(D_mm)
 * For astrophotography we add a photographic bonus because long exposures
 * capture much fainter objects than the eye.  We cap at 15 to stay realistic.
 */
export function limitingMag(p: GearPreset, photographicBonus = 4): number {
  return Math.min(15, 2 + 5 * Math.log10(p.apertureMm) + photographicBonus);
}

/**
 * Computes the sky-map scale at which the larger FOV dimension fills
 * `fillFraction` of the shorter canvas axis.
 *
 * Mirrors the cos² correction used in angularSizeToCanvasPx (sky-map.ts):
 *   halfPx = (halfDeg · π/180) / (2 · cos²(colatitude/2)) · scale
 * Solving for scale with halfPx = canvasMinDim · fillFraction / 2 gives this formula.
 */
export function computeFovTargetScale(
  wDeg: number,
  hDeg: number,
  decDeg: number,
  hemisphere: 'north' | 'south',
  canvasMinDim: number,
  fillFraction = 0.33,
): number {
  const maxDeg = Math.max(wDeg, hDeg);
  const colatitude = hemisphere === 'south' ? 90 + decDeg : 90 - decDeg;
  const theta = (colatitude * Math.PI) / 180;
  const cos2 = Math.cos(theta / 2) ** 2;
  return Math.max(
    300,
    Math.min(50000, (canvasMinDim * fillFraction * cos2) / ((maxDeg * Math.PI) / 360)),
  );
}
