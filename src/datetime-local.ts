/**
 * Conversion helpers between an ISO 8601 UTC timestamp (how dates are stored,
 * e.g. `Photo.observationDate`) and the local-time string format expected by
 * an `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`, no timezone, rendered
 * in the browser's local zone). Shared by `MetadataEditorPanel.vue` and
 * `AsteroidIdentifyModal.vue` so both date inputs behave identically.
 */

/** Formats an ISO 8601 UTC timestamp for a `datetime-local` input's `value`. Empty string when unset/invalid. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a `datetime-local` input's `value` back into an ISO 8601 UTC timestamp. Empty string when the input is empty. */
export function datetimeLocalToIso(value: string): string {
  return value ? new Date(value).toISOString() : '';
}
