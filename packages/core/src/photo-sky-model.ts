/**
 * Where each pixel of a photo is on the sky: the one placement every part of the app uses (the sky map's drawing,
 * its outline and culling, the objects drawn on the photo, the identification of asteroids, comets and supernovae).
 *
 * A photo of the sky is a gnomonic (TAN) projection of it, so the model goes through the tangent plane at the photo's
 * centre: photo pixels → standard coordinates (ξ, η) by a fit on the photo's reference points → RA/Dec by the inverse
 * gnomonic projection. Exact for a plate solution without distortion; its 3 × 3 grid of reference points (see
 * `wcsToCorrespondences`) also gives the quadratic part of a SIP distortion. Independent of how the sky map projects
 * the sky, which only enters when the map draws the photo.
 */
import type { AffineMatrix, Point } from './types';
import { computeAffineLSQ } from './affine';
import { t } from './i18n/index';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface RaDec {
  ra: number;
  dec: number;
}

/** A photo's placement on the sky: its pixels (origin top left, y down) to RA/Dec (degrees) and back. */
export interface PhotoSkyModel {
  readonly width: number;
  readonly height: number;
  /** The sky position of the photo pixel (x, y); RA in [0, 360). */
  toSky(x: number, y: number): RaDec;
  /** The photo pixel at a sky position (possibly outside the photo); null for one 90° or more from its centre. */
  toPixel(ra: number, dec: number): Point | null;
}

/** Standard coordinates (radians) of a sky position on the plane tangent at (ra0, dec0); null on the far side. */
export function skyToTangent(ra: number, dec: number, ra0: number, dec0: number): Point | null {
  const da = (ra - ra0) * D2R;
  const d = dec * D2R;
  const d0 = dec0 * D2R;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  if (!(cosC > 1e-9)) return null;
  return {
    x: (Math.cos(d) * Math.sin(da)) / cosC,
    y: (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosC,
  };
}

/** The sky position of standard coordinates (radians) on the plane tangent at (ra0, dec0). */
export function tangentToSky(xi: number, eta: number, ra0: number, dec0: number): RaDec {
  const s0 = Math.sin(dec0 * D2R);
  const c0 = Math.cos(dec0 * D2R);
  const den = c0 - eta * s0;
  const ra = ra0 + Math.atan2(xi, den) * R2D;
  const dec = Math.atan2(s0 + eta * c0, Math.hypot(xi, den)) * R2D;
  return { ra: ((ra % 360) + 360) % 360, dec };
}

/** The monomials u^i·v^j of a fit, on pixel offsets from the photo's centre scaled to about ±1. */
type Terms = ReadonlyArray<readonly [number, number]>;
const AFFINE_TERMS: Terms = [
  [0, 0],
  [1, 0],
  [0, 1],
];
/** Exactly determined by a 3 × 3 grid of points. */
const BIQUADRATIC_TERMS: Terms = [
  [0, 0],
  [1, 0],
  [0, 1],
  [2, 0],
  [1, 1],
  [0, 2],
  [2, 1],
  [1, 2],
  [2, 2],
];

class TangentPlaneModel implements PhotoSkyModel {
  private readonly cx: number;
  private readonly cy: number;
  private readonly s: number;
  /** Inverse of the linear part, the start of {@link toPixel}'s iteration. */
  private readonly inv: [number, number, number, number];
  private readonly linear: boolean;
  readonly width: number;
  readonly height: number;
  private readonly ra0: number;
  private readonly dec0: number;
  private readonly terms: Terms;
  private readonly xi: number[];
  private readonly eta: number[];

  constructor(
    width: number,
    height: number,
    ra0: number,
    dec0: number,
    terms: Terms,
    xi: number[],
    eta: number[],
  ) {
    this.width = width;
    this.height = height;
    this.ra0 = ra0;
    this.dec0 = dec0;
    this.terms = terms;
    this.xi = xi;
    this.eta = eta;
    this.cx = width / 2;
    this.cy = height / 2;
    this.s = Math.max(width, height) / 2 || 1;
    const [a, c] = [xi[1], xi[2]];
    const [b, d] = [eta[1], eta[2]];
    const det = a * d - b * c;
    this.inv = [d / det, -c / det, -b / det, a / det];
    this.linear = terms.length === 3;
  }

  /** Standard coordinates of the scaled pixel offset (u, v). */
  private plane(u: number, v: number): Point {
    let x = 0;
    let y = 0;
    for (let k = 0; k < this.terms.length; k++) {
      const [i, j] = this.terms[k];
      const m = (i === 0 ? 1 : i === 1 ? u : u * u) * (j === 0 ? 1 : j === 1 ? v : v * v);
      x += this.xi[k] * m;
      y += this.eta[k] * m;
    }
    return { x, y };
  }

  toSky(x: number, y: number): RaDec {
    const p = this.plane((x - this.cx) / this.s, (y - this.cy) / this.s);
    return tangentToSky(p.x, p.y, this.ra0, this.dec0);
  }

  toPixel(ra: number, dec: number): Point | null {
    const target = skyToTangent(ra, dec, this.ra0, this.dec0);
    if (!target) return null;
    const [i00, i01, i10, i11] = this.inv;
    const lin = (dx: number, dy: number) => ({ u: i00 * dx + i01 * dy, v: i10 * dx + i11 * dy });
    let { u, v } = lin(target.x - this.xi[0], target.y - this.eta[0]);
    if (!this.linear) {
      // Newton on the polynomial, from the linear part's answer: its quadratic terms are small corrections.
      for (let it = 0; it < 8; it++) {
        const p = this.plane(u, v);
        const ex = target.x - p.x;
        const ey = target.y - p.y;
        const h = 1e-6;
        const pu = this.plane(u + h, v);
        const pv = this.plane(u, v + h);
        const a = (pu.x - p.x) / h;
        const c = (pv.x - p.x) / h;
        const b = (pu.y - p.y) / h;
        const d = (pv.y - p.y) / h;
        const det = a * d - b * c;
        if (!(Math.abs(det) > 0)) break;
        const du = (d * ex - c * ey) / det;
        const dv = (a * ey - b * ex) / det;
        u += du;
        v += dv;
        if (Math.abs(du) + Math.abs(dv) < 1e-12) break;
      }
    }
    return { x: this.cx + u * this.s, y: this.cy + v * this.s };
  }
}

/** Mean direction of sky positions, as RA/Dec. */
function meanDirection(sky: readonly RaDec[]): RaDec {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of sky) {
    const c = Math.cos(s.dec * D2R);
    x += c * Math.cos(s.ra * D2R);
    y += c * Math.sin(s.ra * D2R);
    z += Math.sin(s.dec * D2R);
  }
  const ra = Math.atan2(y, x) * R2D;
  return { ra: (ra + 360) % 360, dec: Math.atan2(z, Math.hypot(x, y)) * R2D };
}

/** Least squares of `rows · c = rhs` by its normal equations; throws when they are singular. */
function leastSquares(rows: number[][], rhs: number[]): number[] {
  const n = rows[0].length;
  const m = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  rows.forEach((r, k) => {
    for (let i = 0; i < n; i++) {
      m[i][n] += r[i] * rhs[k];
      for (let j = 0; j < n; j++) m[i][j] += r[i] * r[j];
    }
  });
  const scale = Math.max(...m.map((r, i) => Math.abs(r[i])));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (!(Math.abs(m[p][c]) > 1e-12 * scale)) throw new Error(t('errors.collinearPoints'));
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

/**
 * Where a plate solution's reference points are taken, as fractions of the photo's width and height: the corners,
 * the middles of the edges and the centre, 5 % inside the edges (see `wcsToCorrespondences`).
 */
export const REFERENCE_FRACTIONS = [0.05, 0.5, 0.95] as const;

/** True when the points are the 3 × 3 grid of a plate solution's reference points. */
function isReferenceGrid(points: readonly Point[], width: number, height: number): boolean {
  if (points.length !== 9) return false;
  const seen = new Set<string>();
  for (const p of points) {
    const i = REFERENCE_FRACTIONS.findIndex((f) => Math.abs(p.x / width - f) < 1e-3);
    const j = REFERENCE_FRACTIONS.findIndex((f) => Math.abs(p.y / height - f) < 1e-3);
    if (i < 0 || j < 0) return false;
    seen.add(`${i},${j}`);
  }
  return seen.size === 9;
}

/** The fit of `photoPoints` → standard coordinates about (ra0, dec0) with the given terms. */
function fitPlane(
  photoPoints: readonly Point[],
  sky: readonly RaDec[],
  width: number,
  height: number,
  center: RaDec,
  quadratic: boolean,
): TangentPlaneModel {
  const s = Math.max(width, height) / 2 || 1;
  const uv = photoPoints.map((p) => ({ x: (p.x - width / 2) / s, y: (p.y - height / 2) / s }));
  const plane = sky.map((q) => skyToTangent(q.ra, q.dec, center.ra, center.dec));
  if (plane.some((q) => q === null)) throw new Error(t('errors.invalidAffine'));
  const tp = plane as Point[];
  if (quadratic) {
    const rows = uv.map((p) => BIQUADRATIC_TERMS.map(([i, j]) => p.x ** i * p.y ** j));
    const xi = leastSquares(
      rows,
      tp.map((q) => q.x),
    );
    const eta = leastSquares(
      rows,
      tp.map((q) => q.y),
    );
    return new TangentPlaneModel(width, height, center.ra, center.dec, BIQUADRATIC_TERMS, xi, eta);
  }
  // 2 points: a similarity that does not mirror (a photo of the sky seen as the sky is), 3: exact, more: least squares.
  const m = computeAffineLSQ(uv, tp);
  return new TangentPlaneModel(
    width,
    height,
    center.ra,
    center.dec,
    AFFINE_TERMS,
    [m.e, m.a, m.c],
    [m.f, m.b, m.d],
  );
}

/**
 * The model of a `width` × `height` photo whose pixels `photoPoints` are at the sky positions `sky` (degrees): a
 * similarity from 2 points, an affine fit from 3 or more, and a quadratic one from a plate solution's 3 × 3 grid of
 * reference points. Tangent at the photo's centre. Throws when the points cannot place the photo (in a line, or
 * fewer than 2).
 */
export function fitPhotoSkyModel(
  photoPoints: readonly Point[],
  sky: readonly RaDec[],
  width: number,
  height: number,
): PhotoSkyModel {
  if (photoPoints.length < 2 || photoPoints.length !== sky.length) {
    throw new Error(t('errors.minPoints'));
  }
  const quadratic = isReferenceGrid(photoPoints, width, height);
  // Tangent at the points' mean direction first, then at the centre of the photo that fit gives.
  const first = fitPlane(photoPoints, sky, width, height, meanDirection(sky), quadratic);
  const center = first.toSky(width / 2, height / 2);
  return fitPlane(photoPoints, sky, width, height, center, quadratic);
}

/**
 * The model of a photo placed by its linear map to standard coordinates: `linear` maps photo pixel offsets from its
 * centre to (ξ, η) in radians, about `center`. For a placement made by hand (see `photoSkyModel`).
 */
export function linearPhotoSkyModel(
  center: RaDec,
  linear: Pick<AffineMatrix, 'a' | 'b' | 'c' | 'd'>,
  width: number,
  height: number,
): PhotoSkyModel {
  const s = Math.max(width, height) / 2 || 1;
  return new TangentPlaneModel(
    width,
    height,
    center.ra,
    center.dec,
    AFFINE_TERMS,
    [0, linear.a * s, linear.c * s],
    [0, linear.b * s, linear.d * s],
  );
}

/** Angular size (degrees) of one photo pixel at its centre. */
export function pixelScaleDeg(model: PhotoSkyModel): number {
  const cx = model.width / 2;
  const cy = model.height / 2;
  const c = model.toSky(cx, cy);
  const r = model.toSky(cx + 1, cy);
  const d = model.toSky(cx, cy + 1);
  const dist = (a: RaDec, b: RaDec) =>
    Math.hypot((((a.ra - b.ra + 540) % 360) - 180) * Math.cos(a.dec * D2R), a.dec - b.dec);
  return Math.sqrt(dist(c, r) * dist(c, d));
}
