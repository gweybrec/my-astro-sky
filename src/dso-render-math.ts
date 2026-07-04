/**
 * Pure DSO-rendering maths, extracted from `sky-map.ts` for unit testing: angular
 * size → canvas pixels, the per-DSO cos² cache, and position-angle → canvas angle.
 * These depend only on the projection's hemisphere/generation, not on a canvas.
 */
import type { DSO } from './types';
import { getHemisphere, getProjectionGeneration, getCenterMode } from './projection';

const DEG2RAD = Math.PI / 180;

/** Convert angular size (arcmin) to canvas pixels accounting for stereographic scale. */
export function angularSizeToCanvasPx(
  arcmin: number,
  decDeg: number,
  scale: number,
  cos2?: number,
): number {
  // cos2 depends only on dec + hemisphere (or, in zenith mode, altitude); hot
  // per-DSO callers pass a cached value (see dsoSizeCos2) so the trig runs once per
  // object per projection-generation change instead of 2–3× per object every frame.
  // Same formula either way, so hit-testing (which omits the arg) and rendering
  // stay pixel-identical.
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
 *
 * In zenith ("local sky") mode the projection's pole is the observer's zenith, not
 * the celestial pole, so the correct colatitude input is `90 − altitude`, not dec —
 * pass `altDeg` (from the caller's already-computed `isBelowHorizonCached`/altAz
 * result) whenever `getCenterMode() === 'zenith'`. This uses a *separate* cache slot
 * (`_cos2z`/`_cos2zg`) from the dec-based one: some callers in the same generation
 * (e.g. `ensureDsoAllIndex`'s giant-DSO bucketing, hover-hit-test's fine-grained
 * pick) don't have an altitude on hand and fall back to the dec/hemisphere formula
 * — sharing one cache slot would let whichever call happens first silently poison
 * the result for the other.
 */
export function dsoSizeCos2(dso: DSO, altDeg?: number): number {
  const gen = getProjectionGeneration();
  if (getCenterMode() === 'zenith' && altDeg !== undefined) {
    if (dso._cos2zg !== gen) {
      const theta = ((90 - altDeg) * Math.PI) / 180;
      dso._cos2z = Math.cos(theta / 2) ** 2;
      dso._cos2zg = gen;
    }
    return dso._cos2z!;
  }
  if (dso._cos2g !== gen) {
    const colatitude = getHemisphere() === 'south' ? 90 + dso.dec : 90 - dso.dec;
    const theta = (colatitude * Math.PI) / 180;
    dso._cos2 = Math.cos(theta / 2) ** 2;
    dso._cos2g = gen;
  }
  return dso._cos2!;
}

/** Position angle (E of celestial north) → angle on canvas. */
export function dsoCanvasAngle(pa: number, raDeg: number, viewRotationDeg: number): number {
  const raRad = (raDeg * Math.PI) / 180;
  const northAngle = Math.atan2(Math.cos(raRad), -Math.sin(raRad));
  return northAngle - (pa * Math.PI) / 180 + viewRotationDeg * DEG2RAD;
}
