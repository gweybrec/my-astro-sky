import { parseFITSHeader, extractFITSHeaderFromFITS } from '../wcs-reader';
import { toByte } from './linear-map';

export class UnsupportedFitsError extends Error {}

export interface DecodedFits {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

/** Full-scale divisor bringing an integer BITPIX's physical value range to ~[0,1]. */
function integerFullScale(bitpix: number): number {
  switch (bitpix) {
    case 8:
      return 255;
    case 16:
      return 65535;
    case 32:
      return 4294967295;
    default:
      throw new UnsupportedFitsError(`Unsupported BITPIX: ${bitpix}`);
  }
}

/**
 * Decode a FITS primary HDU's pixel data into an 8-bit, faithfully-mapped mono or RGB
 * buffer. Supports BITPIX 8/16/32 (unsigned via BZERO/BSCALE) and -32/-64 (float/double,
 * expected already normalised to [0,1] per the Siril/NINA/ASIAIR convention this project
 * targets). NAXIS=2 (mono) and NAXIS=3 with NAXIS3=3 (plane-major RGB cube) are supported;
 * anything else (e.g. an undebayered CFA frame, which has no third axis at all) is rejected.
 *
 * Reads reuse `parseFITSHeader`/`extractFITSHeaderFromFITS` from `wcs-reader.ts` so header
 * parsing stays in one place; this module adds only the data-unit decode.
 */
export function decodeFitsToBytes(buf: Buffer): DecodedFits {
  const headerStr = extractFITSHeaderFromFITS(buf);
  const header = parseFITSHeader(headerStr);

  const bitpix = Number(header.BITPIX);
  const naxis = Number(header.NAXIS);
  const width = Number(header.NAXIS1);
  const height = Number(header.NAXIS2);
  if (!width || !height) throw new UnsupportedFitsError('FITS missing NAXIS1/NAXIS2');

  let channels: 1 | 3;
  if (naxis === 2) {
    channels = 1;
  } else if (naxis === 3 && Number(header.NAXIS3) === 3) {
    channels = 3;
  } else {
    throw new UnsupportedFitsError(
      `Unsupported FITS axis layout: NAXIS=${naxis}${naxis === 3 ? `, NAXIS3=${header.NAXIS3}` : ''}`,
    );
  }

  const bzero = header.BZERO !== undefined ? Number(header.BZERO) : 0;
  const bscale = header.BSCALE !== undefined ? Number(header.BSCALE) : 1;
  const isFloat = bitpix === -32 || bitpix === -64;
  const fullScale = isFloat ? 1 : integerFullScale(bitpix);

  // Default FITS convention stores the data unit bottom row first; honour an explicit
  // ROWORDER when present (Siril writes it explicitly either way).
  const rowOrder = typeof header.ROWORDER === 'string' ? header.ROWORDER.trim().toUpperCase() : '';
  const flipY = rowOrder !== 'TOP-DOWN';

  const bytesPerSample = Math.abs(bitpix) / 8;
  const dataOffset = headerStr.length; // extractFITSHeaderFromFITS already pads to the 2880 boundary
  const samplesPerPlane = width * height;
  const totalSamples = samplesPerPlane * channels;
  const availableBytes = buf.length - dataOffset;
  if (availableBytes < totalSamples * bytesPerSample) {
    throw new UnsupportedFitsError('FITS data unit is shorter than NAXIS1*NAXIS2*NAXIS3 implies');
  }

  // Bounded read: exactly totalSamples values, never touching the padding after the data
  // unit — real files pad with garbage (values up to ~1e34 have been observed) that must
  // never leak into pixel output.
  const dataView = new DataView(
    buf.buffer,
    buf.byteOffset + dataOffset,
    totalSamples * bytesPerSample,
  );

  const readRaw = (sampleIndex: number): number => {
    const off = sampleIndex * bytesPerSample;
    switch (bitpix) {
      case 8:
        return dataView.getUint8(off);
      case 16:
        return dataView.getInt16(off, false);
      case 32:
        return dataView.getInt32(off, false);
      case -32:
        return dataView.getFloat32(off, false);
      case -64:
        return dataView.getFloat64(off, false);
      default:
        throw new UnsupportedFitsError(`Unsupported BITPIX: ${bitpix}`);
    }
  };

  const out = new Uint8Array(samplesPerPlane * channels);
  for (let plane = 0; plane < channels; plane++) {
    for (let row = 0; row < height; row++) {
      const outRow = flipY ? height - 1 - row : row;
      for (let x = 0; x < width; x++) {
        const sampleIndex = plane * samplesPerPlane + row * width + x;
        const raw = readRaw(sampleIndex);
        let v = (bzero + bscale * raw) / fullScale;
        if (!Number.isFinite(v)) v = 0;
        const outIndex = (outRow * width + x) * channels + plane;
        out[outIndex] = toByte(v);
      }
    }
  }

  return { width, height, channels, data: out };
}
