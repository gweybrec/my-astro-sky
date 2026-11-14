import type { CaptureDetails, PhotoIntegration, PlateSolveResult } from './types';
import type { FitsCard } from './fits-header';
import { findDSOIdsFromCorrespondences } from './catalog/dso-registry';

/** What the header of a solved or raw file says about the capture, whether or not it holds a plate solution. */
export interface WcsCaptureMetadata {
  /** DATE-OBS of the header (UTC ISO 8601). */
  observationDate?: string;
  /** One row from the sub exposure, the frame count and FILTER, only when the header has both numbers. */
  integrations: PhotoIntegration[];
  captureDetails?: CaptureDetails;
  /** Every header card, as written. */
  fitsHeaders?: FitsCard[];
}

/** What a solved (WCS) file tells about its photo besides where it is: the objects in the field and the capture data. */
export interface WcsPhotoMetadata extends WcsCaptureMetadata {
  /** The solver's objects, else the catalog objects that fall in the image. */
  dsoIds: string[];
}

/** The capture data of a solve/convert result, solved or not (see `WcsCaptureMetadata`). */
export function wcsCaptureMetadata(result: PlateSolveResult): WcsCaptureMetadata {
  const integrations: PhotoIntegration[] =
    result.expTime && result.stackCnt
      ? [
          {
            frames: Math.round(result.stackCnt),
            seconds: Math.round(result.expTime),
            filter: result.filter ?? '',
          },
        ]
      : [];
  return {
    ...(result.dateObs ? { observationDate: result.dateObs } : {}),
    integrations,
    ...(result.captureDetails ? { captureDetails: { ...result.captureDetails } } : {}),
    ...(result.fitsHeaders && result.fitsHeaders.length > 0
      ? { fitsHeaders: result.fitsHeaders }
      : {}),
  };
}

/**
 * The photo metadata a WCS solve/convert result pre-fills. Shared by the desktop's batch import and the phone's
 * import: a solved file is "placed without running a plate solver", so these come from its header and from the
 * catalog. Returns null when the result carries no usable correspondences (`wcsCaptureMetadata` still reads the
 * header of such a file).
 */
export function wcsPhotoMetadata(
  result: PlateSolveResult,
  imgWidth: number,
  imgHeight: number,
): WcsPhotoMetadata | null {
  if (!result.success || !result.correspondences || result.correspondences.length < 1) return null;
  const dsoIds =
    result.dsoIds && result.dsoIds.length > 0
      ? [...result.dsoIds]
      : findDSOIdsFromCorrespondences(result.correspondences, imgWidth, imgHeight);
  return { dsoIds, ...wcsCaptureMetadata(result) };
}
