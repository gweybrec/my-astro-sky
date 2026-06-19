/**
 * Pure mosaic geometry: lay out a grid of imaging tiles that together cover a
 * region of sky, with a configurable overlap between adjacent tiles.
 *
 * Tiles are positioned with a tangent-plane (gnomonic) offset about the mosaic
 * centre, rotated by the mosaic position angle (PA, °E of N). This is the flat
 * "framing" model astro mosaic planners use; it stays accurate over the few
 * degrees a real mosaic spans and is independent of the sky map's stereographic
 * projection, so it can be unit-tested without any DOM/canvas.
 *
 * Overlap is expressed as a percentage (e.g. 20 → adjacent tiles share 20% of
 * their extent). The single-tile FOV comes from `fovDeg(preset)`.
 */

import type { DSO } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** One tile of a mosaic: its sky centre, its framing PA, and its grid cell. */
export interface MosaicTile {
  ra: number;
  dec: number;
  paDeg: number;
  /** Grid row index (0 = top). */
  row: number;
  /** Grid column index (0 = left). */
  col: number;
}

export interface GridDims {
  cols: number;
  rows: number;
}

/** A region of sky to cover: angular extent + orientation. */
export interface MosaicRegion {
  wDeg: number;
  hDeg: number;
  paDeg: number;
}

/** Clamp an overlap percentage to a sane [0, 90] range and return a fraction. */
function overlapFraction(overlapPct: number): number {
  if (!Number.isFinite(overlapPct)) return 0;
  return Math.min(90, Math.max(0, overlapPct)) / 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Number of tiles needed to cover `regionDeg` with tiles of size `tileDeg` at
 * the given overlap. With n tiles the covered span is (n−1)·step + tile where
 * step = tile·(1−overlap); solving span ≥ region gives this count (min 1).
 */
function tilesAlong(tileDeg: number, regionDeg: number, overlap: number): number {
  const step = tileDeg * (1 - overlap);
  if (step <= 0 || !Number.isFinite(step)) return 1;
  return Math.max(1, Math.ceil(1 + (regionDeg - tileDeg) / step));
}

/**
 * Inverse gnomonic projection: a tangent-plane offset (east, north in degrees)
 * about (ra0, dec0) → sky coordinates. The standard-coordinate inverse, with the
 * ρ→0 limit handled so a zero offset returns the centre exactly.
 */
function offsetSky(ra0Deg: number, dec0Deg: number, eastDeg: number, northDeg: number): { ra: number; dec: number } {
  const xi = eastDeg * DEG2RAD;
  const eta = northDeg * DEG2RAD;
  const rho = Math.hypot(xi, eta);
  if (rho < 1e-12) return { ra: norm360(ra0Deg), dec: dec0Deg };
  const dec0 = dec0Deg * DEG2RAD;
  const ra0 = ra0Deg * DEG2RAD;
  const c = Math.atan(rho);
  const sinc = Math.sin(c);
  const cosc = Math.cos(c);
  const dec = Math.asin(clamp(cosc * Math.sin(dec0) + (eta * sinc * Math.cos(dec0)) / rho, -1, 1));
  const ra = ra0 + Math.atan2(xi * sinc, rho * Math.cos(dec0) * cosc - eta * Math.sin(dec0) * sinc);
  return { ra: norm360(ra * RAD2DEG), dec: dec * RAD2DEG };
}

/**
 * A frame-local offset (gx along the frame's right, gy along its up, in degrees)
 * about `center` at position angle `paDeg` → sky coordinates. This is the exact
 * placement math {@link tileCenters} uses, exposed so the mosaic outline can be
 * sampled to follow the same tangent-plane geometry as its tiles.
 */
export function framePointToSky(center: { ra: number; dec: number }, paDeg: number, gxDeg: number, gyDeg: number): { ra: number; dec: number } {
  const paRad = paDeg * DEG2RAD;
  const east = gxDeg * Math.cos(paRad) + gyDeg * Math.sin(paRad);
  const north = -gxDeg * Math.sin(paRad) + gyDeg * Math.cos(paRad);
  return offsetSky(center.ra, center.dec, east, north);
}

/**
 * Inverse of {@link framePointToSky}: a sky position → its frame-local offset
 * (gx right, gy up, in degrees) about `center` at position angle `paDeg`. Used to
 * recover a tile's place in the mosaic frame so a move/rotate can be applied
 * while preserving the (possibly non-rectangular) tile set.
 */
export function skyToFrameOffset(center: { ra: number; dec: number }, paDeg: number, ra: number, dec: number): { gx: number; gy: number } {
  // Forward gnomonic: (ra, dec) → standard coordinates (east, north) about centre.
  const ra0 = center.ra * DEG2RAD, dec0 = center.dec * DEG2RAD;
  const raR = ra * DEG2RAD, decR = dec * DEG2RAD;
  const dRa = raR - ra0;
  const cosc = Math.sin(dec0) * Math.sin(decR) + Math.cos(dec0) * Math.cos(decR) * Math.cos(dRa);
  const east = (Math.cos(decR) * Math.sin(dRa) / cosc) * RAD2DEG;
  const north = ((Math.cos(dec0) * Math.sin(decR) - Math.sin(dec0) * Math.cos(decR) * Math.cos(dRa)) / cosc) * RAD2DEG;
  // Un-rotate by PA (inverse of the rotation in framePointToSky).
  const paRad = paDeg * DEG2RAD;
  return {
    gx: east * Math.cos(paRad) - north * Math.sin(paRad),
    gy: east * Math.sin(paRad) + north * Math.cos(paRad),
  };
}

/**
 * Candidate positions to add a tile: the empty 4-neighbour cells around the
 * current tiles (one tile-step out, on the tiles' lattice). De-duplicated. These
 * are the "+" spots shown around a selected mosaic.
 */
export function addCandidateOffsets(offsets: Array<{ gx: number; gy: number }>, stepW: number, stepH: number): Array<{ gx: number; gy: number }> {
  if (offsets.length === 0 || stepW <= 0 || stepH <= 0) return [];
  const ref = offsets[0];
  // Cell key relative to a present tile, so half-step lattices (even grids) key cleanly.
  const key = (gx: number, gy: number) => `${Math.round((gx - ref.gx) / stepW)}:${Math.round((gy - ref.gy) / stepH)}`;
  const present = new Set(offsets.map(o => key(o.gx, o.gy)));
  const out = new Map<string, { gx: number; gy: number }>();
  for (const o of offsets) {
    for (const [dx, dy] of [[stepW, 0], [-stepW, 0], [0, stepH], [0, -stepH]]) {
      const gx = o.gx + dx, gy = o.gy + dy;
      const k = key(gx, gy);
      if (!present.has(k) && !out.has(k)) out.set(k, { gx, gy });
    }
  }
  return [...out.values()];
}

/**
 * Shape of a mosaic from its tiles' frame-local offsets: the bounding-box centre
 * (`centerGx`/`centerGy` — the offset the mosaic centre must move to so the
 * outline stays aligned with the tiles after trimming) and the bounding grid
 * dimensions (cols × rows in tile-step units, for the displayed scale).
 */
export function mosaicShapeFromOffsets(offsets: Array<{ gx: number; gy: number }>, stepW: number, stepH: number): { centerGx: number; centerGy: number; cols: number; rows: number } {
  if (offsets.length === 0) return { centerGx: 0, centerGy: 0, cols: 0, rows: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const o of offsets) {
    minX = Math.min(minX, o.gx); maxX = Math.max(maxX, o.gx);
    minY = Math.min(minY, o.gy); maxY = Math.max(maxY, o.gy);
  }
  const cols = stepW > 0 ? Math.round((maxX - minX) / stepW) + 1 : 1;
  const rows = stepH > 0 ? Math.round((maxY - minY) / stepH) + 1 : 1;
  return {
    centerGx: (minX + maxX) / 2,
    centerGy: (minY + maxY) / 2,
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
  };
}

/**
 * Grid dimensions (cols × rows) that cover a `regionWDeg × regionHDeg` region
 * with the given single-tile FOV and overlap percentage. Width maps to columns,
 * height to rows. A region smaller than one tile yields a 1×1 grid.
 */
export function planGrid(
  tileWDeg: number,
  tileHDeg: number,
  regionWDeg: number,
  regionHDeg: number,
  overlapPct: number,
): GridDims {
  const overlap = overlapFraction(overlapPct);
  return {
    cols: tilesAlong(tileWDeg, regionWDeg, overlap),
    rows: tilesAlong(tileHDeg, regionHDeg, overlap),
  };
}

/**
 * Sky centres for every tile of a `cols × rows` grid centred on `center`,
 * oriented at `paDeg`. Tiles are stepped by tile·(1−overlap) along the frame's
 * local right (width) and up (height) axes, which are rotated into sky
 * east/north by the PA. Each tile inherits the mosaic PA. Row 0 is the topmost
 * (largest "up" offset), column 0 the leftmost.
 */
export function tileCenters(
  center: { ra: number; dec: number },
  paDeg: number,
  cols: number,
  rows: number,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
): MosaicTile[] {
  const overlap = overlapFraction(overlapPct);
  const stepW = tileWDeg * (1 - overlap);
  const stepH = tileHDeg * (1 - overlap);
  const paRad = paDeg * DEG2RAD;
  const cosPa = Math.cos(paRad);
  const sinPa = Math.sin(paRad);
  const tiles: MosaicTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Frame-local offsets: +gx to the right, +gy up. The PA-rotated frame "up"
      // points at (sin PA, cos PA) in (east, north), "right" at (cos PA, −sin PA).
      const gx = (col - (cols - 1) / 2) * stepW;
      const gy = ((rows - 1) / 2 - row) * stepH;
      const east = gx * cosPa + gy * sinPa;
      const north = -gx * sinPa + gy * cosPa;
      const { ra, dec } = offsetSky(center.ra, center.dec, east, north);
      tiles.push({ ra, dec, paDeg, row, col });
    }
  }
  return tiles;
}

/**
 * Approximate rectangular extent (wDeg × hDeg) of a set of tiles, from the span
 * of their grid cells plus one tile of margin on each axis. Works for
 * non-rectangular unions too (uses the bounding rows/cols) — the plan shows this
 * as the mosaic's "approx scale".
 */
export function mosaicBounds(
  tiles: Array<Pick<MosaicTile, 'row' | 'col'>>,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
): { wDeg: number; hDeg: number } {
  if (tiles.length === 0) return { wDeg: 0, hDeg: 0 };
  const overlap = overlapFraction(overlapPct);
  const cols = tiles.map(t => t.col);
  const rows = tiles.map(t => t.row);
  const colSpan = Math.max(...cols) - Math.min(...cols);
  const rowSpan = Math.max(...rows) - Math.min(...rows);
  return {
    wDeg: colSpan * tileWDeg * (1 - overlap) + tileWDeg,
    hDeg: rowSpan * tileHDeg * (1 - overlap) + tileHDeg,
  };
}

/**
 * Region to cover for an "auto" mosaic of a DSO: the catalogued major/minor axes
 * (arcmin → deg) padded by `marginPct`, oriented so the frame's up axis runs
 * along the object's major axis (PA = the object's PA). Objects with no
 * catalogued size return a zero region, which `planGrid` resolves to a 1×1 grid.
 */
export function autoRegionForDso(
  dso: Pick<DSO, 'majAxis' | 'minAxis' | 'pa'>,
  marginPct = 20,
): MosaicRegion {
  const margin = Math.max(0, marginPct) / 100;
  const paDeg = Number.isFinite(dso.pa) ? dso.pa : 0;
  if (dso.majAxis == null) return { wDeg: 0, hDeg: 0, paDeg };
  const majDeg = dso.majAxis / 60;
  const minDeg = (dso.minAxis ?? dso.majAxis) / 60;
  // Major axis runs vertically (height/up); PA already aligns up with it.
  return { wDeg: minDeg * (1 + margin), hDeg: majDeg * (1 + margin), paDeg };
}

// ─── Smart-telescope (single-frame) mosaics ──────────────────────────────────
//
// Smart scopes (Seestar, Vespera, DWARF…) stitch their own mosaic internally:
// the user only picks the size of the *single* resulting frame, between its
// native FOV and a per-scope maximum. There is no tiling. Two cap styles:
//   - per-axis uniform enlargement (`scale`): Seestar/DWARF;
//   - area-coupled (`max_long_edge_deg` + `max_area_deg2`): Vaonis/CovalENS,
//     where a square (e.g. 3.25°×3.25°) and a rectangle (4.33°×2.43°) cover the
//     same area, the rectangle's long edge exceeding the square's side.

/** A telescope's raw mosaic capability, as stored in the catalog. */
export interface SmartMosaicCapability {
  scale?: number;
  max_long_edge_deg?: number;
  max_area_deg2?: number;
}

/** Resolved absolute size envelope for a smart-scope frame at a given native FOV. */
export interface SmartMosaicEnvelope {
  maxWDeg: number;
  maxHDeg: number;
  /** When set, w·h may not exceed this — couples the two axes (Vaonis). */
  maxAreaDeg2?: number;
}

/**
 * Build the absolute size envelope from a telescope's mosaic capability and its
 * computed native FOV. Returns null when the scope has no usable mosaic mode (so
 * the frame must not be resizable).
 */
export function smartMosaicEnvelope(
  cap: SmartMosaicCapability | undefined | null,
  nativeWDeg: number,
  nativeHDeg: number,
): SmartMosaicEnvelope | null {
  if (!cap) return null;
  if (Number.isFinite(cap.scale) && (cap.scale as number) > 1) {
    return { maxWDeg: nativeWDeg * (cap.scale as number), maxHDeg: nativeHDeg * (cap.scale as number) };
  }
  if (Number.isFinite(cap.max_long_edge_deg) && (cap.max_long_edge_deg as number) > 0) {
    const longEdge = cap.max_long_edge_deg as number;
    const env: SmartMosaicEnvelope = { maxWDeg: longEdge, maxHDeg: longEdge };
    if (Number.isFinite(cap.max_area_deg2) && (cap.max_area_deg2 as number) > 0) {
      env.maxAreaDeg2 = cap.max_area_deg2 as number;
    }
    return env;
  }
  return null;
}

/**
 * Clamp a requested frame size to a smart-scope envelope:
 *   1. floor each axis at its native FOV, cap each at the per-axis maximum;
 *   2. if an area cap binds (w·h > maxArea), keep the axis dragged larger and
 *      shrink the perpendicular axis to hold the area (then re-floor/cap it).
 */
export function clampSmartMosaicSize(
  reqWDeg: number,
  reqHDeg: number,
  nativeWDeg: number,
  nativeHDeg: number,
  env: SmartMosaicEnvelope,
): { wDeg: number; hDeg: number } {
  let w = clamp(reqWDeg, nativeWDeg, env.maxWDeg);
  let h = clamp(reqHDeg, nativeHDeg, env.maxHDeg);
  if (env.maxAreaDeg2 != null && w * h > env.maxAreaDeg2) {
    if (w >= h) {
      h = clamp(env.maxAreaDeg2 / w, nativeHDeg, env.maxHDeg);
    } else {
      w = clamp(env.maxAreaDeg2 / h, nativeWDeg, env.maxWDeg);
    }
  }
  return { wDeg: w, hDeg: h };
}

/**
 * Outer rectangular outline (wDeg × hDeg) of a `cols × rows` tile grid at the
 * given single-tile FOV and overlap — the inverse of {@link planGrid}. With n
 * tiles the covered span is (n−1)·step + tile where step = tile·(1−overlap).
 */
export function outlineFromGrid(
  cols: number,
  rows: number,
  tileWDeg: number,
  tileHDeg: number,
  overlapPct: number,
): { wDeg: number; hDeg: number } {
  const f = 1 - overlapFraction(overlapPct);
  return {
    wDeg: (Math.max(1, cols) - 1) * tileWDeg * f + tileWDeg,
    hDeg: (Math.max(1, rows) - 1) * tileHDeg * f + tileHDeg,
  };
}

/** The new setup a mosaic is being re-fitted onto: its native single-frame FOV,
 * its smart-scope enlargement envelope (null ⇒ classical or non-mosaic smart),
 * and whether it can tile (classical scope) — a smart scope cannot. */
export interface TargetFov {
  wDeg: number;
  hDeg: number;
  envelope: SmartMosaicEnvelope | null;
  tileable: boolean;
}

/** How a source mosaic best maps onto a new setup: a re-gridded tile mosaic, or
 * a single (possibly enlarged) frame. `wDeg`/`hDeg` are the resulting outline. */
export type MosaicTransform =
  | { kind: 'grid'; cols: number; rows: number; wDeg: number; hDeg: number }
  | { kind: 'single'; wDeg: number; hDeg: number };

/**
 * Best transformation of a source mosaic's outer outline onto a new setup,
 * preserving as much of the framed area as the target allows:
 *  - target is a smart scope with an enlargement envelope → clamp the outline
 *    into the envelope (keeps most area, floors at native) → a single frame;
 *  - target is a classical scope → re-grid the outline + overlap to the new tile
 *    FOV; a grid that collapses to one tile becomes a single native frame;
 *  - target is a smart scope with no mosaic mode → a single native frame.
 */
export function transformMosaicToSetup(
  outlineWDeg: number,
  outlineHDeg: number,
  overlapPct: number,
  target: TargetFov,
): MosaicTransform {
  if (target.envelope) {
    const { wDeg, hDeg } = clampSmartMosaicSize(outlineWDeg, outlineHDeg, target.wDeg, target.hDeg, target.envelope);
    return { kind: 'single', wDeg, hDeg };
  }
  if (target.tileable) {
    const { cols, rows } = planGrid(target.wDeg, target.hDeg, outlineWDeg, outlineHDeg, overlapPct);
    if (cols * rows <= 1) return { kind: 'single', wDeg: target.wDeg, hDeg: target.hDeg };
    const { wDeg, hDeg } = outlineFromGrid(cols, rows, target.wDeg, target.hDeg, overlapPct);
    return { kind: 'grid', cols, rows, wDeg, hDeg };
  }
  return { kind: 'single', wDeg: target.wDeg, hDeg: target.hDeg };
}

/**
 * Centre + region for an "auto" mosaic covering one *or several* DSOs.
 *
 * - One DSO reduces exactly to {@link autoRegionForDso} centred on the object
 *   (keeps its PA-aligned framing, so the mosaic stays anchored to it).
 * - Several DSOs are projected to a common tangent plane (about the first as
 *   reference), each padded by its angular radius (majAxis/2); the covering
 *   bounding box gives a north-up (PA 0) region and its midpoint the centre —
 *   the mosaic sits between the targets and isn't anchored to any one of them.
 */
export function autoRegionForDsos(
  dsos: Array<Pick<DSO, 'ra' | 'dec' | 'majAxis' | 'minAxis' | 'pa'>>,
  marginPct = 20,
): { center: { ra: number; dec: number }; region: MosaicRegion } {
  if (dsos.length === 0) return { center: { ra: 0, dec: 0 }, region: { wDeg: 0, hDeg: 0, paDeg: 0 } };
  if (dsos.length === 1) {
    const d = dsos[0];
    return { center: { ra: d.ra, dec: d.dec }, region: autoRegionForDso(d, marginPct) };
  }
  const margin = Math.max(0, marginPct) / 100;
  const ref = { ra: dsos[0].ra, dec: dsos[0].dec };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const d of dsos) {
    const { gx, gy } = skyToFrameOffset(ref, 0, d.ra, d.dec); // east, north (deg) at PA 0
    const r = d.majAxis != null ? d.majAxis / 60 / 2 : 0;
    minX = Math.min(minX, gx - r); maxX = Math.max(maxX, gx + r);
    minY = Math.min(minY, gy - r); maxY = Math.max(maxY, gy + r);
  }
  const center = framePointToSky(ref, 0, (minX + maxX) / 2, (minY + maxY) / 2);
  return {
    center,
    region: { wDeg: (maxX - minX) * (1 + margin), hDeg: (maxY - minY) * (1 + margin), paDeg: 0 },
  };
}
