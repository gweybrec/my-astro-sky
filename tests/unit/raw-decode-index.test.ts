import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  decodeRawAstroImage as decodeWith,
  UnsupportedRawFormatError,
} from '@myastrosky/core/raw-decode/index';
import { createSharpImageCodec } from '../../server/image-codec';
import { buildTiff } from '../fixtures/tiff-builders';
import { buildFits } from '../fixtures/fits-builders';

const images = createSharpImageCodec();
const decodeRawAstroImage = (bytes: Uint8Array, ext: string) => decodeWith(bytes, ext, images);

describe('decodeRawAstroImage — extension dispatch', () => {
  it('decodes .tif/.tiff via the TIFF decoder', async () => {
    const buf = buildTiff({
      width: 2,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [0, 255],
    });
    for (const ext of ['.tif', '.tiff', '.TIFF']) {
      const r = await decodeRawAstroImage(buf, ext);
      expect(r.width).toBe(2);
      expect(r.height).toBe(1);
      expect(r.channels).toBe(1);
      expect(Buffer.from(r.png).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
    }
  });

  it('decodes .fit/.fits via the FITS decoder', async () => {
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 1,
      roworder: 'TOP-DOWN',
      pixels: [0, 1],
    });
    for (const ext of ['.fit', '.fits', '.FITS']) {
      const r = await decodeRawAstroImage(buf, ext);
      expect(r.width).toBe(2);
      expect(r.height).toBe(1);
      expect(r.channels).toBe(1);
    }
  });

  it('throws UnsupportedRawFormatError for an unknown extension', async () => {
    await expect(decodeRawAstroImage(new Uint8Array(10), '.cr2')).rejects.toThrow(
      UnsupportedRawFormatError,
    );
  });

  it('produces a PNG whose re-read 8-bit values match the decoded bytes exactly — the regression guard that sharp is used as an encoder only', async () => {
    const buf = buildTiff({
      width: 2,
      height: 2,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: [0, 0.25, 0.5, 1],
    });
    const r = await decodeRawAstroImage(buf, '.tiff');
    const m = await sharp(Buffer.from(r.png)).metadata();
    expect(m.channels).toBe(1); // confirms the PNG itself was written as single-channel
    // sharp's raw() extraction defaults to sRGB regardless of the source; ask for the
    // PNG's own (b-w) colourspace back to read the stored bytes as they truly are.
    const { data, info } = await sharp(Buffer.from(r.png))
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(1);
    expect(Array.from(data)).toEqual([0, 64, 128, 255]);
  });
});

// The photos users import are mostly Siril exports: float32 colour FITS cubes with long headers
// (WCS, SIP and HISTORY cards) and float32 RGB TIFFs written one row per strip. These build
// small files of the same shape, so the whole path down to a colour PNG is checked end to end.
describe('decodeRawAstroImage — colour files shaped like Siril exports', () => {
  async function pngPixels(png: Uint8Array): Promise<{ channels: number; data: number[] }> {
    const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
    return { channels: info.channels, data: Array.from(data) };
  }

  it('decodes a float32 FITS colour cube with a header longer than one block', async () => {
    // 2 x 2 pixels, plane-major (R, G, B), first stored row drawn at the bottom.
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 2,
      naxis3: 3,
      roworder: 'BOTTOM-UP',
      extraCards: [
        "CTYPE1  = 'RA---TAN-SIP'",
        "CTYPE2  = 'DEC--TAN-SIP'",
        'CRVAL1  =     323.362931259272',
        'CRVAL2  =   -0.822062165245548',
        'PLTSOLVD=                    T',
        ...Array.from({ length: 40 }, (_, i) => `HISTORY processing step ${i}`),
      ],
      pixels: [
        ...[0, 0.25, 0.5, 1], // R
        ...[1, 0.5, 0.25, 0], // G
        ...[0.5, 0, 1, 0.25], // B
      ],
    });
    expect(buf.length).toBeGreaterThan(2 * 2880); // the header really spans more than one block

    const r = await decodeRawAstroImage(buf, '.fit');
    expect([r.width, r.height, r.channels]).toEqual([2, 2, 3]);
    const px = await pngPixels(r.png);
    expect(px.channels).toBe(3);
    // Top row = second stored row (pixels 2, 3), bottom row = first stored row (pixels 0, 1).
    expect(px.data).toEqual([
      ...[128, 64, 255],
      ...[255, 0, 64],
      ...[0, 255, 128],
      ...[64, 128, 0],
    ]);
  });

  it('decodes a float32 RGB TIFF written one row per strip', async () => {
    const pixels = [
      ...[0, 0.25, 0.5],
      ...[1, 0, 0.25],
      ...[0.5, 1, 0],
      ...[0.25, 0.5, 1],
    ];
    const buf = buildTiff({
      width: 2,
      height: 2,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 3,
      photometric: 2,
      rowsPerStrip: 1,
      pixels,
    });

    const r = await decodeRawAstroImage(buf, '.tiff');
    expect([r.width, r.height, r.channels]).toEqual([2, 2, 3]);
    const px = await pngPixels(r.png);
    expect(px.channels).toBe(3);
    expect(px.data).toEqual(pixels.map((v) => Math.round(v * 255)));
  });
});
