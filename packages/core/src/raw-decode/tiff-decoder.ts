import { unzlibSync } from 'fflate';
import { parseTiffHeader, fieldValue, fieldValues, type TiffIfd } from './tiff-ifd';
import { lzwDecode } from './codec/lzw';
import { packBitsDecode } from './codec/packbits';
import { applyHorizontalPredictor } from './codec/predictor';
import { toByte } from './linear-map';

export class UnsupportedTiffError extends Error {}

export interface DecodedTiff {
  width: number;
  height: number;
  channels: 1 | 3;
  /** 8-bit, faithfully linear-mapped, row-major, interleaved per pixel. */
  data: Uint8Array;
}

const COMPRESSION_NONE = 1;
const COMPRESSION_LZW = 5;
const COMPRESSION_DEFLATE_OLD = 32946;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_PACKBITS = 32773;

function decompressStrip(raw: Uint8Array, compression: number, expectedLength: number): Uint8Array {
  switch (compression) {
    case COMPRESSION_NONE:
      return raw.subarray(0, expectedLength);
    case COMPRESSION_LZW: {
      const out = new Uint8Array(expectedLength);
      lzwDecode(raw, out);
      return out;
    }
    case COMPRESSION_PACKBITS: {
      const out = new Uint8Array(expectedLength);
      packBitsDecode(raw, out);
      return out;
    }
    case COMPRESSION_DEFLATE:
    case COMPRESSION_DEFLATE_OLD: {
      const inflated = unzlibSync(raw);
      return inflated.subarray(0, expectedLength);
    }
    default:
      throw new UnsupportedTiffError(`Unsupported TIFF compression: ${compression}`);
  }
}

/** Read one sample at `byteOffset` into `buf`, returning a value normalised to ~[0,1]. */
function readSample(
  view: DataView,
  byteOffset: number,
  bitsPerSample: number,
  isFloat: boolean,
  littleEndian: boolean,
): number {
  if (isFloat) {
    return view.getFloat32(byteOffset, littleEndian);
  }
  switch (bitsPerSample) {
    case 8:
      return view.getUint8(byteOffset) / 255;
    case 16:
      return view.getUint16(byteOffset, littleEndian) / 65535;
    case 32:
      return view.getUint32(byteOffset, littleEndian) / 4294967295;
    default:
      throw new UnsupportedTiffError(`Unsupported bits-per-sample: ${bitsPerSample}`);
  }
}

/**
 * Decode a TIFF's pixel data into an 8-bit, faithfully-mapped RGB or mono buffer.
 * Supports uncompressed / LZW / PackBits / Deflate, chunky or planar strips (no tiles —
 * none of the source raw files in scope use tiled TIFF), Predictor 1/2, 8/16/32-bit
 * unsigned integer or 32-bit float samples. Rejects everything else with
 * `UnsupportedTiffError` rather than silently misinterpreting the data.
 */
export function decodeTiffToBytes(buf: Uint8Array): DecodedTiff {
  const header = parseTiffHeader(buf);
  const ifd: TiffIfd = header.ifds[0];
  if (!ifd) throw new UnsupportedTiffError('TIFF file has no image directory');

  const width = fieldValue(ifd, 256);
  const height = fieldValue(ifd, 257);
  if (!width || !height) throw new UnsupportedTiffError('TIFF missing ImageWidth/ImageLength');

  const bitsPerSampleArr = fieldValues(ifd, 258) ?? [1];
  const bitsPerSample = bitsPerSampleArr[0];
  if (!bitsPerSampleArr.every((b) => b === bitsPerSample)) {
    throw new UnsupportedTiffError('Mixed bits-per-sample across channels is not supported');
  }
  if (bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 32) {
    throw new UnsupportedTiffError(`Unsupported bits-per-sample: ${bitsPerSample}`);
  }

  const sampleFormatArr = fieldValues(ifd, 339) ?? [1];
  const sampleFormat = sampleFormatArr[0];
  if (!sampleFormatArr.every((f) => f === sampleFormat)) {
    throw new UnsupportedTiffError('Mixed sample formats across channels is not supported');
  }
  if (sampleFormat !== 1 && sampleFormat !== 3) {
    throw new UnsupportedTiffError(`Unsupported sample format: ${sampleFormat}`);
  }
  const isFloat = sampleFormat === 3;
  if (isFloat && bitsPerSample !== 32) {
    throw new UnsupportedTiffError('Only 32-bit float samples are supported');
  }

  const samplesPerPixel = fieldValue(ifd, 277) ?? 1;
  const photometric = fieldValue(ifd, 262) ?? 1;
  if (photometric !== 0 && photometric !== 1 && photometric !== 2) {
    throw new UnsupportedTiffError(`Unsupported photometric interpretation: ${photometric}`);
  }
  const outChannels: 1 | 3 = photometric === 2 ? 3 : 1;
  if (samplesPerPixel < outChannels) {
    throw new UnsupportedTiffError('SamplesPerPixel is smaller than required by Photometric');
  }
  const invert = photometric === 0; // WhiteIsZero

  const compression = fieldValue(ifd, 259) ?? COMPRESSION_NONE;
  const predictor = fieldValue(ifd, 317) ?? 1;
  if (predictor !== 1 && predictor !== 2) {
    throw new UnsupportedTiffError(`Unsupported predictor: ${predictor}`);
  }
  const planarConfig = fieldValue(ifd, 284) ?? 1;

  if (fieldValue(ifd, 322) !== undefined) {
    throw new UnsupportedTiffError('Tiled TIFF is not supported');
  }

  const stripOffsets = fieldValues(ifd, 273);
  const stripByteCounts = fieldValues(ifd, 279);
  if (!stripOffsets || !stripByteCounts || stripOffsets.length !== stripByteCounts.length) {
    throw new UnsupportedTiffError('TIFF missing strip offsets/byte counts');
  }

  const bytesPerSample = bitsPerSample / 8;
  const out = new Uint8Array(width * height * outChannels);

  // Number of strips actually present drives row distribution — RowsPerStrip in the
  // header is sometimes wrong in real files, but the strip count itself is reliable.
  const numStrips = stripOffsets.length;

  const readRow = (
    rowBytes: Uint8Array,
    row: number,
    planarChannel: number | null, // null = chunky (all channels in this row); else which channel
  ): void => {
    const view = new DataView(rowBytes.buffer, rowBytes.byteOffset, rowBytes.byteLength);
    const rowSamplesPerPixel = planarChannel === null ? samplesPerPixel : 1;
    if (predictor === 2) {
      applyHorizontalPredictor(
        rowBytes,
        width,
        rowSamplesPerPixel,
        bitsPerSample,
        header.littleEndian,
      );
    }
    for (let x = 0; x < width; x++) {
      const outBase = (row * width + x) * outChannels;
      if (planarChannel === null) {
        for (let c = 0; c < outChannels; c++) {
          const byteOffset = (x * samplesPerPixel + c) * bytesPerSample;
          let v = readSample(view, byteOffset, bitsPerSample, isFloat, header.littleEndian);
          if (invert) v = 1 - v;
          out[outBase + c] = toByte(v);
        }
      } else {
        const byteOffset = x * bytesPerSample;
        let v = readSample(view, byteOffset, bitsPerSample, isFloat, header.littleEndian);
        if (invert) v = 1 - v;
        out[outBase + planarChannel] = toByte(v);
      }
    }
  };

  if (planarConfig === 1) {
    // Chunky: strips cover consecutive rows, each row holding all channels interleaved.
    const rowsPerStrip = Math.ceil(height / numStrips);
    const rowByteLen = width * samplesPerPixel * bytesPerSample;
    let row = 0;
    for (let s = 0; s < numStrips && row < height; s++) {
      const rowsInStrip = Math.min(rowsPerStrip, height - row);
      const expected = rowsInStrip * rowByteLen;
      const raw = buf.subarray(stripOffsets[s], stripOffsets[s] + stripByteCounts[s]);
      const decompressed = decompressStrip(raw, compression, expected);
      for (let r = 0; r < rowsInStrip; r++) {
        const rowBytes = decompressed.subarray(r * rowByteLen, (r + 1) * rowByteLen);
        readRow(rowBytes, row + r, null);
      }
      row += rowsInStrip;
    }
  } else {
    // Planar: strips are grouped per channel plane, each plane holding one sample/pixel.
    if (numStrips % samplesPerPixel !== 0) {
      throw new UnsupportedTiffError(
        'Planar TIFF strip count is not a multiple of SamplesPerPixel',
      );
    }
    const stripsPerPlane = numStrips / samplesPerPixel;
    const rowsPerStrip = Math.ceil(height / stripsPerPlane);
    const rowByteLen = width * bytesPerSample;
    for (let plane = 0; plane < outChannels; plane++) {
      let row = 0;
      for (let s = 0; s < stripsPerPlane && row < height; s++) {
        const idx = plane * stripsPerPlane + s;
        const rowsInStrip = Math.min(rowsPerStrip, height - row);
        const expected = rowsInStrip * rowByteLen;
        const raw = buf.subarray(stripOffsets[idx], stripOffsets[idx] + stripByteCounts[idx]);
        const decompressed = decompressStrip(raw, compression, expected);
        for (let r = 0; r < rowsInStrip; r++) {
          const rowBytes = decompressed.subarray(r * rowByteLen, (r + 1) * rowByteLen);
          readRow(rowBytes, row + r, plane);
        }
        row += rowsInStrip;
      }
    }
  }

  return { width, height, channels: outChannels, data: out };
}
