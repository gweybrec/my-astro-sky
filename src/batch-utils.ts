import type { PhotoIntegration } from './types';
import type { BatchItem } from './batch-types';

export const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

export function normalizeIntegrationFilterKey(value: string): string {
  return value.trim().toLowerCase();
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
