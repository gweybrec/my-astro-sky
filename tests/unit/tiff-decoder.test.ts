import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { decodeTiffToBytes, UnsupportedTiffError } from '@myastrosky/core/raw-decode/tiff-decoder';
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

describe('decodeTiffToBytes — LZW compression (encoded by libtiff via sharp)', () => {
  // 9000 pseudo-random bytes: enough LZW codes to cross every code-width change
  // (9→10→11→12 bits) and a Clear code, all in one strip.
  async function lzwTiff(): Promise<{ tif: Buffer; pixels: Uint8Array }> {
    let seed = 1;
    const pixels = Uint8Array.from({ length: 9000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    });
    const tif = await sharp(pixels, { raw: { width: 100, height: 30, channels: 3 } })
      .tiff({ compression: 'lzw', predictor: 'none' })
      .toBuffer();
    return { tif, pixels };
  }

  it('decodes every pixel exactly', async () => {
    const { tif, pixels } = await lzwTiff();
    const d = decodeTiffToBytes(tif);
    expect(d.channels).toBe(3);
    expect(Buffer.from(d.data).equals(Buffer.from(pixels))).toBe(true);
  });

  it('rejects a truncated strip instead of returning zero-filled pixels', async () => {
    const { tif } = await lzwTiff();
    // Halve StripByteCounts (tag 279, one inline LONG) in the little-endian first IFD.
    const ifd = tif.readUInt32LE(4);
    const n = tif.readUInt16LE(ifd);
    for (let i = 0; i < n; i++) {
      const entry = ifd + 2 + i * 12;
      if (tif.readUInt16LE(entry) === 279) {
        tif.writeUInt32LE(Math.floor(tif.readUInt32LE(entry + 8) / 2), entry + 8);
      }
    }
    expect(() => decodeTiffToBytes(tif)).toThrow(UnsupportedTiffError);
  });
});

describe('decodeTiffToBytes — strip geometry', () => {
  // 5 rows in strips of 4 make a 4-row strip then a 1-row strip; the strip count alone
  // (2) would wrongly suggest 3 rows per strip.
  const pixels = [10, 20, 30, 40, 50];
  const shorterLastStrip = { width: 1, height: 5, bitsPerSample: 8, sampleFormat: 1 } as const;

  it('honours RowsPerStrip when the last strip is shorter (chunky)', () => {
    const buf = buildTiff({
      ...shorterLastStrip,
      samplesPerPixel: 1,
      photometric: 1,
      rowsPerStrip: 4,
      pixels,
    });
    expect(Array.from(decodeTiffToBytes(buf).data)).toEqual(pixels);
  });

  it('honours RowsPerStrip when the last strip is shorter (planar RGB)', () => {
    const rgb = pixels.flatMap((v) => [v, v + 1, v + 2]);
    const buf = buildTiff({
      ...shorterLastStrip,
      samplesPerPixel: 3,
      photometric: 2,
      planarConfig: 2,
      rowsPerStrip: 4,
      pixels: rgb,
    });
    expect(Array.from(decodeTiffToBytes(buf).data)).toEqual(rgb);
  });

  it('infers the strip height from the strip count when RowsPerStrip disagrees with it', () => {
    const buf = buildTiff({
      width: 1,
      height: 4,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      rowsPerStrip: 2,
      rowsPerStripTag: 1, // would mean 4 strips, but only 2 are present
      pixels: [1, 2, 3, 4],
    });
    expect(Array.from(decodeTiffToBytes(buf).data)).toEqual([1, 2, 3, 4]);
  });

  it('decodes a libtiff multi-strip file (256-row strips, shorter last strip)', async () => {
    const pixels = Uint8Array.from({ length: 100 * 1000 * 3 }, (_, i) => (i * 7) & 0xff);
    const tif = await sharp(pixels, { raw: { width: 100, height: 1000, channels: 3 } })
      .tiff({ compression: 'none', predictor: 'none' })
      .toBuffer();
    const d = decodeTiffToBytes(tif);
    expect(Buffer.from(d.data).equals(Buffer.from(pixels))).toBe(true);
  });

  it('rejects an uncompressed strip shorter than its rows', () => {
    const buf = buildTiff({ ...shorterLastStrip, samplesPerPixel: 1, photometric: 1, pixels });
    // Halve StripByteCounts (tag 279, one inline LONG) in the little-endian first IFD.
    const ifd = buf.readUInt32LE(4);
    for (let i = 0; i < buf.readUInt16LE(ifd); i++) {
      const entry = ifd + 2 + i * 12;
      if (buf.readUInt16LE(entry) === 279) buf.writeUInt32LE(2, entry + 8);
    }
    expect(() => decodeTiffToBytes(buf)).toThrow(UnsupportedTiffError);
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
