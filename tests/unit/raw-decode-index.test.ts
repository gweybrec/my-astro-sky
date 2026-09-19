import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { decodeRawAstroImage, UnsupportedRawFormatError } from '../../server/raw-decode/index';
import { buildTiff } from '../fixtures/tiff-builders';
import { buildFits } from '../fixtures/fits-builders';

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
      expect(r.png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
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
    await expect(decodeRawAstroImage(Buffer.alloc(10), '.cr2')).rejects.toThrow(
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
    const m = await sharp(r.png).metadata();
    expect(m.channels).toBe(1); // confirms the PNG itself was written as single-channel
    // sharp's raw() extraction defaults to sRGB regardless of the source; ask for the
    // PNG's own (b-w) colourspace back to read the stored bytes as they truly are.
    const { data, info } = await sharp(r.png)
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(1);
    expect(Array.from(data)).toEqual([0, 64, 128, 255]);
  });
});

const TEST_PHOTOS_DIR = path.join(__dirname, '../../test-photos');

describe.skipIf(!fs.existsSync(TEST_PHOTOS_DIR))(
  'decodeRawAstroImage — real sample files (local only, test-photos/ is gitignored)',
  () => {
    it('decodes all real TIFF/FITS samples to plausible dimensions', async () => {
      const cases: Array<[string, string, number, number, 1 | 3]> = [
        ['M26.tiff', '.tiff', 3331, 1791, 3],
        ['M97+M108.tiff', '.tiff', 3263, 1931, 3],
        ['M1-CCD.fit', '.fit', 1049, 754, 1],
        ['M2_1320s.fit', '.fit', 674, 507, 1],
        ['M101.fit', '.fit', 3204, 2136, 3],
        ['LDN1235.fit', '.fit', 5760, 3239, 3],
      ];
      for (const [file, ext, width, height, channels] of cases) {
        const full = path.join(TEST_PHOTOS_DIR, file);
        if (!fs.existsSync(full)) continue;
        const buf = fs.readFileSync(full);
        const r = await decodeRawAstroImage(buf, ext);
        expect(r.width).toBe(width);
        expect(r.height).toBe(height);
        expect(r.channels).toBe(channels);
      }
    }, 30000);
  },
);
