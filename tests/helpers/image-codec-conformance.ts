/** Runs the `ImageCodec` conformance cases under Vitest, with pictures made by `sharp`. */
import sharp from 'sharp';
import { describe, it } from 'vitest';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';
import {
  imageCodecConformanceCases,
  type ImageCodecConformanceOptions,
  type ImageCodecFixtures,
} from '@myastrosky/core/testing/image-codec-conformance';

const solid = (w: number, h: number, rgb: [number, number, number]) =>
  sharp(Buffer.from(Array.from({ length: w * h }, () => rgb).flat()), {
    raw: { width: w, height: h, channels: 3 },
  });

/** A 60 x 30 picture, blue with a red 10 x 10 top-left corner. */
function cornerRaw(): Buffer {
  const raw = Buffer.alloc(60 * 30 * 3);
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 3;
      const red = x < 10 && y < 10;
      raw[i] = red ? 255 : 0;
      raw[i + 1] = 0;
      raw[i + 2] = red ? 0 : 255;
    }
  }
  return raw;
}

export async function buildImageFixtures(): Promise<ImageCodecFixtures> {
  const bytes = (b: Buffer): Uint8Array => new Uint8Array(b);
  return {
    jpeg: bytes(await solid(60, 30, [90, 120, 150]).jpeg({ quality: 90 }).toBuffer()),
    png: bytes(await solid(24, 12, [10, 200, 90]).png().toBuffer()),
    webp: bytes(await solid(33, 17, [200, 30, 30]).webp().toBuffer()),
    orientedJpeg: bytes(
      await sharp(cornerRaw(), { raw: { width: 60, height: 30, channels: 3 } })
        .withMetadata({ orientation: 6 })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer(),
    ),
    large: bytes(await solid(400, 200, [30, 60, 90]).jpeg().toBuffer()),
    notAnImage: new TextEncoder().encode('this is not a picture, just some text'),
  };
}

export function describeImageCodecConformance(
  name: string,
  open: () => ImageCodec,
  options: ImageCodecConformanceOptions = {},
): void {
  describe(`ImageCodec conformance: ${name}`, async () => {
    const cases = imageCodecConformanceCases(await buildImageFixtures(), options);
    for (const c of cases) {
      it(c.name, () => c.run(open()));
    }
  });
}
