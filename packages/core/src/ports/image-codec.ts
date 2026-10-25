export interface ImageInfo {
  width: number;
  height: number;
  /** EXIF orientation 1..8, when present. */ orientation?: number;
}
export interface ImageCodec {
  /** Reads the size and the orientation. Rejects when the bytes are not a readable image. */
  probe(bytes: Uint8Array): Promise<ImageInfo>;
  /** Re-encodes in the same format with the EXIF orientation applied to the pixels. `ext` is the lower-case file extension, with its dot. */
  bakeOrientation(bytes: Uint8Array, ext: string): Promise<Uint8Array>;
  /** A JPEG no larger than `maxSize` on its longer side (never enlarged), at the given quality. */
  thumbnail(bytes: Uint8Array, maxSize: number, quality: number): Promise<Uint8Array>;
  /** Encodes raw pixels (8-bit, `channels` 1, 3 or 4, row by row) as an image. Used to turn a decoded FITS, TIFF or XISF into a picture; the server implements it with `sharp`. */
  encode(
    raw: { width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array },
    format: 'jpeg' | 'png',
    quality?: number,
  ): Promise<Uint8Array>;
  /** Decodes an image (PNG, JPEG...) to raw 8-bit pixels, row by row, with the channels the file has (1, 3 or 4). Rejects when the bytes are not a readable image. Used for the terrain tiles of the horizon. */
  decode(
    bytes: Uint8Array,
  ): Promise<{ width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array }>;
}
