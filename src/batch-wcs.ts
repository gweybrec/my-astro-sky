import type { BatchItem } from './batch-types';
import type { PlateSolveResult } from '@myastrosky/core/types';
import { wcsPhotoMetadata } from '@myastrosky/core/wcs-photo-metadata';

export interface ApplyWcsResult {
  /** True when the result carried usable correspondences and the item was placed. */
  applied: boolean;
  /** True when the caller should warn about a source/target aspect-ratio mismatch. */
  aspectMismatch: boolean;
}

/**
 * Apply a WCS solve/convert result to a batch item — the "placed without running a
 * plate solver" transition. Shared by the WCS companion-file picker (`BatchCard`'s
 * `handleWcsFile`) and raw-file conversion (a converted TIFF/FITS often already carries
 * WCS in its own header). Pure state mutation — no DOM, no toasts; the caller decides
 * how to surface `aspectMismatch` (or a plain failure) to the user.
 */
export function applyWcsResultToItem(
  item: BatchItem,
  result: PlateSolveResult,
  imgWidth: number,
  imgHeight: number,
): ApplyWcsResult {
  if (!result.success || !result.correspondences || result.correspondences.length < 1) {
    return { applied: false, aspectMismatch: false };
  }

  const meta = wcsPhotoMetadata(result, imgWidth, imgHeight)!;
  item.wcsResult = result;
  item.solveCorrespondences = result.correspondences;
  item.status = 'success';

  // WCS solving doesn't return DSOs from the server; they are derived from the solved correspondences.
  item.dsoIds = meta.dsoIds;
  if (meta.observationDate && !item.observationDate) item.observationDate = meta.observationDate;
  if (meta.integrations.length > 0 && item.integrations.length === 0) {
    item.integrations = meta.integrations;
  }
  // Merge parsed capture fields, keeping any value the user already entered.
  if (meta.captureDetails) {
    const merged = { ...item.captureDetails };
    for (const [k, v] of Object.entries(meta.captureDetails)) {
      if (merged[k] === undefined || merged[k] === '') merged[k] = v;
    }
    item.captureDetails = merged;
  }

  return { applied: true, aspectMismatch: !!result.dimensionWarning?.aspectMismatch };
}
