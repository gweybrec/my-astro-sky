import type { CaptureDetails, PhotoIntegration, PlateSolveResult } from './types';
import { findDSOIdsFromCorrespondences } from './catalog/dso-registry';

/** What a solved (WCS) file tells about its photo besides where it is: the objects in the field and the capture data. */
export interface WcsPhotoMetadata {
  /** The solver's objects, else the catalog objects that fall in the image. */
  dsoIds: string[];
  /** DATE-OBS of the header (UTC ISO 8601). */
  observationDate?: string;
  /** One row from EXPTIME / STACKCNT / FILTER, only when the header has the exposure and the frame count. */
  integrations: PhotoIntegration[];
  captureDetails?: CaptureDetails;
}

/**
 * The photo metadata a WCS solve/convert result pre-fills. Shared by the desktop's batch import and the phone's
 * import: a solved file is "placed without running a plate solver", so these come from its header and from the
 * catalog. Returns null when the result carries no usable correspondences.
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
    dsoIds,
    ...(result.dateObs ? { observationDate: result.dateObs } : {}),
    integrations,
    ...(result.captureDetails ? { captureDetails: { ...result.captureDetails } } : {}),
  };
}
