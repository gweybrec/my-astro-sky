/**
 * The **active projection's** local behaviour at a sky point, measured rather than
 * assumed: how far one degree of sky spans there, and which way celestial north and east
 * point on screen.
 *
 * Everything that draws a shape of known angular size at a known position angle needs
 * these two quantities. The closed forms they replace — `1/(2·cos²((90−dec)/2))` for the
 * scale and `atan2(cos ra, −sin ra)` for north — are only valid for the *pole-centred*
 * stereographic map. In the Local Sky view (`CenterMode: 'zenith'`) the projection's pole is
 * the observer's zenith, so the scale must key on altitude and north is rotated by the
 * parallactic angle. Differencing `project()` gets both right for free, in every centre
 * mode, projection mode and hemisphere — the same reason photos, which fit an affine through
 * real projected control points, were never affected by the zenith bugs.
 *
 * The east-west handedness is measured too, but empirically it is the same (−1) in every
 * mode the app offers: `project()`'s zenith branch negates x specifically so the dome keeps
 * the celestial map's "looking up, East on the left" sense rather than mirroring it. Deriving
 * it instead of hardcoding −1 costs nothing and keeps the PA convention self-consistent if a
 * future projection ever does flip.
 *
 * Measurement happens in **projection units**, before `toCanvas`. Pan and zoom don't affect
 * angles at all, and the map rotation is a plain additive term, so the measured part depends
 * only on (ra, dec) and the projection generation — cheap to cache (see `dsoCanvasAngle`).
 * Note the additive term is **−rotationDeg**: `toCanvas` maps a delta (dx, dy) to
 * (dx·cos+dy·sin, −dx·sin+dy·cos), which *decreases* an atan2 angle by θ.
 *
 * Exactness: both stereographic forms are conformal, so scale is isotropic and a shape of
 * known size and PA maps to a true rotated rectangle/ellipse on canvas — these two numbers
 * are all it takes. In pole/stereo mode {@link projUnitsPerDeg} reproduces the old closed
 * form to ~1e-9 relative (it *is* d/dθ of `r = tan(θ/2)`), so switching to it is a no-op for
 * the default view. Fisheye (orthographic) is not conformal; there the measured value is the
 * radial scale and tangential extents stay approximate, as they already were.
 */
import type { Point, ViewState } from './types';
import { project } from './projection';

const DEG2RAD = Math.PI / 180;

/**
 * Half-width of the central difference, degrees. Central differencing is second-order, so
 * this lands within ~1e-9 relative of the analytic derivative — tight enough that the
 * pole-centred map is provably unchanged — while staying far above the projection trig's
 * cancellation floor.
 */
const H_DEG = 0.005;

/** `project()` flags off-projection points with 1e6 (below horizon / far hemisphere). */
export const OFF_PROJECTION = 1e5;

/** Projected point, or null when the sky point is off-projection. */
function projOrNull(raDeg: number, decDeg: number): Point | null {
  const p = project(raDeg, decDeg);
  return p.x >= OFF_PROJECTION || p.y >= OFF_PROJECTION ? null : p;
}

/**
 * Whether a sky point is actually on the projection. False below the horizon in zenith
 * mode and on the far hemisphere in pole-centred fisheye — cases where `project()` returns
 * a sentinel and any measurement around the point is meaningless.
 */
export function isSkyPointVisible(raDeg: number, decDeg: number): boolean {
  return projOrNull(raDeg, decDeg) !== null;
}

/**
 * Tangent vector of the projection at (ra, dec) along one sky axis, in **canvas
 * orientation** (y flipped, since projection y is up) and per degree of sky.
 *
 * Central difference where both samples land on the projection; a one-sided difference when
 * one of them doesn't — which happens right at the Local Sky horizon and against the poles.
 * Null when the point itself is off-projection.
 */
function tangent(
  raDeg: number,
  decDeg: number,
  dRa: number,
  dDec: number,
): { x: number; y: number } | null {
  const plus = projOrNull(raDeg + dRa * H_DEG, decDeg + dDec * H_DEG);
  const minus = projOrNull(raDeg - dRa * H_DEG, decDeg - dDec * H_DEG);
  if (plus && minus) {
    return { x: (plus.x - minus.x) / (2 * H_DEG), y: -(plus.y - minus.y) / (2 * H_DEG) };
  }
  const c = projOrNull(raDeg, decDeg);
  if (!c) return null;
  if (plus) return { x: (plus.x - c.x) / H_DEG, y: -(plus.y - c.y) / H_DEG };
  if (minus) return { x: (c.x - minus.x) / H_DEG, y: -(c.y - minus.y) / H_DEG };
  return null;
}

/**
 * The two local sky axes at (ra, dec) as canvas-oriented tangent vectors per degree:
 * `north` along increasing declination, `east` along increasing right ascension. The RA step
 * is scaled by sec(dec) so both are the same arc length (RA converges toward the poles).
 */
function skyTangents(
  raDeg: number,
  decDeg: number,
): { north: { x: number; y: number }; east: { x: number; y: number } } | null {
  // Pull the sample point a hair off the poles. Exactly at ±90° the direction of north is
  // genuinely undefined (every meridian converges there) and a centred difference would want
  // to step over the pole and wrap the RA. H_DEG of declination is far below a pixel at any
  // usable zoom, and the scale it yields matches the analytic pole value to ~1e-8.
  const dec = Math.max(-90 + H_DEG, Math.min(90 - H_DEG, decDeg));
  const north = tangent(raDeg, dec, 0, 1);
  const east = tangent(raDeg, dec, 1 / Math.max(0.01, Math.cos(dec * DEG2RAD)), 0);
  if (!north || !east) return null;
  return { north, east };
}

/**
 * Projection units per degree of sky at (ra, dec) under the active projection.
 * Returns 0 when the point is off-projection, so callers sizing a shape there collapse it
 * to nothing instead of drawing garbage.
 */
export function projUnitsPerDeg(raDeg: number, decDeg: number): number {
  const t = skyTangents(raDeg, decDeg);
  if (!t) return 0;
  return Math.hypot(t.north.x, t.north.y);
}

/** Canvas pixels per degree of sky at (ra, dec). {@link projUnitsPerDeg} times the zoom. */
export function canvasPxPerDeg(
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'scale'>,
): number {
  return projUnitsPerDeg(raDeg, decDeg) * view.scale;
}

export interface SkyAxes {
  /**
   * Angle of increasing declination in the canvas atan2 convention (x right, y **down**),
   * excluding the map rotation. Add `−view.rotationDeg` in radians for the on-screen angle
   * — {@link canvasSkyAxes} does this.
   */
  northAngle: number;
  /**
   * The sign by which a position angle advances the canvas angle:
   * `canvasAngle = northAngle + eastSign · pa`. −1 for every projection the app currently
   * offers (pole and zenith alike — see the module header), so this is a self-consistency
   * guard rather than a behavioural switch.
   */
  eastSign: 1 | -1;
}

/**
 * Local celestial axes at (ra, dec), measured in projection units (map rotation excluded so
 * the result is pan/zoom/rotation-invariant and cacheable per projection generation).
 * Off-projection points get a neutral result — north straight up, pole-centred handedness —
 * so callers never see NaN.
 */
export function skyAxesProj(raDeg: number, decDeg: number): SkyAxes {
  const t = skyTangents(raDeg, decDeg);
  if (!t) return { northAngle: -Math.PI / 2, eastSign: -1 };
  const { north, east } = t;
  // z of north × east: positive means east sits at a greater atan2 angle than north, i.e.
  // advancing the PA increases the canvas angle. Equals sin(eastAngle − northAngle) up to a
  // positive factor, but without the two atan2 calls.
  const cross = north.x * east.y - north.y * east.x;
  return {
    northAngle: Math.atan2(north.y, north.x),
    eastSign: cross > 0 ? 1 : -1,
  };
}

/** {@link skyAxesProj} with the live map rotation folded in. */
export function canvasSkyAxes(
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'rotationDeg'>,
): SkyAxes {
  const a = skyAxesProj(raDeg, decDeg);
  return { northAngle: a.northAngle - view.rotationDeg * DEG2RAD, eastSign: a.eastSign };
}

/**
 * Canvas angle of the direction at position angle `paDeg` (°E of celestial north) from
 * (ra, dec) — the projection-aware replacement for `northAngle − pa` in the old
 * pole-centred helpers. Used to orient anything whose rotation is stored as a PA.
 */
export function paToCanvasAngle(
  paDeg: number,
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'rotationDeg'>,
): number {
  const { northAngle, eastSign } = canvasSkyAxes(raDeg, decDeg, view);
  return northAngle + eastSign * paDeg * DEG2RAD;
}

/** Inverse of {@link paToCanvasAngle}: a canvas angle → PA (°E of N), normalised to [0, 360). */
export function canvasAngleToPa(
  canvasAngle: number,
  raDeg: number,
  decDeg: number,
  view: Pick<ViewState, 'rotationDeg'>,
): number {
  const { northAngle, eastSign } = canvasSkyAxes(raDeg, decDeg, view);
  const pa = (eastSign * (canvasAngle - northAngle)) / DEG2RAD;
  return ((pa % 360) + 360) % 360;
}
