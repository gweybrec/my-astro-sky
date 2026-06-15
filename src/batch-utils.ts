import type { PhotoIntegration } from './types';
import type { BatchItem } from './batch-types';

export const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

export function normalizeIntegrationFilterKey(value: string): string {
  return value.trim().toLowerCase();
}

/** An i18n key + interpolation params describing a WCS-companion read failure. */
export interface WcsErrorInfo {
  key: string;
  params: Record<string, string>;
}

/**
 * Map a failed `solveWCS` result to the same rich, specific message the single-photo
 * add modal used (so no error is lost in the unified flow):
 *  - `NO_WCS_DATA`        → full "not plate-solved, run Siril/PixInsight…" message
 *  - `UNSUPPORTED_FORMAT` → parse error with the format detail
 *  - anything else        → generic parse error with whatever detail is available
 *
 * Returns an i18n key + params so it stays pure/testable; the caller resolves it via `t()`.
 */
export function wcsErrorMessage(
  result: { code?: string; error?: string },
  filename: string,
): WcsErrorInfo {
  const code = result.code;
  if (code === 'NO_WCS_DATA') {
    return { key: 'modal.wcsNoMetadata', params: { filename } };
  }
  if (code === 'UNSUPPORTED_FORMAT') {
    return { key: 'modal.wcsParseError', params: { filename, detail: result.error || code } };
  }
  return { key: 'modal.wcsParseError', params: { filename, detail: result.error || code || 'unknown error' } };
}

export function sanitizeIntegrationRows(rows: PhotoIntegration[]): PhotoIntegration[] {
  return rows.map(row => ({
    frames: Number.isInteger(Number(row.frames)) && Number(row.frames) >= 0 ? Number(row.frames) : 0,
    seconds: Number.isInteger(Number(row.seconds)) && Number(row.seconds) >= 0 ? Number(row.seconds) : 0,
    filter: row.filter.trim(),
  }));
}

/**
 * Revert a batch item to its pre-WCS state: drop the plate-solve solution and the
 * metadata the WCS pre-filled (DSOs, observation date, integrations). Resetting the
 * status to 'pending' removes the item from the solved count / "Place all" gate.
 * Non-WCS fields (labels, customName, notes, file) are left untouched.
 */
export function clearWcsSolution(item: BatchItem): void {
  item.wcsResult = null;
  item.solveCorrespondences = null;
  if (item.status === 'success' || item.status === 'wcs-ready') {
    item.status = 'pending';
  }
  item.dsoIds = [];
  item.observationDate = '';
  item.integrations = [];
}
