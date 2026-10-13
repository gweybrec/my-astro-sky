import { unzlibSync } from 'fflate';
import { toByte } from './linear-map';
import { parseXisfHeader, UnsupportedXisfError, type XisfImageInfo } from './xisf';

export interface DecodedXisf {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

interface SampleFormat {
  bytes: number;
  float: boolean;
  /** Divisor bringing an unsigned integer sample to [0,1]. */
  fullScale: number;
}

function sampleFormatOf(name: string): SampleFormat {
  switch (name) {
    case 'UInt8':
      return { bytes: 1, float: false, fullScale: 255 };
    case 'UInt16':
      return { bytes: 2, float: false, fullScale: 65535 };
    case 'UInt32':
      return { bytes: 4, float: false, fullScale: 4294967295 };
    case 'Float32':
      return { bytes: 4, float: true, fullScale: 1 };
    case 'Float64':
      return { bytes: 8, float: true, fullScale: 1 };
    default:
      throw new UnsupportedXisfError(`Unsupported XISF sample format: ${name}`);
  }
}

/** The `lower:upper` range of floating-point samples; [0,1] when the attribute is absent. */
function boundsOf(raw: string | undefined): { lower: number; upper: number } {
  if (!raw) return { lower: 0, upper: 1 };
  const [lower, upper] = raw.split(':').map(Number);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    throw new UnsupportedXisfError(`Unsupported XISF bounds: ${raw}`);
  }
  return { lower, upper };
}

/** Undoes XISF byte shuffling: byte `j` of item `i` is stored at `j * items + i`; a tail shorter than an item is copied. */
function unshuffle(src: Uint8Array, itemSize: number): Uint8Array {
  const items = Math.floor(src.length / itemSize);
  const out = new Uint8Array(src.length);
  for (let j = 0; j < itemSize; j++) {
    const plane = j * items;
    for (let i = 0; i < items; i++) out[i * itemSize + j] = src[plane + i];
  }
  out.set(src.subarray(items * itemSize), items * itemSize);
  return out;
}

/** The block's bytes as stored samples: decompressed and unshuffled as its `compression` attribute says. */
function readBlock(block: Uint8Array, compression: string | undefined): Uint8Array {
  if (!compression) return block;
  const [codecSpec, sizeText, itemSizeText] = compression.split(':');
  const shuffled = codecSpec.endsWith('+sh');
  const codec = shuffled ? codecSpec.slice(0, -3) : codecSpec;
  if (codec !== 'zlib') {
    throw new UnsupportedXisfError(`Unsupported XISF compression: ${codec}`);
  }
  const size = Number(sizeText);
  if (!Number.isInteger(size) || size <= 0) {
    throw new UnsupportedXisfError(`Malformed XISF compression: ${compression}`);
  }
  let data: Uint8Array;
  try {
    data = unzlibSync(block, { out: new Uint8Array(size) });
  } catch {
    throw new UnsupportedXisfError('XISF pixel block could not be decompressed');
  }
  if (!shuffled) return data;
  const itemSize = Number(itemSizeText);
  if (!Number.isInteger(itemSize) || itemSize <= 0) {
    throw new UnsupportedXisfError(`Malformed XISF compression: ${compression}`);
  }
  return unshuffle(data, itemSize);
}

function channelsOf(image: XisfImageInfo): 1 | 3 {
  if (image.channels === 1) return 1;
  // An RGB image may carry extra (alpha) channels after the three colours; they are not drawn.
  if (image.channels >= 3 && (image.colorSpace ?? 'RGB') === 'RGB') return 3;
  throw new UnsupportedXisfError(
    `Unsupported XISF channel layout: ${image.channels} channels, ${image.colorSpace ?? 'no colour space'}`,
  );
}

/**
 * Decode the first image of an XISF monolithic file into an 8-bit, faithfully-mapped mono or
 * RGB buffer. Supports unsigned integer samples of 8, 16 and 32 bits and floating-point
 * samples of 32 and 64 bits (mapped from their `bounds`, [0,1] by default), planar and
 * interleaved pixel storage, either byte order, and pixel blocks stored as an attachment,
 * uncompressed or zlib-compressed with or without byte shuffling. Rows are stored top first,
 * so nothing is flipped. Other codecs (lz4, zstd) and inline or embedded blocks are rejected.
 */
export function decodeXisfToBytes(buf: Uint8Array): DecodedXisf {
  const { image } = parseXisfHeader(buf);
  if (!image) throw new UnsupportedXisfError('XISF file has no image');

  const { location } = image;
  if (location.kind !== 'attachment' || location.position === undefined || !location.size) {
    throw new UnsupportedXisfError(`Unsupported XISF pixel location: ${location.kind}`);
  }
  if (location.position + location.size > buf.length) {
    throw new UnsupportedXisfError('XISF pixel block exceeds file size');
  }

  const { width, height } = image;
  const channels = channelsOf(image);
  const format = sampleFormatOf(image.sampleFormat);
  const { lower, upper } = format.float ? boundsOf(image.bounds) : { lower: 0, upper: 1 };
  const littleEndian = image.byteOrder !== 'big';
  const interleaved = image.pixelStorage === 'Normal';

  const samples = readBlock(
    buf.subarray(location.position, location.position + location.size),
    image.compression,
  );
  const samplesPerPlane = width * height;
  if (samples.length < samplesPerPlane * image.channels * format.bytes) {
    throw new UnsupportedXisfError('XISF pixel block is shorter than the image geometry implies');
  }
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);

  const readRaw = (sampleIndex: number): number => {
    const off = sampleIndex * format.bytes;
    switch (image.sampleFormat) {
      case 'UInt8':
        return view.getUint8(off);
      case 'UInt16':
        return view.getUint16(off, littleEndian);
      case 'UInt32':
        return view.getUint32(off, littleEndian);
      case 'Float32':
        return view.getFloat32(off, littleEndian);
      default:
        return view.getFloat64(off, littleEndian);
    }
  };

  const out = new Uint8Array(samplesPerPlane * channels);
  for (let plane = 0; plane < channels; plane++) {
    for (let pixel = 0; pixel < samplesPerPlane; pixel++) {
      const sampleIndex = interleaved
        ? pixel * image.channels + plane
        : plane * samplesPerPlane + pixel;
      const raw = readRaw(sampleIndex);
      const v = format.float ? (raw - lower) / (upper - lower) : raw / format.fullScale;
      out[pixel * channels + plane] = toByte(v);
    }
  }

  return { width, height, channels, data: out };
}
