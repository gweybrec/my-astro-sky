import type { BatchItem } from './batch-types';
import type { PlateSolveResult } from '@myastrosky/core/types';
import { wcsCaptureMetadata, wcsPhotoMetadata } from '@myastrosky/core/wcs-photo-metadata';

export interface ApplyWcsResult {
  /** True when the result carried usable correspondences and the item was placed. */
  applied: boolean;
  /** True when the caller should warn about a source/target aspect-ratio mismatch. */
  aspectMismatch: boolean;
}

/**
 * Takes the header data of a solved or raw file into a batch item, solved or not: the date, one integration row,
 * the capture fields and the header cards, never over a value the user already entered; and the saved setup the
 * header points to, when the item has none.
 */
export function applyWcsMetadataToItem(
  item: BatchItem,
  result: PlateSolveResult,
  suggestedSetupId: string | null = null,
): void {
  const meta = wcsCaptureMetadata(result);
  if (meta.observationDate && !item.observationDate) item.observationDate = meta.observationDate;
  if (meta.integrations.length > 0 && item.integrations.length === 0) {
    item.integrations = meta.integrations;
  }
  if (meta.captureDetails) {
    const merged = { ...item.captureDetails };
    for (const [k, v] of Object.entries(meta.captureDetails)) {
      if (merged[k] === undefined || merged[k] === '') merged[k] = v;
    }
    item.captureDetails = merged;
  }
  if (meta.fitsHeaders) item.fitsHeaders = meta.fitsHeaders;
  if (suggestedSetupId && !item.gearSetupId) item.gearSetupId = suggestedSetupId;
}

/**
 * Apply a WCS solve/convert result to a batch item. Shared by the WCS companion-file picker (`BatchCard`'s
 * `handleWcsFile`) and raw-file conversion (a converted TIFF/FITS often already carries WCS in its own header). The
 * header data is always taken (`applyWcsMetadataToItem`); with a plate solution the item is also placed "without
 * running a plate solver". Pure state mutation — no DOM, no toasts; the caller decides how to tell the user.
 */
export function applyWcsResultToItem(
  item: BatchItem,
  result: PlateSolveResult,
  imgWidth: number,
  imgHeight: number,
  suggestedSetupId: string | null = null,
): ApplyWcsResult {
  applyWcsMetadataToItem(item, result, suggestedSetupId);
  const placed = wcsPhotoMetadata(result, imgWidth, imgHeight);
  if (!placed) return { applied: false, aspectMismatch: false };

  item.wcsResult = result;
  item.solveCorrespondences = result.correspondences!;
  item.manualPlacement = null;
  item.status = 'success';
  // WCS solving doesn't return DSOs from the server; they are derived from the solved correspondences.
  item.dsoIds = placed.dsoIds;
  return { applied: true, aspectMismatch: !!result.dimensionWarning?.aspectMismatch };
}
