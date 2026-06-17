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
