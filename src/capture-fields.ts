import type { CaptureDetails } from './types';

/**
 * Catalog of the optional per-photo "capture detail" fields the app can parse from
 * FITS/TIFF headers and let the user edit manually. Field ids MUST match the server
 * extraction map (`CAPTURE_FITS_MAP` in `server/wcs-reader.ts`) — a unit test asserts
 * the two id sets are identical to prevent drift.
 *
 * Rendering: a field's row is shown only when its id is present in a photo's
 * `captureDetails`; absent fields stay hidden. The "add field" picker offers the
 * fields not yet present, in this order.
 */
export interface CaptureFieldDef {
  id: string;
  /** i18n key under the `modal.*` namespace for the field label. */
  labelKey: string;
  /** Unit suffix shown after the input (empty when unitless). */
  unit: string;
  type: 'number' | 'text';
}

// Only genuinely per-capture / per-session settings live here. Gear-derived values
// (focal length, f-ratio, aperture, pixel size, bayer pattern) are intentionally
// excluded — they come from the linked gear setup, not the photo.
export const CAPTURE_FIELDS: CaptureFieldDef[] = [
  { id: 'gain', labelKey: 'modal.metadataCaptureGain', unit: '', type: 'number' },
  { id: 'offset', labelKey: 'modal.metadataCaptureOffset', unit: '', type: 'number' },
  { id: 'iso', labelKey: 'modal.metadataCaptureIso', unit: '', type: 'number' },
  { id: 'ccdTemp', labelKey: 'modal.metadataCaptureCcdTemp', unit: '°C', type: 'number' },
  { id: 'setTemp', labelKey: 'modal.metadataCaptureSetTemp', unit: '°C', type: 'number' },
  { id: 'binning', labelKey: 'modal.metadataCaptureBinning', unit: '', type: 'text' },
];

const CAPTURE_FIELD_BY_ID = new Map(CAPTURE_FIELDS.map((f) => [f.id, f]));

export function getCaptureField(id: string): CaptureFieldDef | undefined {
  return CAPTURE_FIELD_BY_ID.get(id);
}

/**
 * Keep only known fields with usable values (finite numbers, non-empty trimmed
 * strings), preserving the catalog order. Mirrors the server sanitizer so the
 * client never persists junk; the server re-sanitizes on write regardless.
 */
export function sanitizeCaptureDetails(obj: unknown): CaptureDetails {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const src = obj as Record<string, unknown>;
  const out: CaptureDetails = {};
  for (const f of CAPTURE_FIELDS) {
    const raw = src[f.id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (f.type === 'number') {
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(num)) out[f.id] = num;
    } else {
      const str = String(raw).trim().slice(0, 64);
      if (str.length > 0) out[f.id] = str;
    }
  }
  return out;
}
