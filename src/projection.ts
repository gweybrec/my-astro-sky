import type { Point, ViewState } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─── Hemisphere module state ──────────────────────────────────────────────────
// All callers use project() / unproject() without a parameter change; the
// active hemisphere is a global setting that changes only when the user toggles.

let _hemisphere: 'north' | 'south' = 'north';

// ─── Projection mode ──────────────────────────────────────────────────────────
// 'stereo' = stereographic polar (default)
// 'fisheye' = orthographic azimuthal, pole-centred (the visible hemisphere as a dome)

export type ProjectionMode = 'stereo' | 'fisheye';
let _projectionMode: ProjectionMode = 'stereo';

// Bumped whenever hemisphere or projection mode changes. project() output for a
// fixed (ra, dec) depends only on these two globals (pan/zoom/rotation are applied
// later by toCanvas), so cached projections are valid until this generation moves.
let _projGeneration = 0;

/** Current projection generation; see {@link projectCached}. */
export function getProjectionGeneration(): number {
  return _projGeneration;
}

export function setProjectionMode(mode: ProjectionMode): void {
  if (mode === _projectionMode) return;
  _projectionMode = mode;
  _projGeneration++;
}

export function getProjectionMode(): ProjectionMode {
  return _projectionMode;
}

export function setHemisphere(h: 'north' | 'south'): void {
  if (h === _hemisphere) return;
  _hemisphere = h;
  _projGeneration++;
}

/**
 * Force every cached projection to recompute on next use, without a hemisphere/mode
 * change. Call when an object's own `ra`/`dec` changed (e.g. a DSO coordinate
 * override) so {@link projectCached} and generation-keyed spatial indexes don't keep
 * serving its old position.
 */
export function invalidateProjections(): void {
  _projGeneration++;
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
 *
 * In fisheye mode: orthographic azimuthal projection centred on the celestial
 * pole — the visible hemisphere seen head-on as a dome/globe. Same centre and RA
 * orientation as the stereographic map; only the radial scaling differs, so no
 * observer location or time is involved.
 *   pole angle p = 90 − dec'   (dec' = dec in north, −dec in south)
 *   r = sin(p) = cos(dec')      — 0 at the pole, 1 at the equator
 *   x = r * sin(ra), y = r * cos(ra)
 *   The far hemisphere folds back onto the near one, so it is clipped off-canvas.
 */
export function project(raDeg: number, decDeg: number): Point {
  if (_projectionMode === 'fisheye') {
    const decN = _hemisphere === 'south' ? -decDeg : decDeg;
    if (decN < 0) return { x: 1e6, y: 1e6 }; // far hemisphere, clipped
    const r = Math.cos(decN * DEG2RAD);
    const raRad = raDeg * DEG2RAD;
    return { x: r * Math.sin(raRad), y: r * Math.cos(raRad) };
  }
  const raRad = raDeg * DEG2RAD;
  const r = _hemisphere === 'south'
    ? Math.tan((90 + decDeg) / 2 * DEG2RAD)
    : Math.tan((90 - decDeg) / 2 * DEG2RAD);
  return {
    x: r * Math.sin(raRad),
    y: r * Math.cos(raRad),
  };
}

/**
 * Object whose sky position is fixed for the lifetime of the app (stars, DSOs) and
 * which carries slots to memoise its projection. See {@link projectCached}.
 */
export interface ProjCacheHost {
  ra: number;
  dec: number;
  _px?: number;  // cached projection-unit x
  _py?: number;  // cached projection-unit y
  _pg?: number;  // projection generation the cache was computed for
}

/**
 * Project a fixed-position object once per hemisphere/mode change and reuse the
 * stored projection-unit coords on every subsequent frame. project() does trig +
 * an allocation per call; for the 10k+ stars/DSOs redrawn on every pan frame that
 * dominated the render loop, yet the result only changes when the projection
 * generation moves. Writes _px/_py onto the object — read them directly afterwards
 * (no return value) so panning never re-projects or allocates.
 */
export function projectCached(o: ProjCacheHost): void {
  if (o._pg !== _projGeneration) {
    const p = project(o.ra, o.dec);
    o._px = p.x;
    o._py = p.y;
    o._pg = _projGeneration;
  }
}

/** Inverse projection: projection (x, y) → { ra°, dec° } */
export function unproject(x: number, y: number): { ra: number; dec: number } {
  if (_projectionMode === 'fisheye') {
    const r = Math.sqrt(x * x + y * y);
    const p = Math.asin(Math.min(1, r)) * RAD2DEG; // pole angle (orthographic inverse)
    const decN = 90 - p;
    const dec = _hemisphere === 'south' ? -decN : decN;
    let ra = Math.atan2(x, y) * RAD2DEG;
    if (ra < 0) ra += 360;
    return { ra, dec };
  }
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
 * In fisheye mode: the border is the equator circle (r = 1.0), the outer edge
 * of the visible hemisphere.
 * In stereo mode: r = tan((90 + lat) / 2).
 */
export function borderRadiusPU(borderLatDeg: number): number {
  if (_projectionMode === 'fisheye') return 1.0;
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
