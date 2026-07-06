/**
 * Pure placement / geometry / visibility logic for astrophotos on the sky map.
 *
 * This module holds the math that was previously embedded in `photo-overlay.ts`.
 * Nothing here touches the DOM, an `<img>`, or a modal — it takes plain data
 * (a `Photo`, a `ViewState`, filter state) and returns plain data (matrices,
 * coordinates, booleans). `PhotoOverlay` composes these functions and applies
 * the results to the DOM. Keeping the math here makes it unit-testable (see
 * `tests/unit/photo-placement.test.ts`) instead of hidden behind canvas code.
 */
import type {
  Photo,
  PhotoCorrespondence,
  Point,
  ViewState,
  ManualPlacement,
  AffineMatrix,
  PoiCategory,
} from './types';
import { project, toCanvas, fromCanvas, unproject } from './projection';
import { computeAffineTransform, computeAffineLSQ, computeSimilarityTransform } from './affine';
import { poisMatchFilter } from './poi';
import { getStarByHip } from './star-catalog';
import { reportUnknownRendererError } from './error-reporter';

/**
 * Get RA/Dec for a correspondence: use the stored starRa/starDec when present
 * (always available for plate-solved photos), else fall back to a client catalog
 * lookup by HIP number (manually picked stars).
 *
 * Match both undefined and null — the upload response serializes missing values as
 * null (server/index.ts scaledCorrespondences uses `?? null`), while the DB reload
 * path omits them. Without this, main-point correspondences (starHip>0, no RA/Dec)
 * would resolve to {ra: null, dec: null} post-upload and collapse the affine fit.
 */
export function getCorrRaDec(corr: PhotoCorrespondence): { ra: number; dec: number } | null {
  if (corr.starRa != null && corr.starDec != null) {
    return { ra: corr.starRa, dec: corr.starDec };
  }
  if (corr.starHip > 0) {
    const star = getStarByHip(corr.starHip);
    return star ? { ra: star.ra, dec: star.dec } : null;
  }
  return null;
}

/**
 * Fit a photo→target affine matrix, choosing the estimator by point count:
 * 2 points → similarity (rigid + uniform scale), 3 → exact affine, 4+ →
 * least-squares affine. `targetPoints` may be in canvas space or projection space
 * — the estimator is agnostic. Throws when the points are degenerate (colinear);
 * callers decide whether that means "skip" or "error".
 */
export function fitPhotoAffine(photoPoints: Point[], targetPoints: Point[]): AffineMatrix {
  if (photoPoints.length === 2) {
    return computeSimilarityTransform(
      photoPoints as [Point, Point],
      targetPoints as [Point, Point],
    );
  } else if (photoPoints.length === 3) {
    return computeAffineTransform(
      photoPoints as [Point, Point, Point],
      targetPoints as [Point, Point, Point],
    );
  }
  return computeAffineLSQ(photoPoints, targetPoints);
}

/**
 * Build the parallel photo-pixel / projection-space point arrays for a photo's
 * correspondences, skipping any whose star can't be resolved. Projection-space
 * points are view-independent, so this is reused by callers that need a
 * projection fit (centre/scale) and by {@link buildPhotoPoints} for canvas fits.
 */
export function buildPhotoProjPoints(photo: Photo): {
  photoPoints: Point[];
  projPoints: Point[];
} {
  const photoPoints: Point[] = [];
  const projPoints: Point[] = [];
  for (const corr of photo.correspondences) {
    const raDec = getCorrRaDec(corr);
    if (!raDec) continue;
    projPoints.push(project(raDec.ra, raDec.dec));
    photoPoints.push({ x: corr.photoX, y: corr.photoY });
  }
  return { photoPoints, projPoints };
}

/**
 * As {@link buildPhotoProjPoints} but also projects every point into canvas space
 * at the given view — for callers fitting a photo→canvas matrix.
 */
export function buildPhotoPoints(
  photo: Photo,
  view: ViewState,
): { photoPoints: Point[]; projPoints: Point[]; canvasPoints: Point[] } {
  const { photoPoints, projPoints } = buildPhotoProjPoints(photo);
  const canvasPoints = projPoints.map((p) => toCanvas(p.x, p.y, view));
  return { photoPoints, projPoints, canvasPoints };
}

/**
 * Projection-space centroid (average correspondence position) and the max distance
 * from it to any correspondence — the photo's sky footprint radius, used as the
 * viewport-cull margin. Caller must pass a non-empty array.
 */
export function projCentroidAndHalfDiag(projPoints: Point[]): {
  centroid: Point;
  halfDiag: number;
} {
  const cx = projPoints.reduce((s, p) => s + p.x, 0) / projPoints.length;
  const cy = projPoints.reduce((s, p) => s + p.y, 0) / projPoints.length;
  const halfDiag = projPoints.reduce((m, p) => Math.max(m, Math.hypot(p.x - cx, p.y - cy)), 0);
  return { centroid: { x: cx, y: cy }, halfDiag };
}

/** True when the centroid falls inside the border circle of radius `borderRadiusPU`. */
export function isCentroidInsideBorder(centroid: Point, borderRadiusPU: number): boolean {
  return Math.hypot(centroid.x, centroid.y) <= borderRadiusPU;
}

/**
 * Fast viewport cull test: is the photo's footprint entirely off-canvas at `view`?
 * Margin = 2× the sky footprint radius in canvas pixels, so a photo that extends
 * past its correspondence points is never incorrectly culled. This is the exact
 * test the sky-map pan/zoom loop runs every frame (via PhotoOverlay.updateTransforms).
 */
export function isCentroidViewportCulled(
  centroid: Point,
  halfDiag: number,
  view: ViewState,
): boolean {
  const cc = toCanvas(centroid.x, centroid.y, view);
  const margin = halfDiag * view.scale * 2;
  return (
    cc.x + margin < 0 ||
    cc.x - margin > view.width ||
    cc.y + margin < 0 ||
    cc.y - margin > view.height
  );
}

/** Map the four photo corners (0,0)-(w,h) through an affine matrix. */
export function mapPhotoCorners(matrix: AffineMatrix, w: number, h: number): Point[] {
  const photoCorners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return photoCorners.map((p) => ({
    x: matrix.a * p.x + matrix.c * p.y + matrix.e,
    y: matrix.b * p.x + matrix.d * p.y + matrix.f,
  }));
}

/**
 * Canvas-space corners of a photo's outline at `view`, or null when it can't be
 * placed (fewer than 2 resolvable correspondences, or colinear points). Border /
 * visibility filtering is the caller's job — this is pure geometry.
 */
export function computePhotoQuadCorners(photo: Photo, view: ViewState): Point[] | null {
  if (photo.correspondences.length < 2) return null;
  const { photoPoints, canvasPoints } = buildPhotoPoints(photo, view);
  if (photoPoints.length < 2) return null;
  try {
    return mapPhotoCorners(fitPhotoAffine(photoPoints, canvasPoints), photo.width, photo.height);
  } catch {
    return null; // colinear points
  }
}

/**
 * The photo→canvas affine matrix at an arbitrary view, independent of any on-screen
 * transform. Returns null when the photo can't be placed (too few correspondences)
 * or its centroid falls outside the border circle. Used by the "full sky map" export.
 */
export function computePhotoMatrixForView(
  photo: Photo,
  view: ViewState,
  borderRadiusPU: number,
): AffineMatrix | null {
  if (photo.manualPlacement) {
    const cp = project(photo.manualPlacement.centerRa, photo.manualPlacement.centerDec);
    if (!isCentroidInsideBorder(cp, borderRadiusPU)) return null;
    return computeManualMatrix(photo.manualPlacement, view, photo.width, photo.height);
  }

  if (photo.correspondences.length < 2) return null;
  const { photoPoints, projPoints, canvasPoints } = buildPhotoPoints(photo, view);
  if (photoPoints.length < 2) return null;

  const { centroid } = projCentroidAndHalfDiag(projPoints);
  if (!isCentroidInsideBorder(centroid, borderRadiusPU)) return null;

  try {
    return fitPhotoAffine(photoPoints, canvasPoints);
  } catch {
    return null;
  }
}

/**
 * The centre RA/Dec and the view scale (canvas px per projection unit) that fits a
 * photo into a viewWidth × viewHeight frame with a 20% margin. Null when the photo
 * has fewer than 2 resolvable correspondences or the fit is degenerate.
 */
export function computePhotoCenterAndScale(
  photo: Photo,
  viewWidth: number,
  viewHeight: number,
): { ra: number; dec: number; scale: number } | null {
  if (photo.correspondences.length < 2) return null;
  const { photoPoints, projPoints } = buildPhotoProjPoints(photo);
  if (photoPoints.length < 2) return null;

  try {
    const matrix = fitPhotoAffine(photoPoints, projPoints);
    const projCorners = mapPhotoCorners(matrix, photo.width, photo.height);

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of projCorners) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }

    const center = unproject((minX + maxX) / 2, (minY + maxY) / 2);
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const scale = Math.min(viewWidth / extentX, viewHeight / extentY) * 0.8;

    return { ra: center.ra, dec: center.dec, scale };
  } catch {
    return null;
  }
}

/** Average RA/Dec centre of a photo from its correspondences, or null if none resolve. */
export function computePhotoCenter(photo: Photo): { ra: number; dec: number } | null {
  if (photo.correspondences.length === 0) return null;
  const { projPoints } = buildPhotoProjPoints(photo);
  if (projPoints.length === 0) return null;
  const sumX = projPoints.reduce((s, p) => s + p.x, 0);
  const sumY = projPoints.reduce((s, p) => s + p.y, 0);
  const avg = unproject(sumX / projPoints.length, sumY / projPoints.length);
  return { ra: avg.ra, dec: avg.dec };
}

/** True when the photo passes the current label filter (no filter ⇒ allowed). */
export function isLabelAllowed(photo: Photo, visibleLabels: { [label: string]: boolean }): boolean {
  const filterKeys = Object.keys(visibleLabels || {});
  if (filterKeys.length === 0) return true;
  if (!photo.labels || photo.labels.length === 0) {
    return visibleLabels['(no label)'] !== false;
  }
  return photo.labels.some((l) => visibleLabels[l] !== false);
}

/** True when the photo passes the current POI filter (no filter ⇒ allowed). */
export function isPoiAllowed(
  photo: Photo,
  poiCategories: PoiCategory[],
  visiblePois: Map<string, Set<string>> | null,
): boolean {
  return poisMatchFilter(photo.pointsOfInterest ?? [], poiCategories, visiblePois);
}

/**
 * Projection-space centroid and footprint radius for a manually placed photo.
 * The centroid is simply the placed centre; the footprint radius is half the image
 * diagonal scaled by the placement's projection-units-per-pixel.
 */
export function manualPlacementCentroid(
  placement: ManualPlacement,
  natW: number,
  natH: number,
): { centroid: Point; halfDiag: number } {
  const centroid = project(placement.centerRa, placement.centerDec);
  const halfDiagPx = Math.hypot(natW / 2, natH / 2);
  return { centroid, halfDiag: halfDiagPx * placement.projPerPx };
}

/**
 * Build the photo→canvas affine matrix for a manual placement (centre RA/Dec,
 * rotation, projection-units-per-pixel, mirror flags) at the given view.
 */
export function computeManualMatrix(
  placement: ManualPlacement,
  view: ViewState,
  natW: number,
  natH: number,
): AffineMatrix {
  const centerProj = project(placement.centerRa, placement.centerDec);
  const centerCanvas = toCanvas(centerProj.x, centerProj.y, view);

  // projection units per pixel * view scale = canvas pixels per photo pixel
  const pxPerPx = placement.projPerPx * view.scale;
  const mx = placement.mirrorX ? -1 : 1;
  const my = placement.mirrorY ? -1 : 1;
  const rotRad = (placement.rotationDeg * Math.PI) / 180;

  // The photo pixel (cx, cy) maps to the placed centre.
  const cx = natW / 2;
  const cy = natH / 2;
  const cosR = Math.cos(rotRad) * pxPerPx;
  const sinR = Math.sin(rotRad) * pxPerPx;

  // matrix(a, b, c, d, e, f): maps (photoX, photoY) → canvas.
  // Apply mirror before rotation: mirror the photo coords, then rotate+scale.
  const a = cosR * mx;
  const b = sinR * mx;
  const c = -sinR * my;
  const d = cosR * my;
  const e = centerCanvas.x - a * cx - c * cy;
  const f = centerCanvas.y - b * cx - d * cy;

  return { a, b, c, d, e, f };
}

/**
 * Build 3 synthetic PhotoCorrespondences from a manual placement, so a manually
 * placed photo can be persisted/re-solved through the same correspondence pipeline
 * as an auto-solved one. Samples 3 well-spaced photo points, pushes them through the
 * same CSS matrix `computeManualMatrix` builds, then canvas→projection→celestial.
 */
export function buildSyntheticCorrespondences(
  placement: ManualPlacement,
  natW: number,
  natH: number,
  view: ViewState,
): PhotoCorrespondence[] {
  const photoPoints: [number, number][] = [
    [natW * 0.2, natH * 0.2],
    [natW * 0.8, natH * 0.2],
    [natW * 0.5, natH * 0.8],
  ];

  const matrix = computeManualMatrix(placement, view, natW, natH);
  const { a, b, c, d, e, f } = matrix;

  const correspondences: PhotoCorrespondence[] = [];
  for (let idx = 0; idx < photoPoints.length; idx++) {
    const [px, py] = photoPoints[idx];

    // Apply the CSS matrix to get canvas coordinates, then canvas → projection → celestial.
    const canvasX = a * px + c * py + e;
    const canvasY = b * px + d * py + f;
    const proj = fromCanvas(canvasX, canvasY, view);
    const sky = unproject(proj.x, proj.y);

    correspondences.push({
      pointIndex: idx,
      photoX: px,
      photoY: py,
      starHip: 0,
      starRa: sky.ra,
      starDec: sky.dec,
      starName: `Manual point ${idx + 1}`,
    });
  }

  return correspondences;
}

/** Extract the 6 matrix coefficients from a CSS `matrix(...)` transform string. */
export function extractMatrixFromTransform(transform: string): AffineMatrix | null {
  if (!transform || transform === 'none') return null;
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (!match) return null;
  const values = match[1].split(',').map((v) => parseFloat(v.trim()));
  if (values.length !== 6) return null;
  return { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
}

const DEFAULT_MANUAL_PLACEMENT: ManualPlacement = {
  centerRa: 0,
  centerDec: 60,
  rotationDeg: 0,
  projPerPx: 0.002,
  mirrorX: false,
  mirrorY: false,
};

/**
 * Derive editable ManualPlacement params (centre RA/Dec, rotation, projPerPx, mirrors)
 * from a photo's first 3 correspondences, in view-independent projection space. Returns
 * a sane default when there are too few correspondences or the fit fails.
 */
export function derivePlacementFromCorrespondences(
  photo: Photo,
  naturalWidth: number,
  naturalHeight: number,
): ManualPlacement {
  if (photo.correspondences.length < 3) return { ...DEFAULT_MANUAL_PLACEMENT };

  try {
    const photoPoints: Point[] = [];
    const projPoints: Point[] = [];
    for (const corr of photo.correspondences.slice(0, 3)) {
      const raDec = getCorrRaDec(corr);
      if (!raDec) continue;
      photoPoints.push({ x: corr.photoX, y: corr.photoY });
      projPoints.push(project(raDec.ra, raDec.dec));
    }
    if (photoPoints.length < 3) return { ...DEFAULT_MANUAL_PLACEMENT };

    // Affine: photo pixels → projection space.
    const matrix = computeAffineTransform(
      photoPoints as [Point, Point, Point],
      projPoints as [Point, Point, Point],
    );

    const cx = naturalWidth / 2;
    const cy = naturalHeight / 2;
    const centerProjX = matrix.a * cx + matrix.c * cy + matrix.e;
    const centerProjY = matrix.b * cx + matrix.d * cy + matrix.f;
    const centerSky = unproject(centerProjX, centerProjY);

    // matrix maps [1,0] to [a,b], so rotation = atan2(b, a).
    const rotationDeg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    const scaleX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
    const scaleY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
    const projPerPx = (scaleX + scaleY) / 2;

    return {
      centerRa: centerSky.ra,
      centerDec: centerSky.dec,
      rotationDeg,
      projPerPx,
      mirrorX: false,
      mirrorY: false,
    };
  } catch (err) {
    reportUnknownRendererError('derive_placement_error', err);
    return { ...DEFAULT_MANUAL_PLACEMENT };
  }
}

/** Derive ManualPlacement params from a live photo→canvas CSS transform matrix. */
export function derivePlacementFromMatrix(
  matrix: AffineMatrix,
  view: ViewState,
  photoWidth: number,
  photoHeight: number,
): ManualPlacement {
  // matrix maps photo pixel (px,py) → canvas: cx = a*px + c*py + e, cy = b*px + d*py + f.
  const photoCenterX = photoWidth / 2;
  const photoCenterY = photoHeight / 2;
  const canvasCenterX = matrix.a * photoCenterX + matrix.c * photoCenterY + matrix.e;
  const canvasCenterY = matrix.b * photoCenterX + matrix.d * photoCenterY + matrix.f;

  const projCenter = fromCanvas(canvasCenterX, canvasCenterY, view);
  const centerSky = unproject(projCenter.x, projCenter.y);

  // a=cos*scale, b=sin*scale → rotation = atan2(b, a).
  const rotationDeg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  // |first column| = canvas px per photo px; ÷ view.scale → projection units per photo px.
  const pxPerPx = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
  const projPerPx = pxPerPx / view.scale;

  // A negative determinant indicates a reflection.
  const det = matrix.a * matrix.d - matrix.b * matrix.c;

  return {
    centerRa: centerSky.ra,
    centerDec: centerSky.dec,
    rotationDeg,
    projPerPx,
    mirrorX: false,
    mirrorY: det < 0,
  };
}
