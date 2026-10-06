/**
 * The phone's `ImageCodec`, over the WebView's `createImageBitmap` and `OffscreenCanvas`.
 *
 * Differences from the server's `sharp` codec (accepted):
 * - `probe` reads the file's header (`image-header.ts`) and decodes nothing.
 * - `bakeOrientation` returns the original bytes when the orientation is absent or 1 (the server re-encodes).
 * - `decode` always gives 4 channels (a canvas has no other form); the horizon service reads the channel
 *   count it is given.
 * Every bitmap is closed as soon as it has been drawn, and canvases are released (size 0) after use.
 */
import { readImageHeader } from '@myastrosky/core/image-header';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';

const MIME_OF_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** The JPEG quality of a re-encoded picture. */
const BAKE_QUALITY = 0.9;

const asBlob = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart]);

async function canvasToBytes(
  canvas: OffscreenCanvas,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  try {
    const blob = await canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function context2d(canvas: OffscreenCanvas, readBack = false): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('No 2D canvas available');
  return ctx;
}

export function createBrowserImageCodec(): ImageCodec {
  return {
    async probe(bytes) {
      const h = readImageHeader(bytes);
      return {
        width: h.width,
        height: h.height,
        ...(h.orientation ? { orientation: h.orientation } : {}),
      };
    },

    async bakeOrientation(bytes, ext) {
      const mime = MIME_OF_EXT[ext];
      if (!mime) throw new Error(`Unsupported image format: ${ext}`);
      const { orientation } = readImageHeader(bytes);
      // Nothing to apply: the phone keeps the original file.
      if (!orientation || orientation === 1) return bytes;
      // 'from-image' makes the browser apply the EXIF orientation to the pixels it hands back.
      const bitmap = await createImageBitmap(asBlob(bytes), { imageOrientation: 'from-image' });
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        context2d(canvas).drawImage(bitmap, 0, 0);
        return await canvasToBytes(canvas, mime, mime === 'image/png' ? undefined : BAKE_QUALITY);
      } finally {
        bitmap.close();
      }
    },

    async thumbnail(bytes, maxSize, quality) {
      // Same rule as the server: the stored size, longer side at most `maxSize`, never enlarged.
      const { width: w, height: h } = readImageHeader(bytes);
      const scale = Math.min(1, maxSize / Math.max(w, h, 1));
      const width = Math.max(1, Math.round(w * scale));
      const height = Math.max(1, Math.round(h * scale));
      // Decoded straight at the reduced size: a large picture is never held at full size.
      const bitmap = await createImageBitmap(asBlob(bytes), {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
        imageOrientation: 'none',
      });
      try {
        const canvas = new OffscreenCanvas(width, height);
        context2d(canvas).drawImage(bitmap, 0, 0, width, height);
        // `quality` is the 1..100 of the server; the canvas takes 0..1.
        return await canvasToBytes(canvas, 'image/jpeg', quality / 100);
      } finally {
        bitmap.close();
      }
    },

    async encode(raw, format, quality) {
      const { width, height, channels, data } = raw;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, n = width * height; i < n; i++) {
        const s = i * channels;
        const d = i * 4;
        if (channels === 1) {
          rgba[d] = rgba[d + 1] = rgba[d + 2] = data[s];
          rgba[d + 3] = 255;
        } else {
          rgba[d] = data[s];
          rgba[d + 1] = data[s + 1];
          rgba[d + 2] = data[s + 2];
          rgba[d + 3] = channels === 4 ? data[s + 3] : 255;
        }
      }
      const canvas = new OffscreenCanvas(width, height);
      context2d(canvas).putImageData(new ImageData(rgba, width, height), 0, 0);
      return canvasToBytes(
        canvas,
        format === 'jpeg' ? 'image/jpeg' : 'image/png',
        format === 'jpeg' && quality ? quality / 100 : undefined,
      );
    },

    async decode(bytes) {
      readImageHeader(bytes); // rejects what is not a JPEG, PNG or WebP
      // Values must stay exact (terrain tiles carry data in the colours): no colour conversion, no premultiplying.
      const bitmap = await createImageBitmap(asBlob(bytes), {
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = context2d(canvas, true);
        ctx.drawImage(bitmap, 0, 0);
        const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const out = {
          width: image.width,
          height: image.height,
          channels: 4 as const,
          data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
        };
        canvas.width = 0;
        canvas.height = 0;
        return out;
      } finally {
        bitmap.close();
      }
    },
  };
}
