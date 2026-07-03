/**
 * Pure DSO-rendering maths, extracted from `sky-map.ts` for unit testing: angular
 * size → canvas pixels, the per-DSO cos² cache, and position-angle → canvas angle.
 * These depend only on the projection's hemisphere/generation, not on a canvas.
 */
import type { DSO } from './types';
import { getHemisphere, getProjectionGeneration } from './projection';

const DEG2RAD = Math.PI / 180;

/** Convert angular size (arcmin) to canvas pixels accounting for stereographic scale. */
export function angularSizeToCanvasPx(
  arcmin: number,
  decDeg: number,
  scale: number,
  cos2?: number,
): number {
  // cos2 depends only on dec + hemisphere; hot per-DSO callers pass a cached value
  // (see dsoSizeCos2) so the trig runs once per object per hemisphere change instead
  // of 2–3× per object every frame. Same formula either way, so hit-testing (which
  // omits the arg) and rendering stay pixel-identical.
  if (cos2 === undefined) {
    const colatitude = getHemisphere() === 'south' ? 90 + decDeg : 90 - decDeg;
    const theta = (colatitude * Math.PI) / 180;
    cos2 = Math.cos(theta / 2) ** 2;
  }
  const rad = ((arcmin / 60) * Math.PI) / 180;
  return (rad / (2 * cos2)) * scale;
}

/**
 * Body-radius threshold (projection units) above which a DSO bypasses the viewport
 * spatial index and is always considered in `SkyMap.selectRenderedDSOs`. Keeps
 * the query margin tight for the ~99% of normal objects; ~0.04 PU ≈ a 4.6° radius.
 */
export const DSO_GIANT_BODY_PU = 0.04;

/**
 * Cached `cos²((90∓dec)/2)` factor for a DSO's angular-size conversion. Invalidated
 * by the projection generation (hemisphere change), matching the formula in
 * {@link angularSizeToCanvasPx}.
 */
export function dsoSizeCos2(dso: DSO): number {
  if (dso._cos2g !== getProjectionGeneration()) {
    const colatitude = getHemisphere() === 'south' ? 90 + dso.dec : 90 - dso.dec;
    const theta = (colatitude * Math.PI) / 180;
    dso._cos2 = Math.cos(theta / 2) ** 2;
    dso._cos2g = getProjectionGeneration();
  }
  return dso._cos2!;
}

/** Position angle (E of celestial north) → angle on canvas. */
export function dsoCanvasAngle(pa: number, raDeg: number, viewRotationDeg: number): number {
  const raRad = (raDeg * Math.PI) / 180;
  const northAngle = Math.atan2(Math.cos(raRad), -Math.sin(raRad));
  return northAngle - (pa * Math.PI) / 180 + viewRotationDeg * DEG2RAD;
}
