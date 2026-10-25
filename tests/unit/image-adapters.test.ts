// @vitest-environment node
/**
 * The two server adapters of the image and file ports, on real small images (WP2.3h). The byte-identity
 * cases compare them with the `sharp` calls the upload route made before the ports existed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createFsBlobStore } from '../../server/blob-store';
import { createSharpImageCodec } from '../../server/image-codec';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-adapters-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A 60x30 picture with some structure, as JPEG with the given EXIF orientation. */
async function jpeg(orientation?: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(60 * 30 * 3);
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 3;
      raw[i] = (x * 4) % 256;
      raw[i + 1] = (y * 8) % 256;
      raw[i + 2] = (x * y) % 256;
    }
  }
  const img = sharp(raw, { raw: { width: 60, height: 30, channels: 3 } });
  return new Uint8Array(
    await (orientation ? img.withMetadata({ orientation }) : img).jpeg({ quality: 90 }).toBuffer(),
  );
}

async function png(): Promise<Uint8Array> {
  const raw = Buffer.alloc(24 * 12 * 3, 0);
  for (let i = 0; i < raw.length; i += 3) raw[i] = i % 256;
  return new Uint8Array(
    await sharp(raw, { raw: { width: 24, height: 12, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('createSharpImageCodec', () => {
  const codec = createSharpImageCodec();

  it('probes the size and the orientation', async () => {
    expect(await codec.probe(await jpeg())).toEqual({ width: 60, height: 30 });
    expect(await codec.probe(await jpeg(6))).toEqual({ width: 60, height: 30, orientation: 6 });
    expect(await codec.probe(await png())).toEqual({ width: 24, height: 12 });
  });

  it('rejects bytes that are not an image', async () => {
    await expect(codec.probe(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
    await expect(codec.probe(new Uint8Array())).rejects.toThrow();
  });

  it('bakes the orientation: the pixels turn and the tag goes', async () => {
    const baked = await codec.bakeOrientation(await jpeg(6), '.jpg');
    expect(await codec.probe(baked)).toEqual({ width: 30, height: 60 });
    const png8 = await codec.bakeOrientation(await png(), '.png');
    expect((await sharp(png8).metadata()).format).toBe('png');
    const webp = await codec.bakeOrientation(await jpeg(), '.webp');
    expect((await sharp(webp).metadata()).format).toBe('webp');
  });

  it('refuses an extension it cannot write', async () => {
    await expect(codec.bakeOrientation(await jpeg(), '.gif')).rejects.toThrow();
  });

  it.each([
    ['without orientation', undefined, '.jpg'],
    ['with EXIF orientation 6', 6, '.jpg'],
    ['a PNG', 0, '.png'],
  ])(
    'makes the same stored image and the same thumbnail as the old route (%s)',
    async (_label, orientation, ext) => {
      const source = ext === '.png' ? await png() : await jpeg(orientation);

      // The old route: toFile for the image, then a thumbnail made from the saved file.
      const oldImage = path.join(dir, `old-${_label.replace(/\W/g, '')}${ext}`);
      const oldThumb = oldImage.replace(/\.\w+$/, '_thumb.jpg');
      const meta = await sharp(source).metadata();
      const swap = !!meta.orientation && meta.orientation >= 5 && meta.orientation <= 8;
      const newWidth = swap ? meta.height! : meta.width!;
      const newHeight = swap ? meta.width! : meta.height!;
      await sharp(source).rotate().toFile(oldImage);
      const scale = Math.min(1, 400 / Math.max(newWidth, newHeight));
      await sharp(oldImage)
        .resize(
          Math.max(1, Math.round(newWidth * scale)),
          Math.max(1, Math.round(newHeight * scale)),
        )
        .jpeg({ quality: 75 })
        .toFile(oldThumb);

      const baked = await codec.bakeOrientation(source, ext);
      const thumb = await codec.thumbnail(baked, 400, 75);
      expect(same(baked, new Uint8Array(fs.readFileSync(oldImage)))).toBe(true);
      expect(same(thumb, new Uint8Array(fs.readFileSync(oldThumb)))).toBe(true);
    },
  );

  it('shrinks a large picture to the longer side and never enlarges a small one', async () => {
    const big = new Uint8Array(
      await sharp({ create: { width: 900, height: 300, channels: 3, background: '#468' } })
        .jpeg()
        .toBuffer(),
    );
    expect(await codec.probe(await codec.thumbnail(big, 400, 75))).toEqual({
      width: 400,
      height: 133,
    });
    expect(await codec.probe(await codec.thumbnail(await jpeg(), 400, 75))).toEqual({
      width: 60,
      height: 30,
    });
    const thumb = await codec.thumbnail(await png(), 400, 75);
    expect((await sharp(thumb).metadata()).format).toBe('jpeg');
  });

  it('encodes raw pixels as a JPEG or a PNG, for 1, 3 and 4 channels', async () => {
    for (const channels of [1, 3, 4] as const) {
      const data = new Uint8Array(8 * 4 * channels).map((_, i) => (i * 7) % 256);
      const asPng = await codec.encode({ width: 8, height: 4, channels, data }, 'png');
      const m = await sharp(asPng).metadata();
      expect([m.format, m.width, m.height]).toEqual(['png', 8, 4]);
      if (channels !== 4) {
        const asJpeg = await codec.encode({ width: 8, height: 4, channels, data }, 'jpeg', 80);
        expect((await sharp(asJpeg).metadata()).format).toBe('jpeg');
      }
    }
    // the PNG keeps every pixel
    const data = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const back = await sharp(await codec.encode({ width: 2, height: 1, channels: 3, data }, 'png'))
      .raw()
      .toBuffer();
    expect([...back]).toEqual([...data]);
  });
  it('decodes a PNG (RGB and RGBA) to its raw pixels, and rejects bytes that are not an image', async () => {
    for (const channels of [3, 4] as const) {
      const data = new Uint8Array(3 * 2 * channels).map((_, i) => (i * 11 + 5) % 256);
      const png = await codec.encode({ width: 3, height: 2, channels, data }, 'png');
      const decoded = await codec.decode(png);
      expect([decoded.width, decoded.height, decoded.channels]).toEqual([3, 2, channels]);
      expect([...decoded.data]).toEqual([...data]);
    }
    await expect(codec.decode(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('createFsBlobStore', () => {
  it('puts, gets, sizes and removes a blob; a missing blob is null and removing it is no error', async () => {
    const store = createFsBlobStore(dir);
    expect(await store.get('blob.bin')).toBeNull();
    expect(await store.size('blob.bin')).toBeNull();
    await store.remove('blob.bin');

    await store.put('blob.bin', new Uint8Array([1, 2, 3, 4]));
    expect(await store.size('blob.bin')).toBe(4);
    expect([...(await store.get('blob.bin'))!]).toEqual([1, 2, 3, 4]);
    expect(fs.readFileSync(path.join(dir, 'blob.bin')).length).toBe(4);

    await store.put('blob.bin', new Uint8Array([9]));
    expect(await store.size('blob.bin')).toBe(1);

    await store.remove('blob.bin');
    expect(await store.get('blob.bin')).toBeNull();
    expect(fs.existsSync(path.join(dir, 'blob.bin'))).toBe(false);
  });

  it('rejects a put into a folder that does not exist', async () => {
    await expect(
      createFsBlobStore(path.join(dir, 'missing')).put('a', new Uint8Array([1])),
    ).rejects.toThrow();
  });
});
