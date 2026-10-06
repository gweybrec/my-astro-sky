import type { ImageCodec } from '../ports/image-codec';
import { decodeFitsToBytes, UnsupportedFitsError } from './fits-decoder';
import { decodeTiffToBytes, UnsupportedTiffError } from './tiff-decoder';

export { UnsupportedTiffError, UnsupportedFitsError };

export class UnsupportedRawFormatError extends Error {}

export interface DecodedRaw {
  png: Uint8Array;
  width: number;
  height: number;
  channels: 1 | 3;
}

/**
 * Decode a raw astro image file (TIFF or FITS) into an 8-bit PNG, faithfully — a straight
 * linear mapping of the source data to [0,255], never a histogram stretch. The image codec is
 * used only as the PNG *encoder*: `sharp` silently misdecodes 32-bit float TIFF/FITS pixel data
 * (verified — every sharp read path collapses linear-light float samples toward black), so
 * decoding is entirely our own code in `tiff-decoder.ts`/`fits-decoder.ts`.
 */
export async function decodeRawAstroImage(
  bytes: Uint8Array,
  ext: string,
  images: ImageCodec,
): Promise<DecodedRaw> {
  const normalizedExt = ext.toLowerCase();
  let decoded: { width: number; height: number; channels: 1 | 3; data: Uint8Array };

  if (normalizedExt === '.tif' || normalizedExt === '.tiff') {
    decoded = decodeTiffToBytes(bytes);
  } else if (normalizedExt === '.fit' || normalizedExt === '.fits') {
    decoded = decodeFitsToBytes(bytes);
  } else {
    throw new UnsupportedRawFormatError(`Unsupported raw astro image extension: ${ext}`);
  }

  const png = await images.encode(decoded, 'png');
  return { png, width: decoded.width, height: decoded.height, channels: decoded.channels };
}
