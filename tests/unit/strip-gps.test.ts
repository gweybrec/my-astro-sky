// @vitest-environment node
/** The position is taken out of a picture file's metadata, and nothing else of the file changes. */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readImageHeader } from '@myastrosky/core/image-header';
import { stripGps } from '@myastrosky/core/strip-gps';
import { crc32 } from '@myastrosky/core/zip-writer';

const LATITUDE = [48, 1, 51, 1, 2999, 100];
const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description exif:GPSLatitude="48,51.5N" dc:title="M42">' +
  '<exif:GPSLongitude>2,21.1E</exif:GPSLongitude></rdf:Description></x:xmpmeta>';

/**
 * An EXIF block (little-endian TIFF): orientation 6, the pointer to a GPS directory, and one more entry after it; the
 * GPS directory holds a latitude reference (kept in its entry) and a latitude (three fractions, kept after it).
 */
function exifWithGps(): Uint8Array {
  const b = new Uint8Array(8 + 2 + 3 * 12 + 4 + 2 + 2 * 12 + 4 + 24);
  const view = new DataView(b.buffer);
  b.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  };
  const gps = 8 + 2 + 3 * 12 + 4;
  const latitudeAt = gps + 2 + 2 * 12 + 4;
  view.setUint16(8, 3, true);
  entry(10, 0x0112, 3, 1, 6);
  entry(22, 0x8825, 4, 1, gps);
  entry(34, 0xa001, 3, 1, 1);
  view.setUint16(gps, 2, true);
  entry(gps + 2, 0x0001, 2, 2, 'N'.charCodeAt(0));
  entry(gps + 14, 0x0002, 5, 3, latitudeAt);
  LATITUDE.forEach((n, i) => view.setUint32(latitudeAt + i * 4, n, true));
  return b;
}

const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const includes = (bytes: Uint8Array, part: Uint8Array) => Buffer.from(bytes).includes(part);
const latitudeBytes = () => new Uint8Array(new Uint32Array(LATITUDE).buffer);

/** A JPEG segment `APP1` holding `content`. */
function app1(content: Uint8Array): Uint8Array {
  const length = content.length + 2;
  return concat(new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff]), content);
}

async function plainJpeg(): Promise<Uint8Array> {
  const pixels = Buffer.alloc(24 * 16 * 3).map((_, i) => (i * 7) % 256);
  return new Uint8Array(
    await sharp(pixels, { raw: { width: 24, height: 16, channels: 3 } })
      .jpeg()
      .toBuffer(),
  );
}

const pixelsOf = async (bytes: Uint8Array) => sharp(bytes).raw().toBuffer();

describe('stripGps', () => {
  it('wipes the GPS directory of a JPEG and keeps the other entries and the picture', async () => {
    const plain = await plainJpeg();
    const jpeg = concat(
      plain.subarray(0, 2),
      app1(concat(text('Exif\0\0'), exifWithGps())),
      app1(text(`http://ns.adobe.com/xap/1.0/\0${XMP}`)),
      plain.subarray(2),
    );
    expect(includes(jpeg, latitudeBytes())).toBe(true);
    expect(readImageHeader(jpeg).orientation).toBe(6);

    const stripped = stripGps(jpeg);
    expect(stripped).not.toBe(jpeg);
    expect(stripped.length).toBe(jpeg.length);
    expect(includes(stripped, latitudeBytes())).toBe(false);
    expect(includes(stripped, text('48,51.5N'))).toBe(false);
    expect(includes(stripped, text('2,21.1E'))).toBe(false);
    // What is not a position stays: the orientation, the entry after the GPS pointer, the title.
    expect(readImageHeader(stripped).orientation).toBe(6);
    expect(includes(stripped, new Uint8Array([0x01, 0xa0, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0]))).toBe(
      true,
    );
    expect(includes(stripped, new Uint8Array([0x25, 0x88]))).toBe(false);
    expect(includes(stripped, text('dc:title="M42"'))).toBe(true);
    expect((await pixelsOf(stripped)).equals(await pixelsOf(jpeg))).toBe(true);
    // Nothing is left to remove.
    expect(stripGps(stripped)).toBe(stripped);
    // The file given is not changed.
    expect(includes(jpeg, latitudeBytes())).toBe(true);
  });

  it('wipes the position of a picture sharp wrote with GPS tags', async () => {
    const jpeg = new Uint8Array(
      await sharp(Buffer.from(await plainJpeg()))
        .withExif({
          IFD0: { Copyright: 'someone' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 2999/100' },
        })
        .jpeg()
        .toBuffer(),
    );
    const stripped = stripGps(jpeg);
    expect(stripped).not.toBe(jpeg);
    expect(includes(stripped, text('someone'))).toBe(true);
    expect(stripGps(stripped)).toBe(stripped);
    expect((await pixelsOf(stripped)).equals(await pixelsOf(jpeg))).toBe(true);
  });

  it('returns a file that holds no position as it is', async () => {
    const jpeg = await plainJpeg();
    expect(stripGps(jpeg)).toBe(jpeg);
    const notAPicture = text('not a picture');
    expect(stripGps(notAPicture)).toBe(notAPicture);
    expect(stripGps(new Uint8Array(0))).toHaveLength(0);
  });

  it('wipes the position of a PNG and keeps its chunks valid', async () => {
    const plain = new Uint8Array(
      await sharp(Buffer.alloc(8 * 8 * 3, 90), { raw: { width: 8, height: 8, channels: 3 } })
        .png()
        .toBuffer(),
    );
    const chunk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, data.length);
      out.set(text(type), 4);
      out.set(data, 8);
      view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      return out;
    };
    // After the header chunk (8 bytes of signature, then IHDR: 25 bytes).
    const png = concat(
      plain.subarray(0, 33),
      chunk('eXIf', exifWithGps()),
      chunk('iTXt', text(`XML:com.adobe.xmp\0\0\0\0\0${XMP}`)),
      plain.subarray(33),
    );
    const stripped = stripGps(png);
    expect(stripped.length).toBe(png.length);
    expect(includes(stripped, latitudeBytes())).toBe(false);
    expect(includes(stripped, text('48,51.5N'))).toBe(false);
    // sharp refuses a chunk whose CRC is wrong.
    expect((await pixelsOf(stripped)).equals(await pixelsOf(png))).toBe(true);
    expect(stripGps(stripped)).toBe(stripped);
  });

  it('wipes the position of a WebP', async () => {
    const webp = new Uint8Array(
      await sharp(Buffer.alloc(8 * 8 * 3, 90), { raw: { width: 8, height: 8, channels: 3 } })
        .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 2999/100' } })
        .webp({ lossless: true })
        .toBuffer(),
    );
    const stripped = stripGps(webp);
    expect(stripped).not.toBe(webp);
    expect(stripped.length).toBe(webp.length);
    expect(stripGps(stripped)).toBe(stripped);
    expect((await pixelsOf(stripped)).equals(await pixelsOf(webp))).toBe(true);
  });

  it('leaves a cut or damaged EXIF block alone instead of failing', () => {
    const exif = exifWithGps();
    const cut = concat(
      new Uint8Array([0xff, 0xd8]),
      app1(concat(text('Exif\0\0'), exif.subarray(0, 30))),
      new Uint8Array([0xff, 0xd9]),
    );
    expect(() => stripGps(cut)).not.toThrow();
  });
});
