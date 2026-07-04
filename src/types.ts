export interface Star {
  hip: number;
  ra: number; // degrees [0, 360)
  dec: number; // degrees [-90, 90]
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  // ── render cache (see projectCached) ──
  _px?: number;
  _py?: number;
  _pg?: number;
  // ── horizon-visibility cache (see isBelowHorizonCached) ──
  _altDeg?: number;
  _belowHorizon?: boolean;
  _ag?: number;
}

export type ConstellationStyle = 'western' | 'stellarium' | 'rey' | 'chinese' | 'arabic';

export const IAU_CONSTELLATION_STYLES: ConstellationStyle[] = ['western', 'stellarium', 'rey'];

export function isIAUStyle(style: ConstellationStyle): boolean {
  return (IAU_CONSTELLATION_STYLES as string[]).includes(style);
}

export interface ConstellationLine {
  id: string;
  segments: [number, number][][];
}

export interface ConstellationInfo {
  id: string;
  name: string;
  displayName: string;
  ra: number;
  dec: number;
}

export interface PhotoCorrespondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number; // direct RA (degrees) when starHip=0
  starDec?: number; // direct Dec (degrees) when starHip=0
}

export interface PhotoIntegration {
  frames: number;
  seconds: number;
  filter: string;
}

/** A non-DSO object captured in a photo (comet, asteroid, satellite, ISS…). */
export interface PointOfInterest {
  name: string;
  categoryId: string;
}

/** A user-managed POI category (e.g. Comet, Asteroid). Stored globally, not per-photo. */
export interface PoiCategory {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface Photo {
  id: string;
  filename: string;
  originalName: string;
  width: number;
  height: number;
  createdAt: string;
  correspondences: PhotoCorrespondence[];
  manualPlacement?: ManualPlacement; // Store manual placement params to recompute transform with current view
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations?: PhotoIntegration[];
  observationDate?: string | null; // UTC ISO 8601 observation start (from DATE-OBS or user input)
  notes: string;
  fileSize?: number | null; // Server-computed file size in bytes (present when loaded from API)
  thumbFilename?: string | null; // Low-res thumbnail filename (generated on upload)
}

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewState {
  centerX: number;
  centerY: number;
  scale: number;
  rotationDeg: number;
  width: number;
  height: number;
}

export interface DetectedSpot {
  x: number; // pixel X (in the downscaled image)
  y: number; // pixel Y
  brightness: number; // sum of intensities in the component
  size: number; // number of pixels
}

export interface StarDetectionResult {
  spots: DetectedSpot[];
  imageWidth: number;
  imageHeight: number;
  scaleFromOriginal: number; // ratio analysed size / original size
}

export interface WCSDimensionWarning {
  sourceW: number;
  sourceH: number;
  targetW: number;
  targetH: number;
  aspectMismatch: boolean;
}

export interface ApiErrorDetails {
  httpStatus?: number;
  httpStatusText?: string;
  code?: string;
  method?: string;
  endpoint?: string;
  responseBody?: string;
}

export interface PlateSolveResult {
  success: boolean;
  correspondences?: PhotoCorrespondence[];
  error?: string;
  code?: string;
  errorDetails?: ApiErrorDetails;
  diagnostics?: string; // raw solver output for the collapsible details section
  sourceWidth?: number;
  sourceHeight?: number;
  dimensionWarning?: WCSDimensionWarning;
  dsoIds?: string[]; // DSOs detected in the field (populated by server-side solvers)
  dateObs?: string; // DATE-OBS from WCS header (UTC ISO 8601)
  expTime?: number; // EXPTIME from WCS header (seconds)
  stackCnt?: number; // STACKCNT from WCS header (frame count)
}

export interface AstrometrySolveStatus {
  jobId: string;
  status: 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';
  correspondences?: PhotoCorrespondence[];
  error?: string;
  dsoIds?: string[];
}

export type DSOType =
  'GxS' | 'GxE' | 'GxI' | 'Gx' | 'OC' | 'GC' | 'EN' | 'RN' | 'PN' | 'SNR' | 'DN' | '?';

export interface DSO {
  id: string; // display ID (highest priority: M > NGC > IC > SH2 > LBN > LDN)
  ra: number; // degrés [0, 360)
  dec: number; // degrés [-90, 90]
  type: DSOType;
  majAxis: number | null; // arcminutes
  minAxis: number | null; // arcminutes (null → même que majAxis)
  pa: number; // angle de position, degrés E du nord
  mag: number | null;
  displayName: string | null;
  catalogs: string[]; // all catalog IDs: ["M42", "NGC1976", "LBN974"]
  emissionLines: string | null; // e.g. "OIII > HD", "mostly NII"
  constellation: string | null; // 3-letter IAU abbreviation, e.g. "Lyr"
  rating: number | null; // photographic interest 1–5 (null if missing from catalog)
  difficulty: number | null; // imaging difficulty 1–5 (null if missing from catalog)
  containerId: string | null; // id of the smallest larger DSO enclosing this one (zoom-gated inner objects), null if none
  priority: number; // precomputed render order (lower = drawn first); spatial-spread blue-noise rank
  catalog?: string | null; // precomputed catalog prefix at load (see getDSOCatalog), null if none
  // ── render cache (see projectCached / dsoSizeCos2) ──
  _px?: number;
  _py?: number;
  _pg?: number;
  _cos2?: number; // cached angular-size dec factor for angularSizeToCanvasPx
  _cos2g?: number; // projection generation _cos2 was computed for
  _cos2z?: number; // cached angular-size altitude factor (zenith/local-sky mode)
  _cos2zg?: number; // projection generation _cos2z was computed for
  // ── horizon-visibility cache (see isBelowHorizonCached) ──
  _altDeg?: number;
  _belowHorizon?: boolean;
  _ag?: number;
}

export interface DSOSearchResult {
  dso: DSO;
  label: string;
  score: number;
}

export interface ManualPlacement {
  centerRa: number;
  centerDec: number;
  rotationDeg: number;
  projPerPx: number; // unités de projection par pixel photo
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface DSOUserOverride {
  names?: { fr?: string; en?: string; es?: string; de?: string };
  ra?: number;
  dec?: number;
  constellation?: string;
  rating?: number;
  difficulty?: number;
  type?: DSOType;
}

export type ViewMode = 'skymap' | 'gallery' | 'plans';
