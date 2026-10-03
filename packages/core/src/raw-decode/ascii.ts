const CHUNK = 8192;

/**
 * Decode bytes `[start, end)` of `buf` as 7-bit ASCII: each byte is masked with `0x7f`, exactly
 * like Node's `buf.toString('ascii', start, end)`. Clamps like `subarray`; built in chunks so a
 * large header never hits the argument-count limit of `String.fromCharCode`.
 */
export function bytesToAscii7(buf: Uint8Array, start = 0, end: number = buf.length): string {
  const view = buf.subarray(start, end);
  let out = '';
  for (let i = 0; i < view.length; i += CHUNK) {
    const n = Math.min(CHUNK, view.length - i);
    const codes = new Array<number>(n);
    for (let k = 0; k < n; k++) codes[k] = view[i + k]! & 0x7f;
    out += String.fromCharCode(...codes);
  }
  return out;
}
