/**
 * Minimal hand-rolled TIFF (classic, 32-bit offset) file builder for decoder tests.
 * Not a general encoder — just enough to exercise `server/raw-decode/tiff-decoder.ts`
 * against known pixel data. Not a `.test.ts` file, so vitest's `include` glob does not
 * collect it as a test suite (see `vitest.config.ts`).
 */

export type SampleFormat = 1 | 3; // 1 = unsigned int, 3 = float
export type Compression = 1 | 32773; // none, PackBits — enough to exercise the decompress path

export interface BuildTiffOptions {
  width: number;
  height: number;
  bitsPerSample: 8 | 16 | 32;
  sampleFormat: SampleFormat;
  samplesPerPixel: 1 | 3;
  photometric: 0 | 1 | 2; // WhiteIsZero, BlackIsZero, RGB
  compression?: Compression;
  predictor?: 1 | 2;
  planarConfig?: 1 | 2; // chunky, planar
  littleEndian?: boolean;
  rowsPerStrip?: number; // default: whole image in one strip
  tiled?: boolean; // when true, writes bogus TileWidth/TileLength tags to test rejection
  /**
   * Pixel samples in chunky row-major order regardless of `planarConfig`
   * (length = width * height * samplesPerPixel), in the *physical* units implied by
   * `bitsPerSample`/`sampleFormat` (e.g. 0..65535 for 16-bit unsigned, 0..1 for float).
   */
  pixels: number[];
}

interface IfdEntryInput {
  tag: number;
  type: number;
  count: number;
  bytes: Buffer; // exactly type-size * count bytes, native byte order already applied
}

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

function packBitsEncodeLiteral(bytes: Buffer): Buffer {
  // Trivial forward PackBits encoder: literal-only runs, chunks of <=128 bytes.
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += 128) {
    const chunk = bytes.subarray(i, Math.min(i + 128, bytes.length));
    chunks.push(Buffer.from([chunk.length - 1]), chunk);
  }
  return Buffer.concat(chunks);
}

function applyForwardHorizontalPredictor(
  row: Buffer,
  width: number,
  samplesPerPixel: number,
  bitsPerSample: number,
  littleEndian: boolean,
): void {
  if (bitsPerSample === 8) {
    for (let i = width * samplesPerPixel - 1; i >= samplesPerPixel; i--) {
      row[i] = (row[i] - row[i - samplesPerPixel]) & 0xff;
    }
    return;
  }
  const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
  if (bitsPerSample === 16) {
    for (let i = width * samplesPerPixel - 1; i >= samplesPerPixel; i--) {
      const cur = view.getUint16(i * 2, littleEndian);
      const prev = view.getUint16((i - samplesPerPixel) * 2, littleEndian);
      view.setUint16(i * 2, (cur - prev) & 0xffff, littleEndian);
    }
    return;
  }
  throw new Error(`Predictor fixture unsupported for ${bitsPerSample}-bit`);
}

export function buildTiff(opts: BuildTiffOptions): Buffer {
  const {
    width,
    height,
    bitsPerSample,
    sampleFormat,
    samplesPerPixel,
    photometric,
    compression = 1,
    predictor = 1,
    planarConfig = 1,
    littleEndian = true,
    rowsPerStrip = height,
    tiled = false,
    pixels,
  } = opts;

  const bytesPerSample = bitsPerSample / 8;
  const writeSample = (buf: Buffer, offset: number, value: number): void => {
    if (sampleFormat === 3) {
      if (littleEndian) buf.writeFloatLE(value, offset);
      else buf.writeFloatBE(value, offset);
    } else if (bitsPerSample === 8) {
      buf.writeUInt8(value & 0xff, offset);
    } else if (bitsPerSample === 16) {
      if (littleEndian) buf.writeUInt16LE(value & 0xffff, offset);
      else buf.writeUInt16BE(value & 0xffff, offset);
    } else {
      if (littleEndian) buf.writeUInt32LE(value >>> 0, offset);
      else buf.writeUInt32BE(value >>> 0, offset);
    }
  };

  // Build the full-image raw byte buffer, chunky or planar, then split into strips.
  const planes = planarConfig === 1 ? 1 : samplesPerPixel;
  const rowByteLen =
    planarConfig === 1 ? width * samplesPerPixel * bytesPerSample : width * bytesPerSample;

  const planeBuffers: Buffer[] = [];
  for (let plane = 0; plane < planes; plane++) {
    const planeBuf = Buffer.alloc(rowByteLen * height);
    for (let row = 0; row < height; row++) {
      const rowBuf = planeBuf.subarray(row * rowByteLen, (row + 1) * rowByteLen);
      if (planarConfig === 1) {
        for (let x = 0; x < width; x++) {
          for (let c = 0; c < samplesPerPixel; c++) {
            const srcIdx = (row * width + x) * samplesPerPixel + c;
            writeSample(rowBuf, (x * samplesPerPixel + c) * bytesPerSample, pixels[srcIdx]);
          }
        }
      } else {
        for (let x = 0; x < width; x++) {
          const srcIdx = (row * width + x) * samplesPerPixel + plane;
          writeSample(rowBuf, x * bytesPerSample, pixels[srcIdx]);
        }
      }
      if (predictor === 2) {
        applyForwardHorizontalPredictor(
          rowBuf,
          width,
          planarConfig === 1 ? samplesPerPixel : 1,
          bitsPerSample,
          littleEndian,
        );
      }
    }
    planeBuffers.push(planeBuf);
  }

  // Split each plane into strips of `rowsPerStrip` rows, compress each strip.
  const stripBuffers: Buffer[] = [];
  const stripByteCounts: number[] = [];
  for (const planeBuf of planeBuffers) {
    for (let row = 0; row < height; row += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, height - row);
      const raw = planeBuf.subarray(row * rowByteLen, (row + rows) * rowByteLen);
      const compressed = compression === 32773 ? packBitsEncodeLiteral(raw) : Buffer.from(raw);
      stripBuffers.push(compressed);
      stripByteCounts.push(compressed.length);
    }
  }

  // ─── Assemble the TIFF container ─────────────────────────────────────────────
  const HEADER_SIZE = 8;
  let offset = HEADER_SIZE;
  const stripOffsets: number[] = [];
  for (const s of stripBuffers) {
    stripOffsets.push(offset);
    offset += s.length;
  }
  const ifdOffset = offset;

  const entries: IfdEntryInput[] = [];
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    if (littleEndian) b.writeUInt16LE(v);
    else b.writeUInt16BE(v);
    return b;
  };
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    if (littleEndian) b.writeUInt32LE(v);
    else b.writeUInt32BE(v);
    return b;
  };
  const u16arr = (vs: number[]) => Buffer.concat(vs.map(u16));
  const u32arr = (vs: number[]) => Buffer.concat(vs.map(u32));

  entries.push({ tag: 256, type: TYPE_LONG, count: 1, bytes: u32(width) });
  entries.push({ tag: 257, type: TYPE_LONG, count: 1, bytes: u32(height) });
  entries.push({
    tag: 258,
    type: TYPE_SHORT,
    count: samplesPerPixel,
    bytes: u16arr(Array(samplesPerPixel).fill(bitsPerSample)),
  });
  entries.push({ tag: 259, type: TYPE_SHORT, count: 1, bytes: u16(compression) });
  entries.push({ tag: 262, type: TYPE_SHORT, count: 1, bytes: u16(photometric) });
  if (!tiled) {
    entries.push({ tag: 273, type: TYPE_LONG, count: stripOffsets.length, bytes: u32arr(stripOffsets) });
  } else {
    entries.push({ tag: 322, type: TYPE_LONG, count: 1, bytes: u32(16) });
    entries.push({ tag: 323, type: TYPE_LONG, count: 1, bytes: u32(16) });
  }
  entries.push({ tag: 277, type: TYPE_SHORT, count: 1, bytes: u16(samplesPerPixel) });
  entries.push({ tag: 278, type: TYPE_LONG, count: 1, bytes: u32(rowsPerStrip) });
  if (!tiled) {
    entries.push({
      tag: 279,
      type: TYPE_LONG,
      count: stripByteCounts.length,
      bytes: u32arr(stripByteCounts),
    });
  }
  entries.push({ tag: 284, type: TYPE_SHORT, count: 1, bytes: u16(planarConfig) });
  entries.push({ tag: 317, type: TYPE_SHORT, count: 1, bytes: u16(predictor) });
  entries.push({
    tag: 339,
    type: TYPE_SHORT,
    count: samplesPerPixel,
    bytes: u16arr(Array(samplesPerPixel).fill(sampleFormat)),
  });
  entries.sort((a, b) => a.tag - b.tag);

  // Compute the layout of the IFD: fixed 12-byte entries, external data appended after.
  const ifdFixedSize = 2 + entries.length * 12 + 4;
  let externalOffset = ifdOffset + ifdFixedSize;
  const ifdEntryBytes: Buffer[] = [];
  const externalChunks: Buffer[] = [];
  for (const e of entries) {
    const entry = Buffer.alloc(12);
    if (littleEndian) entry.writeUInt16LE(e.tag, 0);
    else entry.writeUInt16BE(e.tag, 0);
    if (littleEndian) entry.writeUInt16LE(e.type, 2);
    else entry.writeUInt16BE(e.type, 2);
    if (littleEndian) entry.writeUInt32LE(e.count, 4);
    else entry.writeUInt32BE(e.count, 4);
    if (e.bytes.length <= 4) {
      e.bytes.copy(entry, 8);
    } else {
      if (littleEndian) entry.writeUInt32LE(externalOffset, 8);
      else entry.writeUInt32BE(externalOffset, 8);
      externalChunks.push(e.bytes);
      externalOffset += e.bytes.length;
    }
    ifdEntryBytes.push(entry);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.write(littleEndian ? 'II' : 'MM', 0, 'ascii');
  if (littleEndian) header.writeUInt16LE(42, 2);
  else header.writeUInt16BE(42, 2);
  if (littleEndian) header.writeUInt32LE(ifdOffset, 4);
  else header.writeUInt32BE(ifdOffset, 4);

  const ifdHeader = u16(entries.length);
  const ifdNext = u32(0); // no next IFD

  return Buffer.concat([
    header,
    ...stripBuffers,
    ifdHeader,
    ...ifdEntryBytes,
    ifdNext,
    ...externalChunks,
  ]);
}

