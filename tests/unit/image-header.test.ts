// @vitest-environment node
/** The header reader against files made by `sharp`: the size and orientation it reports are sharp's. */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readImageHeader } from '@myastrosky/core/image-header';

async function raw(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3, 90);
  return sharp(data, { raw: { width, height, channels: 3 } });
}
const bytes = (b: Buffer): Uint8Array => new Uint8Array(b);

describe('readImageHeader', () => {
  it('reads a JPEG size without orientation', async () => {
    const b = bytes(await (await raw(60, 30)).jpeg().toBuffer());
    expect(readImageHeader(b)).toEqual({ format: 'jpeg', width: 60, height: 30 });
  });

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`reads JPEG EXIF orientation ${orientation}`, async () => {
      const b = bytes(await (await raw(40, 20)).withMetadata({ orientation }).jpeg().toBuffer());
      const m = await sharp(b).metadata();
      const h = readImageHeader(b);
      expect(h).toMatchObject({ width: 40, height: 20, orientation: m.orientation });
      expect(h.orientation).toBe(orientation);
    });
  }

  it('reads a PNG size', async () => {
    const b = bytes(await (await raw(24, 12)).png().toBuffer());
    expect(readImageHeader(b)).toEqual({ format: 'png', width: 24, height: 12 });
  });

  it('reads a lossy WebP size', async () => {
    const b = bytes(await (await raw(33, 17)).webp().toBuffer());
    expect(readImageHeader(b)).toMatchObject({ format: 'webp', width: 33, height: 17 });
  });

  it('reads a lossless WebP size', async () => {
    const b = bytes(await (await raw(31, 19)).webp({ lossless: true }).toBuffer());
    expect(readImageHeader(b)).toMatchObject({ format: 'webp', width: 31, height: 19 });
  });

  it('reads a WebP with EXIF orientation (VP8X)', async () => {
    const b = bytes(await (await raw(30, 16)).withMetadata({ orientation: 6 }).webp().toBuffer());
    const m = await sharp(b).metadata();
    expect(readImageHeader(b)).toMatchObject({ width: 30, height: 16, orientation: m.orientation });
  });

  it('rejects other formats and cut files', async () => {
    expect(() => readImageHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow();
    expect(() => readImageHeader(new Uint8Array(0))).toThrow();
    const gif = bytes(await (await raw(8, 8)).gif().toBuffer());
    expect(() => readImageHeader(gif)).toThrow();
    const jpeg = bytes(await (await raw(60, 30)).jpeg().toBuffer());
    expect(() => readImageHeader(jpeg.subarray(0, 8))).toThrow();
  });
});
