import { describe, it, expect } from 'vitest';
import { decodeTiffToBytes, UnsupportedTiffError } from '../../server/raw-decode/tiff-decoder';
import { buildTiff } from '../fixtures/tiff-builders';

describe('decodeTiffToBytes — 8-bit unsigned mono, uncompressed', () => {
  it('decodes a 2x2 image, chunky, little-endian, single strip', () => {
    const buf = buildTiff({
      width: 2,
      height: 2,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [0, 128, 255, 64],
    });
    const d = decodeTiffToBytes(buf);
    expect(d.width).toBe(2);
    expect(d.height).toBe(2);
    expect(d.channels).toBe(1);
    expect(Array.from(d.data)).toEqual([0, 128, 255, 64]);
  });

  it('decodes big-endian (MM) the same as little-endian (II)', () => {
    for (const littleEndian of [true, false]) {
      const buf = buildTiff({
        width: 2,
        height: 1,
        bitsPerSample: 8,
        sampleFormat: 1,
        samplesPerPixel: 1,
        photometric: 1,
        littleEndian,
        pixels: [10, 200],
      });
      const d = decodeTiffToBytes(buf);
      expect(Array.from(d.data)).toEqual([10, 200]);
    }
  });

  it('inverts WhiteIsZero (photometric 0)', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 0,
      pixels: [0, 255],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([255, 0]);
  });

  it('splits rows across multiple strips and reassembles them in order', () => {
    const pixels = [0, 20, 40, 60, 80, 100]; // 3 rows x 2 cols, mono
    const buf = buildTiff({
      width: 2,
      height: 3,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      rowsPerStrip: 1,
      pixels,
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual(pixels);
  });
});

describe('decodeTiffToBytes — 16-bit unsigned', () => {
  it('normalises the full 16-bit range to 8-bit linearly', () => {
    const buf = buildTiff({
      width: 4,
      height: 1,
      bitsPerSample: 16,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [0, 32768, 65535, 6554], // ~0, ~50%, 100%, 10%
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([0, 128, 255, 26]);
  });

  it('decodes 16-bit RGB, chunky', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 16,
      sampleFormat: 1,
      samplesPerPixel: 3,
      photometric: 2,
      pixels: [65535, 0, 0, 0, 65535, 0],
    });
    const d = decodeTiffToBytes(buf);
    expect(d.channels).toBe(3);
    expect(Array.from(d.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('decodes 16-bit RGB, planar (PlanarConfiguration=2)', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 16,
      sampleFormat: 1,
      samplesPerPixel: 3,
      photometric: 2,
      planarConfig: 2,
      pixels: [65535, 0, 0, 0, 65535, 0],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });
});

describe('decodeTiffToBytes — 32-bit float', () => {
  it('maps [0,1] float samples linearly, mono', () => {
    const buf = buildTiff({
      width: 4,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [0, 0.5, 1, 0.13022],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([0, 128, 255, 33]);
  });

  it('clamps out-of-range float samples instead of wrapping', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [-0.5, 2],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([0, 255]);
  });

  it('decodes 32-bit float RGB, chunky', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 3,
      photometric: 2,
      pixels: [1, 0, 0, 0, 0.5, 0],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([255, 0, 0, 0, 128, 0]);
  });
});

describe('decodeTiffToBytes — Predictor 2 (horizontal differencing)', () => {
  it('undoes 8-bit horizontal differencing', () => {
    const buf = buildTiff({
      width: 4,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      predictor: 2,
      pixels: [10, 12, 15, 11],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([10, 12, 15, 11]);
  });

  it('undoes 16-bit horizontal differencing per-channel for RGB', () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 16,
      sampleFormat: 1,
      samplesPerPixel: 3,
      photometric: 2,
      predictor: 2,
      pixels: [1000, 2000, 3000, 1200, 1900, 3300],
    });
    const d = decodeTiffToBytes(buf);
    const scale = (v: number) => Math.round((v / 65535) * 255);
    expect(Array.from(d.data)).toEqual([
      scale(1000),
      scale(2000),
      scale(3000),
      scale(1200),
      scale(1900),
      scale(3300),
    ]);
  });
});

describe('decodeTiffToBytes — PackBits compression', () => {
  it('decompresses a PackBits-compressed mono strip', () => {
    const buf = buildTiff({
      width: 4,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      compression: 32773,
      pixels: [5, 10, 15, 20],
    });
    const d = decodeTiffToBytes(buf);
    expect(Array.from(d.data)).toEqual([5, 10, 15, 20]);
  });
});

describe('decodeTiffToBytes — rejections', () => {
  it('rejects tiled TIFF', () => {
    const buf = buildTiff({
      width: 16,
      height: 16,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      tiled: true,
      pixels: Array(256).fill(0),
    });
    expect(() => decodeTiffToBytes(buf)).toThrow(UnsupportedTiffError);
  });
});
