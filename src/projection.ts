import type { Point, ViewState } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─── Hemisphere module state ──────────────────────────────────────────────────
// All callers use project() / unproject() without a parameter change; the
// active hemisphere is a global setting that changes only when the user toggles.

let _hemisphere: 'north' | 'south' = 'north';

export function setHemisphere(h: 'north' | 'south'): void {
  _hemisphere = h;
}

export function getHemisphere(): 'north' | 'south' {
  return _hemisphere;
}

/**
 * Stereographic polar projection: (RA°, Dec°) → projection (x, y).
 *
 * North mode: NCP at origin, equator at r=1, RA counter-clockwise.
 * South mode: SCP at origin, equator at r=1, same RA orientation.
 *
 * r formula:
 *   North: r = tan((90 − dec) / 2)   — 0 at NCP (+90°), 1 at equator, ∞ at SCP (−90°)
 *   South: r = tan((90 + dec) / 2)   — 0 at SCP (−90°), 1 at equator, ∞ at NCP (+90°)
 */
export function project(raDeg: number, decDeg: number): Point {
  const raRad = raDeg * DEG2RAD;
  const r = _hemisphere === 'south'
    ? Math.tan((90 + decDeg) / 2 * DEG2RAD)
    : Math.tan((90 - decDeg) / 2 * DEG2RAD);
  return {
    x: r * Math.sin(raRad),
    y: r * Math.cos(raRad),
  };
}

/** Inverse projection: projection (x, y) → { ra°, dec° } */
export function unproject(x: number, y: number): { ra: number; dec: number } {
  const r = Math.sqrt(x * x + y * y);
  const dec = _hemisphere === 'south'
    ? 2 * Math.atan(r) * RAD2DEG - 90
    : 90 - 2 * Math.atan(r) * RAD2DEG;
  let ra = Math.atan2(x, y) * RAD2DEG;
  if (ra < 0) ra += 360;
  return { ra, dec };
}

/**
 * Projection-unit radius of the border circle for a given border latitude.
 * Same formula for both hemispheres: r = tan((90 + lat) / 2).
 */
export function borderRadiusPU(borderLatDeg: number): number {
  return Math.tan((90 + borderLatDeg) / 2 * DEG2RAD);
}

/**
 * View scale (canvas px per projection unit) that fits the whole border circle
 * into a cssW × cssH frame, leaving a small margin. Used by the "full sky map"
 * export to frame the entire projection regardless of the current zoom.
 */
export function fitScaleForBorderCircle(cssW: number, cssH: number, borderLatDeg: number, margin = 0.96): number {
  const r = borderRadiusPU(borderLatDeg);
  if (r <= 0 || !isFinite(r)) return 0;
  return (Math.min(cssW, cssH) / 2 / r) * margin;
}

/** Projection coordinates → canvas pixel coordinates */
export function toCanvas(px: number, py: number, view: ViewState): Point {
  const theta = (view.rotationDeg * DEG2RAD);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const dx = (px - view.centerX) * view.scale;
  const dy = -(py - view.centerY) * view.scale;

  // Rotate screen delta by -theta so positive rotation turns the sky counter-clockwise.
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;

  return {
    x: view.width / 2 + rx,
    y: view.height / 2 + ry,
  };
}

/** Canvas pixel coordinates → projection coordinates */
export function fromCanvas(cx: number, cy: number, view: ViewState): Point {
  const theta = (view.rotationDeg * DEG2RAD);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const rx = cx - view.width / 2;
  const ry = cy - view.height / 2;

  // Inverse of toCanvas rotation step (rotate by +theta).
  const dx = rx * cos - ry * sin;
  const dy = rx * sin + ry * cos;

  return {
    x: view.centerX + dx / view.scale,
    y: view.centerY - dy / view.scale,
  };
}
