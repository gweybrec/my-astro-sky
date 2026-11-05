import { t } from './i18n/index';
import { getCaptureField } from './capture-fields';
import { isoToDatetimeLocal } from './datetime-local';
import type { PhotoIntegration } from './types';
import type { WcsChange } from './photo-metadata-draft';

/** An i18n key + interpolation params describing a WCS-companion read failure. */
export interface WcsErrorInfo {
  key: string;
  params: Record<string, string>;
}

/**
 * Map a failed `solveWCS` result to a specific message, the same wherever a solved file is read (adding a photo, the
 * photo's details, desktop and phone):
 *  - `NO_WCS_DATA`        → full "not plate-solved, run Siril/PixInsight…" message
 *  - `UNSUPPORTED_FORMAT` → parse error with the format detail
 *  - anything else        → parse error with whatever detail is available (`error` is already translated by
 *    `api.solveWCS`, e.g. "not enough catalogue stars")
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
  return {
    key: 'modal.wcsParseError',
    params: { filename, detail: result.error || code || 'unknown error' },
  };
}

/** The message for an error thrown while reading a solved file (its own text when it has one). */
export function wcsThrownErrorMessage(error: unknown, filename: string): string {
  const detail = error instanceof Error && error.message ? error.message : 'unknown error';
  return t('modal.wcsParseError', { filename, detail });
}

/** The field a change is for, as the metadata editor names it. */
export function wcsChangeLabel(change: WcsChange): string {
  if (change.key === 'observationDate') return t('modal.metadataObsDate');
  if (change.key === 'integrations') return t('modal.metadataIntegrations');
  const def = getCaptureField(change.field);
  return def ? t(def.labelKey) : change.field;
}

function formatIntegrations(rows: PhotoIntegration[]): string {
  return rows
    .map((row) =>
      [`${row.frames} × ${row.seconds}${t('modal.metadataIntegrationsSecondsSuffix')}`, row.filter]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');
}

function formatValue(change: WcsChange, which: 'current' | 'incoming'): string {
  if (change.key === 'observationDate') {
    return isoToDatetimeLocal(change[which]).replace('T', ' ');
  }
  if (change.key === 'integrations') return formatIntegrations(change[which]);
  const value = change[which];
  if (value === undefined || value === '') return '';
  const unit = getCaptureField(change.field)?.unit;
  return unit ? `${value} ${unit}` : String(value);
}

/** The value the photo has now and the one the file brings, as shown in the list of conflicts. */
export function wcsChangeValues(change: WcsChange): { current: string; incoming: string } {
  return { current: formatValue(change, 'current'), incoming: formatValue(change, 'incoming') };
}
