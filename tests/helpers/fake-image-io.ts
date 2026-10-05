import type { BlobStore } from '@myastrosky/core/ports/blob-store';
import type { ImageCodec, ImageInfo } from '@myastrosky/core/ports/image-codec';

/** A blob store in memory; `store` is readable by the test. */
export function memoryBlobStore(): BlobStore & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(name, bytes) {
      store.set(name, bytes);
    },
    async get(name) {
      return store.get(name) ?? null;
    },
    async size(name) {
      return store.get(name)?.byteLength ?? null;
    },
    async remove(name) {
      store.delete(name);
    },
  };
}

export interface FakeImageCodec extends ImageCodec {
  /** What `probe` returns; set `null` to make it reject. */
  info: ImageInfo | null;
  failBake: boolean;
  failThumbnail: boolean;
}

/** A codec that does no image work: bytes pass through, a thumbnail is the byte `0x7a`. */
export function fakeImageCodec(): FakeImageCodec {
  const codec: FakeImageCodec = {
    info: { width: 100, height: 50 },
    failBake: false,
    failThumbnail: false,
    async probe() {
      if (!codec.info) throw new Error('not an image');
      return codec.info;
    },
    async bakeOrientation(bytes) {
      if (codec.failBake) throw new Error('bake failed');
      return bytes;
    },
    async thumbnail() {
      if (codec.failThumbnail) throw new Error('thumbnail failed');
      return new Uint8Array([0x7a]);
    },
    async encode() {
      return new Uint8Array([1]);
    },
  };
  return codec;
}
