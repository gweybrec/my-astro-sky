import sharp from 'sharp';
import { decodeTiffToBytes, UnsupportedTiffError } from './tiff-decoder';
import { decodeFitsToBytes, UnsupportedFitsError } from './fits-decoder';

export { UnsupportedTiffError, UnsupportedFitsError };

export class UnsupportedRawFormatError extends Error {}

export interface DecodedRaw {
  png: Buffer;
  width: number;
  height: number;
  channels: 1 | 3;
}

/**
 * Decode a raw astro image file (TIFF or FITS) into an 8-bit PNG, faithfully — a straight
 * linear mapping of the source data to [0,255], never a histogram stretch. `sharp` is used
 * here only as the PNG *encoder*: it silently misdecodes 32-bit float TIFF/FITS pixel data
 * (verified — every sharp read path collapses linear-light float samples toward black), so
 * decoding is entirely our own code in `tiff-decoder.ts`/`fits-decoder.ts`.
 */
export async function decodeRawAstroImage(buffer: Buffer, ext: string): Promise<DecodedRaw> {
  const normalizedExt = ext.toLowerCase();
  let decoded: { width: number; height: number; channels: 1 | 3; data: Uint8Array };

  if (normalizedExt === '.tif' || normalizedExt === '.tiff') {
    decoded = decodeTiffToBytes(buffer);
  } else if (normalizedExt === '.fit' || normalizedExt === '.fits') {
    decoded = decodeFitsToBytes(buffer);
  } else {
    throw new UnsupportedRawFormatError(`Unsupported raw astro image extension: ${ext}`);
  }

  let encoder = sharp(decoded.data, {
    raw: { width: decoded.width, height: decoded.height, channels: decoded.channels },
  });
  // Without this, sharp upsamples a single-channel raw buffer to an RGB PNG on encode.
  if (decoded.channels === 1) encoder = encoder.toColourspace('b-w');
  const png = await encoder.png({ compressionLevel: 6 }).toBuffer();

  return { png, width: decoded.width, height: decoded.height, channels: decoded.channels };
}
