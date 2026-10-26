import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { UnsupportedXisfError } from '@myastrosky/core/raw-decode/xisf';
import { decodeXisfToBytes } from '@myastrosky/core/raw-decode/xisf-decoder';
import { buildXisf } from '../fixtures/xisf-builders';

/** Little-endian (or big-endian) samples of one format, as a pixel block. */
function block(
  format: 'UInt8' | 'UInt16' | 'UInt32' | 'Float32' | 'Float64',
  values: number[],
  littleEndian = true,
): Uint8Array {
  const bytes = { UInt8: 1, UInt16: 2, UInt32: 4, Float32: 4, Float64: 8 }[format];
  const out = new Uint8Array(values.length * bytes);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => {
    const off = i * bytes;
    if (format === 'UInt8') view.setUint8(off, v);
    else if (format === 'UInt16') view.setUint16(off, v, littleEndian);
    else if (format === 'UInt32') view.setUint32(off, v, littleEndian);
    else if (format === 'Float32') view.setFloat32(off, v, littleEndian);
    else view.setFloat64(off, v, littleEndian);
  });
  return out;
}

/** XISF byte shuffling: all first bytes of the items, then all second bytes, and so on. */
function shuffle(src: Uint8Array, itemSize: number): Uint8Array {
  const items = Math.floor(src.length / itemSize);
  const out = new Uint8Array(src.length);
  for (let j = 0; j < itemSize; j++) {
    for (let i = 0; i < items; i++) out[j * items + i] = src[i * itemSize + j];
  }
  return out;
}

describe('decodeXisfToBytes', () => {
  it('maps unsigned integer samples of 8, 16 and 32 bits over their full range, top row first', () => {
    const cases: Array<['UInt8' | 'UInt16' | 'UInt32', number[]]> = [
      ['UInt8', [0, 51, 128, 255]],
      ['UInt16', [0, 13107, 32768, 65535]],
      ['UInt32', [0, 858993459, 2147483648, 4294967295]],
    ];
    for (const [sampleFormat, values] of cases) {
      const r = decodeXisfToBytes(
        buildXisf({ geometry: '2:2:1', sampleFormat, pixels: block(sampleFormat, values) }),
      );
      expect([r.width, r.height, r.channels]).toEqual([2, 2, 1]);
      expect(Array.from(r.data)).toEqual([0, 51, 128, 255]);
    }
  });

  it('maps floating-point samples from their bounds, [0,1] when none is given', () => {
    const plain = decodeXisfToBytes(
      buildXisf({
        geometry: '4:1:1',
        sampleFormat: 'Float32',
        pixels: block('Float32', [-1, 0.25, 0.5, 2]),
      }),
    );
    expect(Array.from(plain.data)).toEqual([0, 64, 128, 255]);

    const bounded = decodeXisfToBytes(
      buildXisf({
        geometry: '3:1:1',
        sampleFormat: 'Float64',
        imageAttrs: 'bounds="0:65535"',
        pixels: block('Float64', [0, 32767.5, 65535]),
      }),
    );
    expect(Array.from(bounded.data)).toEqual([0, 128, 255]);
  });

  it('reads planar and interleaved colour pixels, and ignores a fourth channel', () => {
    // Two pixels: (255, 0, 51) and (0, 255, 102).
    const planar = decodeXisfToBytes(
      buildXisf({
        geometry: '2:1:3',
        sampleFormat: 'UInt8',
        colorSpace: 'RGB',
        pixels: block('UInt8', [255, 0, 0, 255, 51, 102]),
      }),
    );
    expect(planar.channels).toBe(3);
    expect(Array.from(planar.data)).toEqual([255, 0, 51, 0, 255, 102]);

    const interleaved = decodeXisfToBytes(
      buildXisf({
        geometry: '2:1:3',
        sampleFormat: 'UInt8',
        colorSpace: 'RGB',
        imageAttrs: 'pixelStorage="Normal"',
        pixels: block('UInt8', [255, 0, 51, 0, 255, 102]),
      }),
    );
    expect(Array.from(interleaved.data)).toEqual([255, 0, 51, 0, 255, 102]);

    const withAlpha = decodeXisfToBytes(
      buildXisf({
        geometry: '2:1:4',
        sampleFormat: 'UInt8',
        colorSpace: 'RGB',
        pixels: block('UInt8', [255, 0, 0, 255, 51, 102, 9, 9]),
      }),
    );
    expect(Array.from(withAlpha.data)).toEqual([255, 0, 51, 0, 255, 102]);
  });

  it('reads big-endian samples', () => {
    const r = decodeXisfToBytes(
      buildXisf({
        geometry: '2:1:1',
        sampleFormat: 'UInt16',
        imageAttrs: 'byteOrder="big"',
        pixels: block('UInt16', [0, 65535 - 255], false),
      }),
    );
    expect(Array.from(r.data)).toEqual([0, 254]);
  });

  it('reads a zlib block, with and without byte shuffling', () => {
    const raw = block('UInt16', [0, 13107, 32768, 65535]);
    const zipped = decodeXisfToBytes(
      buildXisf({
        geometry: '2:2:1',
        sampleFormat: 'UInt16',
        compression: `zlib:${raw.length}`,
        pixels: zlibSync(raw),
      }),
    );
    expect(Array.from(zipped.data)).toEqual([0, 51, 128, 255]);

    const shuffled = decodeXisfToBytes(
      buildXisf({
        geometry: '2:2:1',
        sampleFormat: 'UInt16',
        compression: `zlib+sh:${raw.length}:2`,
        pixels: zlibSync(shuffle(raw, 2)),
      }),
    );
    expect(Array.from(shuffled.data)).toEqual([0, 51, 128, 255]);
  });

  it('rejects what it cannot read', () => {
    const pixels = block('UInt8', [1, 2, 3, 4]);
    const base = { geometry: '2:2:1', sampleFormat: 'UInt8', pixels };
    const failing = [
      buildXisf({ noImage: true }),
      buildXisf({ geometry: '2:2:1', sampleFormat: 'UInt8', location: 'inline:base64' }),
      buildXisf({ geometry: '2:2:1', sampleFormat: 'UInt8', location: 'attachment:4096:4' }),
      buildXisf({ ...base, sampleFormat: 'Complex32' }),
      buildXisf({ ...base, compression: 'lz4:4' }),
      buildXisf({ ...base, compression: 'zstd+sh:4:1' }),
      buildXisf({ ...base, compression: 'zlib:4' }),
      buildXisf({ ...base, geometry: '4:4:1' }),
      buildXisf({ ...base, geometry: '2:1:2' }),
      buildXisf({ ...base, sampleFormat: 'Float32', imageAttrs: 'bounds="1:1"' }),
    ];
    for (const file of failing) {
      expect(() => decodeXisfToBytes(file)).toThrow(UnsupportedXisfError);
    }
  });
});
