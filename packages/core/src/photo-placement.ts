/**
 * Pure placement / geometry / visibility logic for astrophotos on the sky map.
 *
 * Every placement goes through one model per photo, {@link photoSkyModel} (its pixels to the sky): the sky map's
 * drawing (a mesh of it in the map's projection, {@link projectPhotoMesh}), its outline and culling, the objects
 * drawn on the photo and the identifications, so none of them can disagree with another. Nothing here touches the
 * DOM, an `<img>`, or a modal — it takes plain data (a `Photo`, a `ViewState`, filter state) and returns plain data
 * (models, meshes, coordinates, booleans). Keeping the math here makes it unit-testable (see
 * `tests/unit/photo-placement.test.ts`) instead of hidden behind canvas code.
 */
import type {
  Photo,
  PhotoCorrespondence,
  Point,
  ViewState,
  ManualPlacement,
  AffineMatrix,
} from './types';
import {
  project,
  projectContinued,
  toCanvas,
  fromCanvas,
  unproject,
  getHemisphere,
  withCanonicalProjection,
} from './projection';
import { computeAffineTransform, computeAffineLSQ } from './affine';
import {
  fitPhotoSkyModel,
  linearPhotoSkyModel,
  pixelScaleDeg,
  tangentToSky,
  type PhotoSkyModel,
  type RaDec,
} from './photo-sky-model';
import { getStarByHip } from './catalog/star-registry';
import { reportError } from './platform/error-hook';
import { normalizeRotationDeg } from './sky-map-types';

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

type PlaceablePhoto = Pick<Photo, 'width' | 'height' | 'correspondences' | 'manualPlacement'>;

/**
 * The model of a photo placed by hand: its placement draws it in the default projection (pole-centred stereographic)
 * as an affine map; the model is the one that matches it at its centre (same position, scale, angle and mirroring)
 * and follows the sky's curvature away from it, as a photo's own pixels do.
 */
function manualPlacementSkyModel(
  placement: ManualPlacement,
  width: number,
  height: number,
): PhotoSkyModel {
  return withCanonicalProjection(() => {
    const m = computeManualProjMatrix(placement, width, height);
    const center: RaDec = { ra: placement.centerRa, dec: placement.centerDec };
    // How the projection moves with the standard coordinates at the centre, to undo it: d(proj)/d(ξ, η).
    const h = 1e-6;
    const p0 = project(center.ra, center.dec);
    const sx = tangentToSky(h, 0, center.ra, center.dec);
    const sy = tangentToSky(0, h, center.ra, center.dec);
    const px = project(sx.ra, sx.dec);
    const py = project(sy.ra, sy.dec);
    const j00 = (px.x - p0.x) / h;
    const j01 = (py.x - p0.x) / h;
    const j10 = (px.y - p0.y) / h;
    const j11 = (py.y - p0.y) / h;
    const det = j00 * j11 - j01 * j10;
    const [i00, i01, i10, i11] = [j11 / det, -j01 / det, -j10 / det, j00 / det];
    return linearPhotoSkyModel(
      center,
      {
        a: i00 * m.a + i01 * m.b,
        b: i10 * m.a + i11 * m.b,
        c: i00 * m.c + i01 * m.d,
        d: i10 * m.c + i11 * m.d,
      },
      width,
      height,
    );
  });
}

const modelCache = new WeakMap<
  object,
  {
    correspondences: unknown;
    manualPlacement: unknown;
    width: number;
    height: number;
    hemisphere: string;
    model: PhotoSkyModel | null;
  }
>();

/**
 * Where the photo is on the sky (see {@link PhotoSkyModel}): from its manual placement when it has one, else from its
 * reference points (a plate solution's, or the stars matched by hand). Null when it cannot be placed: fewer than 2
 * points with a sky position, or points in a line. Kept per photo object until its points or placement change.
 */
export function photoSkyModel(photo: PlaceablePhoto): PhotoSkyModel | null {
  const hemisphere = getHemisphere();
  const cached = modelCache.get(photo);
  if (
    cached &&
    cached.correspondences === photo.correspondences &&
    cached.manualPlacement === photo.manualPlacement &&
    cached.width === photo.width &&
    cached.height === photo.height &&
    cached.hemisphere === hemisphere
  ) {
    return cached.model;
  }
  let model: PhotoSkyModel | null = null;
  if (photo.manualPlacement) {
    model = manualPlacementSkyModel(photo.manualPlacement, photo.width, photo.height);
  } else {
    const photoPoints: Point[] = [];
    const sky: RaDec[] = [];
    for (const corr of photo.correspondences ?? []) {
      const raDec = getCorrRaDec(corr);
      if (!raDec) continue;
      photoPoints.push({ x: corr.photoX, y: corr.photoY });
      sky.push(raDec);
    }
    if (photoPoints.length >= 2) {
      try {
        model = fitPhotoSkyModel(photoPoints, sky, photo.width, photo.height);
      } catch {
        model = null; // points in a line
      }
    }
  }
  modelCache.set(photo, {
    correspondences: photo.correspondences,
    manualPlacement: photo.manualPlacement,
    width: photo.width,
    height: photo.height,
    hemisphere,
    model,
  });
  return model;
}

/**
 * {@link photoSkyModel} as the sky map draws the photo at `view`: a manual placement saved before its angle was on
 * the sky (no `angleOnSky`) keeps its angle on screen, so it is placed with the map's rotation (see
 * {@link withAngleOnSky}). Repositioning such a photo saves its angle on the sky.
 */
export function photoSkyModelAtView(
  photo: PlaceablePhoto,
  view: Pick<ViewState, 'rotationDeg'>,
): PhotoSkyModel | null {
  const mp = photo.manualPlacement;
  if (!mp || mp.angleOnSky) return photoSkyModel(photo);
  return photoSkyModel({ ...photo, manualPlacement: withAngleOnSky(mp, view as ViewState) });
}

/**
 * A photo's model as the sky map draws it: a grid of (n + 1) × (n + 1) points of the photo, from its top-left corner
 * row by row, in projection space (the active projection, continued past the rim; see `projectContinued`), with the
 * photo's centre, the largest distance from it to its edge, and the projection units per photo pixel at the centre.
 * Valid until the projection changes (`getProjectionGeneration`).
 */
export interface PhotoMesh {
  n: number;
  /** x, y of each grid point, in projection units. */
  nodes: Float64Array;
  centroid: Point;
  halfDiag: number;
  projPerPx: number;
}

/**
 * How many cells a side of a photo's mesh has: enough for the drawing to stay within about a pixel of the model (its
 * error grows with the square of a cell's size on the sky), from 2 for a small field to 16 for a wide one.
 */
export function meshDivisions(model: PhotoSkyModel): number {
  const diagDeg = pixelScaleDeg(model) * Math.hypot(model.width, model.height);
  return Math.max(2, Math.min(16, Math.ceil(diagDeg * 5)));
}

/** The photo's {@link PhotoMesh} in the active projection, `n` cells a side. */
export function projectPhotoMesh(model: PhotoSkyModel, n = meshDivisions(model)): PhotoMesh {
  const { width, height } = model;
  const nodes = new Float64Array((n + 1) * (n + 1) * 2);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const sky = model.toSky((width * i) / n, (height * j) / n);
      const p = projectContinued(sky.ra, sky.dec);
      nodes[k++] = p.x;
      nodes[k++] = p.y;
    }
  }
  const sc = model.toSky(width / 2, height / 2);
  const centroid = projectContinued(sc.ra, sc.dec);
  let halfDiag = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      if (j !== 0 && j !== n && i !== 0 && i !== n) continue;
      const q = (j * (n + 1) + i) * 2;
      halfDiag = Math.max(halfDiag, Math.hypot(nodes[q] - centroid.x, nodes[q + 1] - centroid.y));
    }
  }
  const sx = model.toSky(width / 2 + 1, height / 2);
  const sy = model.toSky(width / 2, height / 2 + 1);
  const px = projectContinued(sx.ra, sx.dec);
  const py = projectContinued(sy.ra, sy.dec);
  const projPerPx = Math.sqrt(
    Math.abs((px.x - centroid.x) * (py.y - centroid.y) - (px.y - centroid.y) * (py.x - centroid.x)),
  );
  return { n, nodes, centroid, halfDiag, projPerPx };
}

/** The four corners of the photo, (0,0), (w,0), (w,h), (0,h), in projection space. */
export function meshCorners(mesh: PhotoMesh): Point[] {
  const { n, nodes } = mesh;
  return [0, n, (n + 1) * (n + 1) - 1, n * (n + 1)].map((k) => ({
    x: nodes[k * 2],
    y: nodes[k * 2 + 1],
  }));
}

/**
 * The photo's outline in projection space: its edges as the mesh draws them, clockwise from the top-left corner,
 * `n` points a side.
 */
export function meshOutline(mesh: PhotoMesh): Point[] {
  const { n, nodes } = mesh;
  const at = (i: number, j: number) => {
    const k = (j * (n + 1) + i) * 2;
    return { x: nodes[k], y: nodes[k + 1] };
  };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push(at(i, 0));
  for (let j = 0; j < n; j++) out.push(at(n, j));
  for (let i = n; i > 0; i--) out.push(at(i, n));
  for (let j = n; j > 0; j--) out.push(at(0, j));
  return out;
}

/**
 * The affine map from photo pixels to canvas pixels at `view` that best follows the mesh (least squares on its
 * points): for what needs one matrix (the picture size to load, the drawing where WebGL is missing).
 */
export function meshCanvasAffine(
  mesh: PhotoMesh,
  width: number,
  height: number,
  view: ViewState,
): AffineMatrix {
  const { n, nodes } = mesh;
  const photoPoints: Point[] = [];
  const canvasPoints: Point[] = [];
  const step = Math.max(1, Math.floor(n / 2));
  for (let j = 0; j <= n; j += step) {
    for (let i = 0; i <= n; i += step) {
      const k = (j * (n + 1) + i) * 2;
      photoPoints.push({ x: (width * i) / n, y: (height * j) / n });
      canvasPoints.push(toCanvas(nodes[k], nodes[k + 1], view));
    }
  }
  return computeAffineLSQ(photoPoints, canvasPoints);
}

/** The affine map from photo pixels to projection space that best follows the model (least squares on a 3 × 3 grid). */
function modelProjAffine(model: PhotoSkyModel): AffineMatrix | null {
  const photoPoints: Point[] = [];
  const projPoints: Point[] = [];
  for (const fy of [0, 0.5, 1]) {
    for (const fx of [0, 0.5, 1]) {
      const sky = model.toSky(model.width * fx, model.height * fy);
      photoPoints.push({ x: model.width * fx, y: model.height * fy });
      projPoints.push(project(sky.ra, sky.dec));
    }
  }
  try {
    return computeAffineLSQ(photoPoints, projPoints);
  } catch {
    return null;
  }
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

/**
 * Canvas-space corners of a photo's outline at `view`, or null when it can't be
 * placed (fewer than 2 resolvable correspondences, or colinear points). A manual
 * placement wins over the correspondences, as it does for the image itself. Border /
 * visibility filtering is the caller's job — this is pure geometry.
 */
export function computePhotoQuadCorners(photo: Photo, view: ViewState): Point[] | null {
  const model = photoSkyModelAtView(photo, view);
  if (!model) return null;
  return [
    [0, 0],
    [photo.width, 0],
    [photo.width, photo.height],
    [0, photo.height],
  ].map(([x, y]) => {
    const sky = model.toSky(x, y);
    const p = projectContinued(sky.ra, sky.dec);
    return toCanvas(p.x, p.y, view);
  });
}

/**
 * The photo's mesh in canvas pixels at `view` (see {@link projectPhotoMesh}), or null when the photo can't be placed
 * or its centre falls outside the border circle. Used by the map export to draw a photo at any view.
 */
export function computePhotoCanvasMesh(
  photo: Photo,
  view: ViewState,
  borderRadiusPU: number,
): { n: number; points: Point[] } | null {
  const model = photoSkyModelAtView(photo, view);
  if (!model) return null;
  const mesh = projectPhotoMesh(model);
  if (!isCentroidInsideBorder(mesh.centroid, borderRadiusPU)) return null;
  const points: Point[] = [];
  for (let k = 0; k < mesh.nodes.length; k += 2) {
    points.push(toCanvas(mesh.nodes[k], mesh.nodes[k + 1], view));
  }
  return { n: mesh.n, points };
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
  const model = photoSkyModel(photo);
  if (!model) return null;

  try {
    const projCorners = meshOutline(projectPhotoMesh(model, 4));

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
    // All four corners coincide (e.g. every correspondence is below the horizon in
    // Local Sky mode / in the far hemisphere in fisheye mode, so project() returns
    // the same off-screen sentinel for all of them). There is no finite framing
    // scale — `Math.min(viewWidth / 0, viewHeight / 0)` would be Infinity.
    if (!(extentX > 0) || !(extentY > 0)) return null;
    const scale = Math.min(viewWidth / extentX, viewHeight / extentY) * 0.8;
    if (!Number.isFinite(scale) || scale <= 0) return null;

    return { ra: center.ra, dec: center.dec, scale };
  } catch {
    return null;
  }
}

/** Average RA/Dec centre of a photo from its correspondences, or null if none resolve. */
export function computePhotoCenter(photo: Photo): { ra: number; dec: number } | null {
  const model = photoSkyModel(photo);
  return model ? model.toSky(photo.width / 2, photo.height / 2) : null;
}

/** The label filter's entry for the photos that have no label. */
export const NO_LABEL = '(no label)';

/** The labels of the given photos with how many photos carry each (photos without one under {@link NO_LABEL}), by name. */
export function buildLabelFilterItems(
  photos: ReadonlyArray<Pick<Photo, 'labels'>>,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    const labels = photo.labels?.length ? photo.labels : [NO_LABEL];
    for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** True when the photo passes the current label filter (no filter ⇒ allowed). */
export function isLabelAllowed(photo: Photo, visibleLabels: { [label: string]: boolean }): boolean {
  const filterKeys = Object.keys(visibleLabels || {});
  if (filterKeys.length === 0) return true;
  if (!photo.labels || photo.labels.length === 0) {
    return visibleLabels[NO_LABEL] !== false;
  }
  return photo.labels.some((l) => visibleLabels[l] !== false);
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
  // An angle on the sky turns with the map (toCanvas turns the sky by −rotationDeg); one saved before is on screen.
  const screenDeg = placement.angleOnSky
    ? placement.rotationDeg - view.rotationDeg
    : placement.rotationDeg;
  const rotRad = (screenDeg * Math.PI) / 180;

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

/** The placement with its angle on the sky, drawn as it is at `view`: one saved with an angle on screen gets the map's turn added. */
export function withAngleOnSky(placement: ManualPlacement, view: ViewState): ManualPlacement {
  if (placement.angleOnSky) return placement;
  return {
    ...placement,
    rotationDeg: normalizeRotationDeg(placement.rotationDeg + view.rotationDeg),
    angleOnSky: true,
  };
}

/** Neutral view under which `toCanvas` reduces to the pure flip `(x, y) → (x, -y)` —
 * scale 1, no rotation, no translation. Used by {@link computeManualProjMatrix} to get
 * a photo→canvas matrix out of `computeManualMatrix` and undo just that flip, landing
 * in projection space instead of canvas space. */
const PROJ_VIEW: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 1,
  rotationDeg: 0,
  width: 0,
  height: 0,
};

/**
 * Build the photo→projection-space affine matrix for a manual placement, independent
 * of any view/canvas: what the placement's centre, angle, scale and mirroring mean, before
 * {@link photoSkyModel} turns it into a placement on the sky.
 * Reuses {@link computeManualMatrix}'s rotation/mirror math via the neutral
 * {@link PROJ_VIEW} rather than re-deriving it, then un-flips the y row.
 */
export function computeManualProjMatrix(
  placement: ManualPlacement,
  natW: number,
  natH: number,
): AffineMatrix {
  const m = computeManualMatrix(placement, PROJ_VIEW, natW, natH);
  return { a: m.a, b: -m.b, c: m.c, d: -m.d, e: m.e, f: -m.f };
}

/**
 * The photo→projection-space affine matrix for any `Photo`, manually placed or
 * plate-solved, independent of any view/canvas. Null when the photo can't be placed
 * (manual placement missing, or fewer than 2 resolvable correspondences).
 */
export function computePhotoToProjMatrix(photo: Photo): AffineMatrix | null {
  if (photo.manualPlacement) {
    return computeManualProjMatrix(photo.manualPlacement, photo.width, photo.height);
  }
  const model = photoSkyModel(photo);
  return model ? modelProjAffine(model) : null;
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

const DEFAULT_MANUAL_PLACEMENT: ManualPlacement = {
  centerRa: 0,
  centerDec: 60,
  rotationDeg: 0,
  projPerPx: 0.002,
  mirrorX: false,
  mirrorY: false,
  angleOnSky: true,
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
    return placementFromProjMatrix(matrix, naturalWidth, naturalHeight);
  } catch (err) {
    reportError('derive_placement_error', err);
    return { ...DEFAULT_MANUAL_PLACEMENT };
  }
}

/** The manual placement that draws a photo of `width` × `height` as the photo→projection-space `matrix` does. */
export function placementFromProjMatrix(
  matrix: AffineMatrix,
  width: number,
  height: number,
): ManualPlacement {
  const cx = width / 2;
  const cy = height / 2;
  const centerProjX = matrix.a * cx + matrix.c * cy + matrix.e;
  const centerProjY = matrix.b * cx + matrix.d * cy + matrix.f;
  const centerSky = unproject(centerProjX, centerProjY);

  // The inverse of computeManualProjMatrix: a = cos·mx·p, b = −sin·mx·p, c = −sin·my·p, d = −cos·my·p (projection
  // space has y up, the photo y down). Its determinant is −mx·my·p², so a positive one is a mirrored photo, given here
  // as mirrorX.
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  const mx = det > 0 ? -1 : 1;
  const rotationDeg = (Math.atan2(-matrix.b * mx, matrix.a * mx) * 180) / Math.PI;
  const scaleX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
  const scaleY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
  const projPerPx = (scaleX + scaleY) / 2;

  return {
    centerRa: centerSky.ra,
    centerDec: centerSky.dec,
    rotationDeg,
    projPerPx,
    mirrorX: mx < 0,
    mirrorY: false,
    angleOnSky: true,
  };
}

/**
 * Where a placed photo is now, as a manual placement to start repositioning it from: its own manual placement (with
 * its angle on the sky), else the one that draws it as its star correspondences do, turned to the whole degree.
 */
export function currentPlacement(photo: Photo, view: ViewState): ManualPlacement {
  if (photo.manualPlacement) return withAngleOnSky({ ...photo.manualPlacement }, view);
  const matrix = computePhotoToProjMatrix(photo);
  const placement = matrix
    ? placementFromProjMatrix(matrix, photo.width, photo.height)
    : derivePlacementFromCorrespondences(photo, photo.width, photo.height);
  return { ...placement, rotationDeg: Math.round(placement.rotationDeg) };
}

/**
 * Manual-placement zoom read-out. The slider value is log2 of the photo scale relative to the map
 * (larger = bigger photo); `initialValue` is the slider value when the mode opened, which reads
 * "100 %". Whole percent, non-breaking space before the sign (French typography).
 */
export function formatZoomPercent(projPerPx: number, initialProjPerPx: number): string {
  const nbsp = String.fromCharCode(160);
  return `${Math.round((projPerPx / initialProjPerPx) * 100)}${nbsp}%`;
}
