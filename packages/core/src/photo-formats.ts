/**
 * Photo import file formats. `.fit`/`.fits` have no registered MIME type, so `accept`
 * strings must list extensions, not only MIME types, for the raw astro formats to be
 * offered in the browser's file picker.
 */

/** Directly viewable formats a browser can render (no server-side conversion needed). */
export const RASTER_PHOTO_EXT_RE = /\.(jpe?g|png|webp)$/i;

/** Raw astro formats that must be converted server-side before they can be previewed. */
export const RAW_ASTRO_EXT_RE = /\.(tiff?|fits?)$/i;

/** Either family — what the main photo picker accepts. */
export const ANY_PHOTO_EXT_RE = /\.(jpe?g|png|webp|tiff?|fits?)$/i;

export const PHOTO_PICKER_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg,.tif,.tiff,.fit,.fits';

/** Accept string for the WCS/metadata *companion* file picker (raw formats only). */
export const RAW_COMPANION_ACCEPT = '.fit,.fits,.tif,.tiff';

export function isRawAstroFile(name: string): boolean {
  return RAW_ASTRO_EXT_RE.test(name);
}
