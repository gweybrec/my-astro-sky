/**
 * TIFF PackBits (Compression = 32773) decoder.
 *
 * Control byte n (signed, -128..127):
 *   0..127    -> copy the next n+1 bytes literally
 *   -1..-127  -> repeat the following byte (1-n) times, i.e. (-n)+1 times
 *   -128      -> no-op (some encoders emit it as padding)
 *
 * Decodes until `out` is filled or `src` is exhausted, whichever comes first — real
 * files sometimes have a final control byte with no more data than `out` needs.
 * Returns the number of bytes written to `out`.
 */
export function packBitsDecode(src: Uint8Array, out: Uint8Array): number {
  let si = 0;
  let oi = 0;
  while (si < src.length && oi < out.length) {
    const n = (src[si++] << 24) >> 24; // sign-extend byte
    if (n >= 0) {
      const count = n + 1;
      for (let i = 0; i < count && si < src.length && oi < out.length; i++) {
        out[oi++] = src[si++];
      }
    } else if (n !== -128) {
      const count = 1 - n;
      if (si >= src.length) break;
      const byte = src[si++];
      for (let i = 0; i < count && oi < out.length; i++) {
        out[oi++] = byte;
      }
    }
    // n === -128: no-op, consume nothing further
  }
  return oi;
}
