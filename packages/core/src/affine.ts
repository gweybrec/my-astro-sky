import type { AffineMatrix, Point } from './types';
import { t } from './i18n/index';

/**
 * Check if three points are collinear (or nearly collinear).
 * Uses a relative singularity threshold based on input coordinate scale.
 */
function isCollinear(det: number, p0: Point, p1: Point, p2: Point): boolean {
  const scale = Math.max(
    Math.abs(p0.x),
    Math.abs(p0.y),
    Math.abs(p1.x),
    Math.abs(p1.y),
    Math.abs(p2.x),
    Math.abs(p2.y),
    1,
  );

  return Math.abs(det) < 1e-10 * scale * scale;
}

/**
 * Compute affine transform from 3 point correspondences.
 * Maps photo pixel coords → canvas pixel coords.
 *
 * CSS matrix(a, b, c, d, e, f):
 *   newX = a·x + c·y + e
 *   newY = b·x + d·y + f
 */
export function computeAffineTransform(
  photoPoints: [Point, Point, Point],
  canvasPoints: [Point, Point, Point],
): AffineMatrix {
  const [p0, p1, p2] = photoPoints;
  const [c0, c1, c2] = canvasPoints;

  // Matrix A = [[px0, py0, 1], [px1, py1, 1], [px2, py2, 1]]
  const det = p0.x * (p1.y - p2.y) - p0.y * (p1.x - p2.x) + (p1.x * p2.y - p2.x * p1.y);

  if (isCollinear(det, p0, p1, p2)) {
    throw new Error(t('errors.collinearPoints'));
  }

  const invDet = 1 / det;

  // Inverse of A (adjugate / det)
  const inv = [
    [(p1.y - p2.y) * invDet, (p2.y - p0.y) * invDet, (p0.y - p1.y) * invDet],
    [(p2.x - p1.x) * invDet, (p0.x - p2.x) * invDet, (p1.x - p0.x) * invDet],
    [
      (p1.x * p2.y - p2.x * p1.y) * invDet,
      (p2.x * p0.y - p0.x * p2.y) * invDet,
      (p0.x * p1.y - p1.x * p0.y) * invDet,
    ],
  ];

  // Solve for CSS matrix columns
  // [a, c, e] = inv · [c0.x, c1.x, c2.x]
  const a = inv[0][0] * c0.x + inv[0][1] * c1.x + inv[0][2] * c2.x;
  const c = inv[1][0] * c0.x + inv[1][1] * c1.x + inv[1][2] * c2.x;
  const e = inv[2][0] * c0.x + inv[2][1] * c1.x + inv[2][2] * c2.x;

  // [b, d, f] = inv · [c0.y, c1.y, c2.y]
  const b = inv[0][0] * c0.y + inv[0][1] * c1.y + inv[0][2] * c2.y;
  const d = inv[1][0] * c0.y + inv[1][1] * c1.y + inv[1][2] * c2.y;
  const f = inv[2][0] * c0.y + inv[2][1] * c1.y + inv[2][2] * c2.y;

  if (
    !isFinite(a) ||
    !isFinite(b) ||
    !isFinite(c) ||
    !isFinite(d) ||
    !isFinite(e) ||
    !isFinite(f)
  ) {
    throw new Error(t('errors.invalidAffine'));
  }

  return { a, b, c, d, e, f };
}

/**
 * Compute similarity transform from 2 point correspondences.
 * A similarity transform has 4 DOF: uniform scale, rotation, and translation.
 * CSS matrix(a, b, -b, a, e, f).
 */
export function computeSimilarityTransform(
  photoPoints: [Point, Point],
  canvasPoints: [Point, Point],
): AffineMatrix {
  const [p0, p1] = photoPoints;
  const [c0, c1] = canvasPoints;

  const dpx = p1.x - p0.x;
  const dpy = p1.y - p0.y;
  const dcx = c1.x - c0.x;
  const dcy = c1.y - c0.y;

  const denom = dpx * dpx + dpy * dpy;
  if (denom < 1e-10) {
    throw new Error(t('errors.collinearPoints'));
  }

  // Solve for similarity: a = (dcx·dpx + dcy·dpy) / denom, b = (dcy·dpx - dcx·dpy) / denom
  const a = (dcx * dpx + dcy * dpy) / denom;
  const b = (dcy * dpx - dcx * dpy) / denom;

  // c = -b, d = a for similarity (no mirror)
  const c = -b;
  const d = a;

  // Translation: c0 = a·p0.x + c·p0.y + e  →  e = c0.x - a·p0.x - c·p0.y
  const e = c0.x - a * p0.x - c * p0.y;
  const f = c0.y - b * p0.x - d * p0.y;

  if (!isFinite(a) || !isFinite(b) || !isFinite(e) || !isFinite(f)) {
    throw new Error(t('errors.invalidAffine'));
  }

  return { a, b, c, d, e, f };
}

export function affineToCSS(m: AffineMatrix): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
}

/** Apply an affine matrix to a point: `(a·x + c·y + e, b·x + d·y + f)`. */
export function applyAffine(m: AffineMatrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Invert an affine matrix, or null when it is singular (zero determinant). */
export function invertAffine(m: AffineMatrix): AffineMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-30) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/**
 * How spread out `points` are, from 0 (all in a line, or fewer than 2 distinct points) to 1/4
 * (spread evenly in every direction): about (spread across their line / spread along it)². It
 * does not depend on where the points are or on their scale.
 */
export function pointSpread(points: readonly Point[]): number {
  const n = points.length;
  if (n === 0) return 0;
  let mx = 0,
    my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let s_xx = 0,
    s_xy = 0,
    s_yy = 0;
  for (const p of points) {
    s_xx += (p.x - mx) ** 2;
    s_xy += (p.x - mx) * (p.y - my);
    s_yy += (p.y - my) ** 2;
  }
  const trace = s_xx + s_yy;
  return trace > 0 ? (s_xx * s_yy - s_xy * s_xy) / (trace * trace) : 0;
}

/** Below this {@link pointSpread}, points are taken to be in a line: an affine fit on them is underdetermined. */
export const IN_A_LINE_SPREAD = 1e-6;

/**
 * Least-squares affine fit for N ≥ 3 point pairs.
 * Falls back to the exact 3-point solver when N === 3.
 * Minimises sum of squared residuals over all N pairs.
 */
export function computeAffineLSQ(photoPoints: Point[], canvasPoints: Point[]): AffineMatrix {
  const n = photoPoints.length;
  if (n < 2) throw new Error(t('errors.minPoints'));
  if (n === 2) {
    return computeSimilarityTransform(
      photoPoints as [Point, Point],
      canvasPoints as [Point, Point],
    );
  }
  if (n === 3) {
    return computeAffineTransform(
      photoPoints as [Point, Point, Point],
      canvasPoints as [Point, Point, Point],
    );
  }

  // Least squares on coordinates relative to the points' mean: newX = a·dx + c·dy + mX,
  // newY = b·dx + d·dy + mY. Centring keeps the fit well conditioned whatever the
  // photo's size, and lets the "points in a line" test below be scale-free.
  let mx = 0,
    my = 0,
    mX = 0,
    mY = 0;
  for (let i = 0; i < n; i++) {
    mx += photoPoints[i].x;
    my += photoPoints[i].y;
    mX += canvasPoints[i].x;
    mY += canvasPoints[i].y;
  }
  mx /= n;
  my /= n;
  mX /= n;
  mY /= n;

  let s_xx = 0,
    s_xy = 0,
    s_yy = 0,
    s_xX = 0,
    s_yX = 0,
    s_xY = 0,
    s_yY = 0;
  for (let i = 0; i < n; i++) {
    const x = photoPoints[i].x - mx,
      y = photoPoints[i].y - my;
    const X = canvasPoints[i].x - mX,
      Y = canvasPoints[i].y - mY;
    s_xx += x * x;
    s_xy += x * y;
    s_yy += y * y;
    s_xX += x * X;
    s_yX += y * X;
    s_xY += x * Y;
    s_yY += y * Y;
  }

  // det / trace² is pointSpread(photoPoints). A test on the raw (uncentred) normal
  // matrix flagged a well-spread triangle of stars as "in a line" once their pixel
  // coordinates were in the thousands, and the similarity fallback below cannot mirror.
  const det = s_xx * s_yy - s_xy * s_xy;
  const trace = s_xx + s_yy;
  if (!(det > IN_A_LINE_SPREAD * trace * trace)) {
    // The photo points are in a line (or nearly so): an affine (6-DOF) fit is
    // underdetermined. Rather than failing outright, fall back to a similarity
    // transform (scale+rotation+translation) computed from the most separated pair
    // of points — this is sufficient to place the image.
    let bestI = 0,
      bestJ = 1;
    let maxDist2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = photoPoints[i].x - photoPoints[j].x;
        const dy = photoPoints[i].y - photoPoints[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist2) {
          maxDist2 = d2;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // If all points are coincident (or numerically too close), we cannot
    // compute a transform.
    if (maxDist2 < 1e-10) {
      throw new Error(t('errors.collinearLSQ'));
    }

    return computeSimilarityTransform(
      [photoPoints[bestI], photoPoints[bestJ]] as [Point, Point],
      [canvasPoints[bestI], canvasPoints[bestJ]] as [Point, Point],
    );
  }

  const a = (s_yy * s_xX - s_xy * s_yX) / det;
  const c = (s_xx * s_yX - s_xy * s_xX) / det;
  const b = (s_yy * s_xY - s_xy * s_yY) / det;
  const d = (s_xx * s_yY - s_xy * s_xY) / det;
  const e = mX - a * mx - c * my;
  const f = mY - b * mx - d * my;

  if (
    !isFinite(a) ||
    !isFinite(b) ||
    !isFinite(c) ||
    !isFinite(d) ||
    !isFinite(e) ||
    !isFinite(f)
  ) {
    throw new Error(t('errors.invalidAffine'));
  }

  return { a, b, c, d, e, f };
}
