/**
 * The contract every `ImageCodec` adapter must meet, as plain data (cases that throw on failure), so the same
 * cases run under Vitest on the server's `sharp` codec and inside the phone's WebView on the browser codec.
 * The cases compare sizes, the format (by the file's first bytes) and decoded pixels within a tolerance, never
 * bytes: two codecs encode differently. The caller supplies the pictures.
 */
import type { ImageCodec } from '../ports/image-codec';
import { bytesEqual, ok, rejects, toBe } from './conformance-assert';

export interface ImageCodecFixtures {
  /** A plain JPEG, 60 x 30, no EXIF orientation. */
  jpeg: Uint8Array;
  /** A PNG, 24 x 12. */
  png: Uint8Array;
  /** A WebP, 33 x 17 (optional). */
  webp?: Uint8Array;
  /**
   * A JPEG stored 60 x 30 with EXIF orientation 6 (shown rotated 90 degrees clockwise, so 30 x 60). Its stored
   * top-left corner (the 10 x 10 pixels there) is pure red; the rest is blue.
   */
  orientedJpeg: Uint8Array;
  /** A JPEG, 400 x 200. */
  large: Uint8Array;
  /** Bytes that are not a picture. */
  notAnImage: Uint8Array;
}

export interface ImageCodecConformanceOptions {
  /**
   * True when `bakeOrientation` returns the original bytes for a picture without orientation (the phone's
   * codec); false for a codec that re-encodes (the server's). Not tested when undefined.
   */
  keepsOriginalWithoutOrientation?: boolean;
}

export interface ImageCodecConformanceCase {
  name: string;
  run(codec: ImageCodec): Promise<void>;
}

type Format = 'jpeg' | 'png' | 'webp' | 'unknown';

/** The format named by the file's first bytes. */
export function formatOf(b: Uint8Array): Format {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'png';
  }
  if (b.length > 12 && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  return 'unknown';
}

const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;

type Rgb = [number, number, number];

/** The red, green and blue of one pixel of a decoded picture. */
function pixel(
  img: { width: number; channels: number; data: Uint8Array },
  x: number,
  y: number,
): Rgb {
  const at = (y * img.width + x) * img.channels;
  if (img.channels === 1) return [img.data[at], img.data[at], img.data[at]];
  return [img.data[at], img.data[at + 1], img.data[at + 2]];
}

const isRed = (p: Rgb): boolean => p[0] > 200 && p[1] < 60 && p[2] < 60;
const isBlue = (p: Rgb): boolean => p[2] > 150 && p[0] < 90 && p[1] < 90;
const closeTo = (p: Rgb, q: Rgb, tolerance: number): boolean =>
  near(p[0], q[0], tolerance) && near(p[1], q[1], tolerance) && near(p[2], q[2], tolerance);

export function imageCodecConformanceCases(
  fx: ImageCodecFixtures,
  options: ImageCodecConformanceOptions = {},
): ImageCodecConformanceCase[] {
  const cases: ImageCodecConformanceCase[] = [
    {
      name: 'probe: the stored size of a JPEG, with no orientation',
      async run(codec) {
        const info = await codec.probe(fx.jpeg);
        toBe(info.width, 60, 'width');
        toBe(info.height, 30, 'height');
        ok(!info.orientation || info.orientation === 1, 'no orientation expected');
      },
    },
    {
      name: 'probe: the stored size (before rotation) and the orientation of a rotated JPEG',
      async run(codec) {
        const info = await codec.probe(fx.orientedJpeg);
        toBe(info.width, 60, 'width');
        toBe(info.height, 30, 'height');
        toBe(info.orientation, 6, 'orientation');
      },
    },
    {
      name: 'probe: the size of a PNG',
      async run(codec) {
        const info = await codec.probe(fx.png);
        toBe(info.width, 24, 'width');
        toBe(info.height, 12, 'height');
      },
    },
    {
      name: 'probe rejects bytes that are not a picture',
      async run(codec) {
        await rejects(() => codec.probe(fx.notAnImage), 'probe');
      },
    },
    {
      name: 'bakeOrientation: a rotated JPEG comes back upright, in the same format, with the corner moved',
      async run(codec) {
        const out = await codec.bakeOrientation(fx.orientedJpeg, '.jpg');
        toBe(formatOf(out), 'jpeg', 'format');
        const info = await codec.probe(out);
        toBe(info.width, 30, 'width');
        toBe(info.height, 60, 'height');
        ok(!info.orientation || info.orientation === 1, 'orientation must be gone');
        // Rotating 90 degrees clockwise moves the stored top-left corner to the top-right.
        const img = await codec.decode(out);
        ok(isRed(pixel(img, 27, 2)), 'the top-right corner must be red');
        ok(isBlue(pixel(img, 2, 2)), 'the top-left corner must be blue');
        ok(isBlue(pixel(img, 27, 57)), 'the bottom-right corner must be blue');
      },
    },
    {
      name: 'bakeOrientation: PNG and the extension .jpeg are accepted, .gif and .tiff are refused',
      async run(codec) {
        const png = await codec.bakeOrientation(fx.png, '.png');
        toBe(formatOf(png), 'png', 'png format');
        toBe((await codec.probe(png)).width, 24, 'png width');
        const jpeg = await codec.bakeOrientation(fx.jpeg, '.jpeg');
        toBe(formatOf(jpeg), 'jpeg', 'jpeg format');
        await rejects(() => codec.bakeOrientation(fx.jpeg, '.gif'), '.gif');
        await rejects(() => codec.bakeOrientation(fx.jpeg, '.tiff'), '.tiff');
      },
    },
    {
      name: 'thumbnail: longer side at most maxSize, ratio kept, JPEG',
      async run(codec) {
        const out = await codec.thumbnail(fx.large, 100, 75);
        toBe(formatOf(out), 'jpeg', 'format');
        const info = await codec.probe(out);
        toBe(info.width, 100, 'width');
        toBe(info.height, 50, 'height');
      },
    },
    {
      name: 'thumbnail: a picture smaller than maxSize is not enlarged',
      async run(codec) {
        const info = await codec.probe(await codec.thumbnail(fx.jpeg, 400, 75));
        toBe(info.width, 60, 'width');
        toBe(info.height, 30, 'height');
      },
    },
    {
      name: 'thumbnail: a PNG gives a JPEG; a very small maxSize keeps at least 1 pixel',
      async run(codec) {
        const out = await codec.thumbnail(fx.png, 1, 75);
        toBe(formatOf(out), 'jpeg', 'format');
        const info = await codec.probe(out);
        toBe(info.width, 1, 'width');
        ok(info.height >= 1, 'height at least 1');
      },
    },
    {
      name: 'thumbnail rejects bytes that are not a picture',
      async run(codec) {
        await rejects(() => codec.thumbnail(fx.notAnImage, 100, 75), 'thumbnail');
      },
    },
    {
      name: 'encode: raw RGB to PNG (pixels exact) and to JPEG (pixels within a tolerance)',
      async run(codec) {
        const w = 16;
        const h = 8;
        const data = new Uint8Array(w * h * 3);
        for (let i = 0; i < w * h; i++) {
          data[i * 3] = 200;
          data[i * 3 + 1] = 100;
          data[i * 3 + 2] = 40;
        }
        const png = await codec.encode({ width: w, height: h, channels: 3, data }, 'png');
        toBe(formatOf(png), 'png', 'png format');
        const back = await codec.decode(png);
        toBe(back.width, w, 'png width');
        toBe(back.height, h, 'png height');
        const p = pixel(back, 5, 3);
        ok(closeTo(p, [200, 100, 40], 1), `png pixel ${p}`);
        const jpeg = await codec.encode({ width: w, height: h, channels: 3, data }, 'jpeg', 90);
        toBe(formatOf(jpeg), 'jpeg', 'jpeg format');
        const j = pixel(await codec.decode(jpeg), 8, 4);
        ok(closeTo(j, [200, 100, 40], 12), `jpeg pixel ${j}`);
      },
    },
    {
      name: 'encode: one channel (grey) and four channels (with alpha) to PNG',
      async run(codec) {
        const w = 8;
        const h = 4;
        const grey = new Uint8Array(w * h).fill(77);
        const g = await codec.decode(
          await codec.encode({ width: w, height: h, channels: 1, data: grey }, 'png'),
        );
        const gp = pixel(g, 3, 2);
        ok(closeTo(gp, [77, 77, 77], 1), `grey pixel ${gp}`);
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = 10;
          rgba[i * 4 + 1] = 220;
          rgba[i * 4 + 2] = 30;
          rgba[i * 4 + 3] = 255;
        }
        const c = await codec.decode(
          await codec.encode({ width: w, height: h, channels: 4, data: rgba }, 'png'),
        );
        const cp = pixel(c, 1, 1);
        ok(closeTo(cp, [10, 220, 30], 1), `rgba pixel ${cp}`);
      },
    },
    {
      name: 'decode: the size, a channel count of 1, 3 or 4 and data of width x height x channels',
      async run(codec) {
        const img = await codec.decode(fx.png);
        toBe(img.width, 24, 'width');
        toBe(img.height, 12, 'height');
        ok([1, 3, 4].includes(img.channels), `channels ${img.channels}`);
        toBe(img.data.length, 24 * 12 * img.channels, 'data length');
      },
    },
    {
      name: 'decode rejects bytes that are not a picture',
      async run(codec) {
        await rejects(() => codec.decode(fx.notAnImage), 'decode');
      },
    },
  ];
  if (fx.webp) {
    const webp = fx.webp;
    cases.push({
      name: 'probe and bakeOrientation accept a WebP',
      async run(codec) {
        const info = await codec.probe(webp);
        toBe(info.width, 33, 'width');
        toBe(info.height, 17, 'height');
        toBe(formatOf(await codec.bakeOrientation(webp, '.webp')), 'webp', 'format');
      },
    });
  }
  if (options.keepsOriginalWithoutOrientation !== undefined) {
    const keeps = options.keepsOriginalWithoutOrientation;
    cases.push({
      name: keeps
        ? 'bakeOrientation returns the original bytes when there is no orientation'
        : 'bakeOrientation re-encodes (a picture of the right size) when there is no orientation',
      async run(codec) {
        const out = await codec.bakeOrientation(fx.jpeg, '.jpg');
        if (keeps) bytesEqual(out, fx.jpeg, 'bytes');
        else toBe((await codec.probe(out)).width, 60, 'width');
      },
    });
  }
  return cases;
}
