import type { Point, ViewState } from './types';
import { altAzFromRaDec, raDecFromAltAz } from './sky-geometry';

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

// ─── Center mode ────────────────────────────────────────────────────────────────
// 'pole' (default) = today's celestial-pole-centered map (RA/Dec native, observer-
// independent). 'zenith' = the "local sky" view: altitude 90° (zenith) at the
// origin, azimuth grid drawn as concentric rings — requires an observer LST/latitude
// (see setProjectionObserver) to convert RA/Dec to alt/az before applying the same
// radial formula _projectionMode already selects. Orthogonal to _projectionMode:
// stereo/fisheye still choose the radial falloff, just now centered on zenith.
// _hemisphere is meaningless while this is 'zenith' (zenith has no north/south).

export type CenterMode = 'pole' | 'zenith';
let _centerMode: CenterMode = 'pole';

// Observer LST (hours) / latitude (degrees) used only while _centerMode === 'zenith'.
let _obsLstH = 0;
let _obsLatDeg = 0;

// Bumped whenever hemisphere, projection mode, or center mode changes. project()
// output for a fixed (ra, dec) depends only on these globals (pan/zoom/rotation are
// applied later by toCanvas), so cached projections are valid until this generation
// moves.
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

export function setCenterMode(mode: CenterMode): void {
  if (mode === _centerMode) return;
  _centerMode = mode;
  _projGeneration++;
}

export function getCenterMode(): CenterMode {
  return _centerMode;
}

/**
 * Observer LST/latitude for the zenith-centered ("local sky") projection. Always
 * stored (harmless while centerMode is 'pole'); only bumps _projGeneration — and
 * thus invalidates projectCached()'s memo — while zenith mode is active, so the
 * pole-centered modes never pay this cost on every simulated-time tick.
 */
export function setProjectionObserver(lstH: number, latDeg: number): void {
  _obsLstH = lstH;
  _obsLatDeg = latDeg;
  if (_centerMode === 'zenith') _projGeneration++;
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
  if (_centerMode === 'zenith') {
    const { altDeg, azDeg } = altAzFromRaDec(raDeg, decDeg, _obsLstH, _obsLatDeg);
    const azRad = azDeg * DEG2RAD;
    if (altDeg < 0) return { x: 1e6, y: 1e6 }; // below horizon, clipped (both radial forms)
    // Negate x: azimuth increases clockwise-from-north (E=90°, W=270°), the opposite
    // east-west sense to RA. Reusing the celestial x = r·sin(θ) form unflipped would
    // mirror the dome (East on screen-right). Looking up at the sky with North at top,
    // East belongs on the left and West on the right, so flip the azimuth component.
    if (_projectionMode === 'fisheye') {
      const r = Math.cos(altDeg * DEG2RAD);
      return { x: -r * Math.sin(azRad), y: r * Math.cos(azRad) };
    }
    const r = Math.tan(((90 - altDeg) / 2) * DEG2RAD);
    return { x: -r * Math.sin(azRad), y: r * Math.cos(azRad) };
  }
  if (_projectionMode === 'fisheye') {
    const decN = _hemisphere === 'south' ? -decDeg : decDeg;
    if (decN < 0) return { x: 1e6, y: 1e6 }; // far hemisphere, clipped
    const r = Math.cos(decN * DEG2RAD);
    const raRad = raDeg * DEG2RAD;
    return { x: r * Math.sin(raRad), y: r * Math.cos(raRad) };
  }
  const raRad = raDeg * DEG2RAD;
  const r =
    _hemisphere === 'south'
      ? Math.tan(((90 + decDeg) / 2) * DEG2RAD)
      : Math.tan(((90 - decDeg) / 2) * DEG2RAD);
  return {
    x: r * Math.sin(raRad),
    y: r * Math.cos(raRad),
  };
}

/**
 * Zenith ("local sky") mode only: given two sky points that straddle the horizon
 * (one above, one below alt=0), return the projection-unit (x, y) of the alt=0 point
 * between them, so a line joining a visible star to a below-horizon one can be clipped
 * exactly at the rim (r=1) instead of vanishing entirely. See drawConstellationLines.
 *
 * Bisects on altitude along the great circle joining the two directions, in the
 * horizontal frame (so no RA/360° wrap handling is needed). Returns null when both
 * points are on the same side of the horizon (no crossing to find). At the horizon
 * r=1 for both the stereo and fisheye radial forms, so only the azimuth matters here;
 * x is negated to match project()'s dome handedness (East on screen-left).
 */
export function zenithHorizonCrossing(
  raA: number,
  decA: number,
  raB: number,
  decB: number,
): Point | null {
  const a = altAzFromRaDec(raA, decA, _obsLstH, _obsLatDeg);
  const b = altAzFromRaDec(raB, decB, _obsLstH, _obsLatDeg);
  if (a.altDeg >= 0 === b.altDeg >= 0) return null; // same side of horizon

  const toVec = (altDeg: number, azDeg: number): [number, number, number] => {
    const al = altDeg * DEG2RAD;
    const az = azDeg * DEG2RAD;
    const ca = Math.cos(al);
    return [ca * Math.sin(az), ca * Math.cos(az), Math.sin(al)]; // z = up
  };
  // Keep `above` on the z≥0 side and `below` on the z<0 side for a clean bisection.
  let above = toVec(a.altDeg, a.azDeg);
  let below = toVec(b.altDeg, b.azDeg);
  if (a.altDeg < 0) [above, below] = [below, above];

  for (let i = 0; i < 24; i++) {
    const mx = (above[0] + below[0]) / 2;
    const my = (above[1] + below[1]) / 2;
    const mz = (above[2] + below[2]) / 2;
    const len = Math.hypot(mx, my, mz) || 1;
    const mid: [number, number, number] = [mx / len, my / len, mz / len];
    if (mid[2] >= 0) above = mid;
    else below = mid;
  }
  const az = Math.atan2(above[0] + below[0], above[1] + below[1]);
  return { x: -Math.sin(az), y: Math.cos(az) };
}

/**
 * Object whose sky position is fixed for the lifetime of the app (stars, DSOs) and
 * which carries slots to memoise its projection. See {@link projectCached}.
 */
export interface ProjCacheHost {
  ra: number;
  dec: number;
  _px?: number; // cached projection-unit x
  _py?: number; // cached projection-unit y
  _pg?: number; // projection generation the cache was computed for
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

// ─── Observer/time generation (date-mode horizon visibility) ──────────────────
// Separate from _projGeneration: hemisphere/mode changes affect every projected
// point, but a simulated-date/location change only affects horizon visibility
// (altitude), so it gets its own counter — bumping it never invalidates _px/_py.

let _obsGeneration = 0;

/** Current observer/time generation; see {@link isBelowHorizonCached}. */
export function getObsGeneration(): number {
  return _obsGeneration;
}

/**
 * Call when the simulated date/time or observer lat/lon actually changes (from
 * SkyMap's setSkyTimeMode/setSimDate/setObserverLocation) — never on pan/zoom/render.
 */
export function bumpObsGeneration(): void {
  _obsGeneration++;
}

/**
 * Object whose below-horizon state can be memoised across frames (stars, DSOs).
 * Mirrors {@link ProjCacheHost}'s generation-stamped cache idiom.
 */
export interface ObsCacheHost {
  ra: number;
  dec: number;
  _altDeg?: number;
  _belowHorizon?: boolean;
  _ag?: number; // observer generation the cache was computed for
}

/**
 * Below-horizon test for a fixed-position object (star/DSO), memoised per observer
 * generation. altAzFromRaDec does several trig calls; recomputing it for ~118k stars
 * every frame (including pan/zoom animation frames) would be a real cost, so — exactly
 * like {@link projectCached} — the result is cached on the object and only recomputed
 * when `_obsGeneration` has moved since the last call.
 */
export function isBelowHorizonCached(o: ObsCacheHost, lstH: number, latDeg: number): boolean {
  if (o._ag !== _obsGeneration) {
    o._altDeg = altAzFromRaDec(o.ra, o.dec, lstH, latDeg).altDeg;
    o._belowHorizon = o._altDeg < 0;
    o._ag = _obsGeneration;
  }
  return o._belowHorizon!;
}

/** Inverse projection: projection (x, y) → { ra°, dec° } */
export function unproject(x: number, y: number): { ra: number; dec: number } {
  if (_centerMode === 'zenith') {
    const r = Math.sqrt(x * x + y * y);
    const altDeg =
      _projectionMode === 'fisheye'
        ? 90 - Math.asin(Math.min(1, r)) * RAD2DEG
        : 90 - 2 * Math.atan(r) * RAD2DEG;
    let azDeg = Math.atan2(-x, y) * RAD2DEG; // matches the negated x in project()'s zenith branch
    if (azDeg < 0) azDeg += 360;
    const { raDeg, decDeg } = raDecFromAltAz(altDeg, azDeg, _obsLstH, _obsLatDeg);
    return { ra: raDeg, dec: decDeg };
  }
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
  const dec =
    _hemisphere === 'south' ? 2 * Math.atan(r) * RAD2DEG - 90 : 90 - 2 * Math.atan(r) * RAD2DEG;
  let ra = Math.atan2(x, y) * RAD2DEG;
  if (ra < 0) ra += 360;
  return { ra, dec };
}

/**
 * Local area scale of the ACTIVE projection at projection-unit (px, py), relative to
 * the map centre (=1) — i.e. how much screen area one steradian of sky covers here
 * versus at the centre. The render budget multiplies its per-object cutoff by this so
 * that a set which is uniform per steradian draws uniformly per unit *screen* area
 * (fewer objects near the centre, more toward the edge) — cancelling the projection's
 * area distortion without touching project()/toCanvas() or the constellations.
 *
 * Derivations (r² = px² + py², since project() already stores _px/_py):
 *   Stereo (pole or zenith): r = tan(θ/2) ⇒ area scale = sec⁴(θ/2) = (1 + r²)².
 *     1 at the centre (r=0) → ~47 at the default Dec −45° rim (r ≈ 2.41).
 *   Fisheye (orthographic, pole-centred): r = sin θ ⇒ area scale = cos θ = √(1 − r²).
 *     The opposite sense (compresses the rim), so the same weighting flattens it too.
 * Zenith mode uses the stereo radial form regardless of _projectionMode (its fisheye
 * rim is r=1), so only pole-centred fisheye takes the orthographic branch.
 */
export function projectionAreaFactor(px: number, py: number): number {
  const r2 = px * px + py * py;
  if (_projectionMode === 'fisheye' && _centerMode !== 'zenith') {
    return Math.sqrt(Math.max(0, 1 - r2));
  }
  return (1 + r2) * (1 + r2);
}

/**
 * Projection-unit radius of the border circle for a given border latitude.
 * In zenith mode: the border is the horizon (alt=0), always r = 1.0 for either
 * radial form.
 * In fisheye mode: the border is the equator circle (r = 1.0), the outer edge
 * of the visible hemisphere.
 * In stereo mode: r = tan((90 + lat) / 2).
 */
export function borderRadiusPU(borderLatDeg: number): number {
  if (_centerMode === 'zenith') return 1.0; // horizon — both radial forms give exactly 1.0 at alt=0
  if (_projectionMode === 'fisheye') return 1.0;
  return Math.tan(((90 + borderLatDeg) / 2) * DEG2RAD);
}

/**
 * True when a screen-space point (canvas px) lies within the visible sky circle
 * (the border ring). Mirrors the clip the render loop applies: centre is the
 * projected pole `toCanvas(0, 0)`, radius is `borderRadiusPU(borderLatDeg) * scale`.
 * Used to gate hover/hit-testing so a tooltip never fires for a cursor sitting in
 * the black corners outside the rim. A non-finite border radius (no border set)
 * means "no clipping" → always inside.
 */
export function isInsideBorderCircle(
  mx: number,
  my: number,
  view: ViewState,
  borderLatDeg: number,
): boolean {
  const r = borderRadiusPU(borderLatDeg) * view.scale;
  if (!isFinite(r)) return true;
  const origin = toCanvas(0, 0, view);
  return Math.hypot(mx - origin.x, my - origin.y) <= r;
}

/**
 * View scale (canvas px per projection unit) that fits the whole border circle
 * into a cssW × cssH frame, leaving a small margin. Used by the "full sky map"
 * export to frame the entire projection regardless of the current zoom.
 */
export function fitScaleForBorderCircle(
  cssW: number,
  cssH: number,
  borderLatDeg: number,
  margin = 0.96,
): number {
  const r = borderRadiusPU(borderLatDeg);
  if (r <= 0 || !isFinite(r)) return 0;
  return (Math.min(cssW, cssH) / 2 / r) * margin;
}

/** Projection coordinates → canvas pixel coordinates */
export function toCanvas(px: number, py: number, view: ViewState): Point {
  const theta = view.rotationDeg * DEG2RAD;
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
  const theta = view.rotationDeg * DEG2RAD;
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
