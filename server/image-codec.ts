import sharp from 'sharp';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';

const FORMAT_OF_EXT: Record<string, 'jpeg' | 'png' | 'webp'> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
};

const toBytes = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** The image codec of the server: the `sharp` calls the upload route made before the port existed. */
export function createSharpImageCodec(): ImageCodec {
  return {
    async probe(bytes) {
      const m = await sharp(bytes).metadata();
      if (!m.width || !m.height) throw new Error('Unreadable image');
      return {
        width: m.width,
        height: m.height,
        ...(m.orientation ? { orientation: m.orientation } : {}),
      };
    },

    async bakeOrientation(bytes, ext) {
      const format = FORMAT_OF_EXT[ext];
      if (!format) throw new Error(`Unsupported image format: ${ext}`);
      return toBytes(await sharp(bytes).rotate().toFormat(format).toBuffer());
    },

    async thumbnail(bytes, maxSize, quality) {
      const m = await sharp(bytes).metadata();
      const w = m.width ?? 0;
      const h = m.height ?? 0;
      const scale = Math.min(1, maxSize / Math.max(w, h, 1));
      return toBytes(
        await sharp(bytes)
          .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
          .jpeg({ quality })
          .toBuffer(),
      );
    },

    async encode(raw, format, quality) {
      const img = sharp(raw.data, {
        raw: { width: raw.width, height: raw.height, channels: raw.channels },
      });
      return toBytes(
        await (format === 'jpeg' ? img.jpeg(quality ? { quality } : {}) : img.png()).toBuffer(),
      );
    },
  };
}
