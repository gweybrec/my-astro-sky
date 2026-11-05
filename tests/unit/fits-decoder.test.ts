import { describe, it, expect } from 'vitest';
import { decodeFitsToBytes, UnsupportedFitsError } from '@myastrosky/core/raw-decode/fits-decoder';
import { buildFits } from '../fixtures/fits-builders';

describe('decodeFitsToBytes — BITPIX -32 (float), 2D mono', () => {
  it('maps [0,1] float samples linearly', () => {
    // 2x2, row-major, physical values already in [0,1]; the second stored row comes out first
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 2,
      pixels: [0, 0.5, 1, 0.13022],
    });
    const d = decodeFitsToBytes(buf);
    expect(d.width).toBe(2);
    expect(d.height).toBe(2);
    expect(d.channels).toBe(1);
    expect(Array.from(d.data)).toEqual([255, 33, 0, 128]);
  });

  // The WCS counts rows in stored order with row 1 at the bottom, and Siril shows and exports
  // every file that way, so ROWORDER never changes how the picture is drawn.
  it.each(['BOTTOM-UP', 'TOP-DOWN', undefined] as const)(
    'draws the first stored row at the bottom (ROWORDER %s)',
    (roworder) => {
      const firstStored = [10, 20];
      const secondStored = [30, 40];
      const buf = buildFits({
        bitpix: -32,
        naxis1: 2,
        naxis2: 2,
        ...(roworder ? { roworder } : {}),
        pixels: [...firstStored, ...secondStored].map((v) => v / 255),
      });
      expect(Array.from(decodeFitsToBytes(buf).data)).toEqual([...secondStored, ...firstStored]);
    },
  );
});

describe('decodeFitsToBytes — NAXIS3=3 colour cube', () => {
  it('interleaves plane-major RGB planes into per-pixel RGB', () => {
    // 2x1 image, 3 planes (R, G, B), plane-major storage
    const redPlane = [1, 0]; // pixel0=1(red), pixel1=0
    const greenPlane = [0, 1];
    const bluePlane = [0, 0];
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 1,
      naxis3: 3,
      roworder: 'TOP-DOWN',
      pixels: [...redPlane, ...greenPlane, ...bluePlane],
    });
    const d = decodeFitsToBytes(buf);
    expect(d.channels).toBe(3);
    expect(Array.from(d.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });
});

describe('decodeFitsToBytes — integer BITPIX with BZERO/BSCALE', () => {
  it('normalises BITPIX=16 with BZERO=32768 (the unsigned-16-bit convention)', () => {
    const buf = buildFits({
      bitpix: 16,
      naxis1: 4,
      naxis2: 1,
      bzero: 32768,
      bscale: 1,
      roworder: 'TOP-DOWN',
      pixels: [0, 32768, 65535, 6554],
    });
    const d = decodeFitsToBytes(buf);
    expect(Array.from(d.data)).toEqual([0, 128, 255, 26]);
  });
});

describe('decodeFitsToBytes — trailing padding regression', () => {
  it('ignores garbage floats after the data unit (bounded read)', () => {
    const pixels = [0, 0.25, 0.5, 0.75];
    const withoutGarbage = decodeFitsToBytes(
      buildFits({ bitpix: -32, naxis1: 2, naxis2: 2, roworder: 'TOP-DOWN', pixels }),
    );
    const withGarbage = decodeFitsToBytes(
      buildFits({
        bitpix: -32,
        naxis1: 2,
        naxis2: 2,
        roworder: 'TOP-DOWN',
        pixels,
        trailingGarbageFloats: [8.03e34, 8.03e34, 8.03e34, 8.03e34, NaN],
      }),
    );
    expect(Array.from(withGarbage.data)).toEqual(Array.from(withoutGarbage.data));
  });
});

describe('decodeFitsToBytes — header spanning more than one 2880-byte block', () => {
  it('decodes correctly with many extra COMMENT cards padding the header past one block', () => {
    const extraCards = Array.from({ length: 50 }, (_, i) => `COMMENT padding card number ${i}`);
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 1,
      roworder: 'TOP-DOWN',
      extraCards,
      pixels: [0, 1],
    });
    const d = decodeFitsToBytes(buf);
    expect(Array.from(d.data)).toEqual([0, 255]);
  });
});

describe('decodeFitsToBytes — rejections', () => {
  it('rejects an undebayered CFA-shaped file (NAXIS=2 is fine, but NAXIS3 other than 3 is not)', () => {
    const buf = buildFits({
      bitpix: -32,
      naxis1: 2,
      naxis2: 2,
      naxis3: 4,
      pixels: Array(16).fill(0),
    });
    expect(() => decodeFitsToBytes(buf)).toThrow(UnsupportedFitsError);
  });
});
