/**
 * Pure helpers of online solving: turning what astrometry.net returns (a WCS header, or a
 * calibration) into a `WCSData` and star correspondences, reading the picture size a job
 * reports, and the guard that stops a solution being reused for a picture of another shape.
 */
import type { NovaCorrespondence } from './domain/solve';
import { wcsToCorrespondencesWithCatalog, type CatalogStar, type WCSData } from './wcs';

/** The numeric keys a WCS header must hold to be usable. */
const REQUIRED_WCS_KEYS = [
  'CRPIX1',
  'CRPIX2',
  'CRVAL1',
  'CRVAL2',
  'CD1_1',
  'CD1_2',
  'CD2_1',
  'CD2_2',
] as const;

type ParsedHeader = Record<string, number | string | boolean>;

/** True when the header carries every key of `REQUIRED_WCS_KEYS` as a number. */
export function hasAllWcsKeys(parsed: ParsedHeader): boolean {
  return REQUIRED_WCS_KEYS.every((key) => typeof parsed[key] === 'number');
}

/**
 * The WCS of an astrometry.net `wcs_file` header for a picture of `imageWidth` x `imageHeight`.
 * `scaleX` and `scaleY` rescale the reference pixel when the picture is not the solved one;
 * the CD matrix is kept. The SIP inverse terms are copied when the header has them.
 */
export function solutionToWcs(
  parsed: ParsedHeader,
  imageWidth: number,
  imageHeight: number,
  scaleX = 1,
  scaleY = 1,
): WCSData {
  const wcs: Record<string, unknown> = {
    CRPIX1: (parsed.CRPIX1 as number) * scaleX,
    CRPIX2: (parsed.CRPIX2 as number) * scaleY,
    CRVAL1: parsed.CRVAL1 as number,
    CRVAL2: parsed.CRVAL2 as number,
    CD1_1: parsed.CD1_1 as number,
    CD1_2: parsed.CD1_2 as number,
    CD2_1: parsed.CD2_1 as number,
    CD2_2: parsed.CD2_2 as number,
    NAXIS1: imageWidth,
    NAXIS2: imageHeight,
  };
  for (const prefix of ['AP', 'BP']) {
    const order = parsed[`${prefix}_ORDER`];
    if (!order) continue;
    wcs[`${prefix}_ORDER`] = order;
    for (let i = 0; i <= Number(order); i++) {
      for (let j = 0; j <= Number(order); j++) {
        const key = `${prefix}_${i}_${j}`;
        if (parsed[key] !== undefined) wcs[key] = parsed[key];
      }
    }
  }
  return wcs as unknown as WCSData;
}

/** What `/api/jobs/:id/calibration/` returns. */
export interface NovaCalibration {
  ra: number;
  dec: number;
  /** Arcseconds per pixel. */
  pixscale: number;
  /** Degrees. */
  orientation: number;
  parity?: number;
}

/**
 * The WCS (FITS convention: 1-based, origin bottom-left) of an astrometry.net calibration. The
 * calibration refers to the image centre in pixel coordinates (0-based, origin top-left).
 */
export function calibrationToWcs(
  cal: NovaCalibration,
  imageWidth: number,
  imageHeight: number,
): WCSData {
  const pixscale = cal.pixscale / 3600; // arcsec/pixel -> degrees/pixel
  const orientation = cal.orientation * (Math.PI / 180);
  const parity = cal.parity || 1; // 1 or -1

  // Negating CD1_1 and CD2_2 matches the FITS convention.
  const centerPixelX = imageWidth / 2;
  const centerPixelY = imageHeight / 2;
  return {
    CRPIX1: centerPixelX + 1, // FITS_X = pixel_X + 1
    CRPIX2: imageHeight - centerPixelY, // FITS_Y = H - pixel_Y
    CRVAL1: cal.ra,
    CRVAL2: cal.dec,
    CD1_1: -pixscale * Math.cos(orientation) * parity,
    CD1_2: pixscale * Math.sin(orientation),
    CD2_1: pixscale * Math.sin(orientation) * parity,
    CD2_2: -pixscale * Math.cos(orientation),
    NAXIS1: imageWidth,
    NAXIS2: imageHeight,
  };
}

/** The correspondences of a calibration against `catalog`. */
export function calibrationToCorrespondences(
  cal: NovaCalibration,
  imageWidth: number,
  imageHeight: number,
  catalog: CatalogStar[],
): NovaCorrespondence[] {
  return wcsToCorrespondencesWithCatalog(
    calibrationToWcs(cal, imageWidth, imageHeight),
    catalog,
    imageWidth,
    imageHeight,
  );
}

function asPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** The picture size a job's `/info/` answer reports, under any of the names astrometry.net has used. */
export function dimensionsFromJobInfo(info: any): { width?: number; height?: number } {
  const width =
    asPositiveNumber(info?.image_width) ??
    asPositiveNumber(info?.imagew) ??
    asPositiveNumber(info?.width) ??
    asPositiveNumber(info?.original_width) ??
    asPositiveNumber(info?.original_image_width) ??
    asPositiveNumber(info?.calibration?.image_width) ??
    asPositiveNumber(info?.calibration?.width);

  const height =
    asPositiveNumber(info?.image_height) ??
    asPositiveNumber(info?.imageh) ??
    asPositiveNumber(info?.height) ??
    asPositiveNumber(info?.original_height) ??
    asPositiveNumber(info?.original_image_height) ??
    asPositiveNumber(info?.calibration?.image_height) ??
    asPositiveNumber(info?.calibration?.height);

  return { width, height };
}

/** The picture size a WCS header reports (`IMAGEW`/`IMAGEH`, else `NAXIS1`/`NAXIS2`). */
export function dimensionsFromWcsHeader(parsed: ParsedHeader): {
  width?: number;
  height?: number;
} {
  return {
    width: asPositiveNumber(parsed.IMAGEW) ?? asPositiveNumber(parsed.NAXIS1),
    height: asPositiveNumber(parsed.IMAGEH) ?? asPositiveNumber(parsed.NAXIS2),
  };
}

const ASPECT_DIFF_LIMIT = 0.03;
const SCALE_SKEW_LIMIT = 0.03;

/**
 * Compares the picture a solution was computed for with the one it is reused for. A uniform
 * resize is expected (`scaleX` about `scaleY`); a large aspect or skew difference usually means
 * the selected job belongs to another image.
 */
export function solutionFitsPicture(
  original: { width: number; height: number },
  current: { width: number; height: number },
): boolean {
  const scaleX = current.width / original.width;
  const scaleY = current.height / original.height;
  const originalAspect = original.width / original.height;
  const currentAspect = current.width / current.height;
  const aspectDiff = Math.abs(currentAspect - originalAspect) / Math.max(1e-9, originalAspect);
  const scaleSkew = Math.abs(scaleX - scaleY) / Math.max(1e-9, Math.max(scaleX, scaleY));
  return aspectDiff <= ASPECT_DIFF_LIMIT && scaleSkew <= SCALE_SKEW_LIMIT;
}
