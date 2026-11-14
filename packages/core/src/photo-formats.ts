/**
 * Photo import file formats. `.fit`/`.fits` have no registered MIME type, so `accept`
 * strings must list extensions, not only MIME types, for the raw astro formats to be
 * offered in the browser's file picker.
 */

/** Directly viewable formats a browser can render (no server-side conversion needed). */
export const RASTER_PHOTO_EXT_RE = /\.(jpe?g|png|webp)$/i;

/** Raw astro formats that must be converted server-side before they can be previewed. */
export const RAW_ASTRO_EXT_RE = /\.(tiff?|fits?|xisf)$/i;

/** Either family — what the main photo picker accepts. */
export const ANY_PHOTO_EXT_RE = /\.(jpe?g|png|webp|tiff?|fits?|xisf)$/i;

export const PHOTO_PICKER_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg,.tif,.tiff,.fit,.fits,.xisf';

/** Accept string for the WCS/metadata *companion* file picker (raw formats only). */
export const RAW_COMPANION_ACCEPT = '.fit,.fits,.tif,.tiff,.xisf';

export function isRawAstroFile(name: string): boolean {
  return RAW_ASTRO_EXT_RE.test(name);
}

/** A FITS file (`.fit`, `.fits`). */
export function isFitsFile(name: string): boolean {
  return /\.fits?$/i.test(name);
}

/** The plate solvers a photo can be sent to. */
export type SolveEngine = 'astrometry' | 'astap' | 'solve-field';

/**
 * The file to send to a plate solver: the original raw file when that engine reads its format, else the
 * converted PNG. astrometry.net and ASTAP read FITS only (a TIFF or XISF goes as its PNG); solve-field reads
 * FITS and TIFF (an XISF goes as its PNG).
 */
export function solveInputFile<T extends { name: string }>(
  engine: SolveEngine,
  rawFile: T | null | undefined,
  converted: T,
): T {
  if (!rawFile) return converted;
  if (isFitsFile(rawFile.name)) return rawFile;
  if (engine === 'solve-field' && /\.tiff?$/i.test(rawFile.name)) return rawFile;
  return converted;
}
