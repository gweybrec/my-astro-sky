/**
 * TIFF LZW (Compression = 5) decoder — the classic TIFF variant: 9-to-12-bit codes,
 * MSB-first bit packing, and the "early change" quirk (the code width grows one code
 * earlier than the GIF/plain-LZW convention).
 *
 * CLEAR = 256, EOI = 257, first table entry = 258.
 * Decodes until EOI, `out` is full, or `src` is exhausted. Returns bytes written.
 */
const CLEAR_CODE = 256;
const EOI_CODE = 257;
const MAX_CODE = 4094; // 12-bit codes, last usable table slot before a Clear is required

export function lzwDecode(src: Uint8Array, out: Uint8Array): number {
  let bitBuf = 0;
  let bitCount = 0;
  let bytePos = 0;

  function nextCode(codeWidth: number): number {
    while (bitCount < codeWidth) {
      if (bytePos >= src.length) return EOI_CODE;
      bitBuf = (bitBuf << 8) | src[bytePos++];
      bitCount += 8;
    }
    bitCount -= codeWidth;
    return (bitBuf >> bitCount) & ((1 << codeWidth) - 1);
  }

  let oi = 0;
  function emit(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length && oi < out.length; i++) out[oi++] = bytes[i];
  }

  // Dictionary: entries 0-255 are single bytes; 258+ are built strings.
  let table: Uint8Array[] = [];
  let codeWidth = 9;
  let nextCodeValue = 258;
  let prevEntry: Uint8Array | null = null;

  function resetTable(): void {
    table = new Array(258);
    for (let i = 0; i < 256; i++) table[i] = Uint8Array.of(i);
    codeWidth = 9;
    nextCodeValue = 258;
    prevEntry = null;
  }
  resetTable();

  while (oi < out.length) {
    const code = nextCode(codeWidth);
    if (code === EOI_CODE) break;
    if (code === CLEAR_CODE) {
      resetTable();
      continue;
    }

    let entry: Uint8Array;
    if (code < nextCodeValue && table[code] !== undefined) {
      entry = table[code];
    } else if (code === nextCodeValue && prevEntry) {
      // The one legal case of a code not yet in the table: previous string + its own first byte.
      entry = new Uint8Array(prevEntry.length + 1);
      entry.set(prevEntry);
      entry[prevEntry.length] = prevEntry[0];
    } else {
      // Corrupt stream — stop rather than emit garbage.
      break;
    }

    emit(entry);

    if (prevEntry && nextCodeValue <= MAX_CODE) {
      const newEntry = new Uint8Array(prevEntry.length + 1);
      newEntry.set(prevEntry);
      newEntry[prevEntry.length] = entry[0];
      table[nextCodeValue] = newEntry;
      nextCodeValue++;
      // Early change, as libtiff decodes it: a TIFF encoder widens once its next free code
      // passes 511/1023/2047 (i.e. reaches 512/1024/2048). The decoder builds each entry
      // one code later than the encoder, so it widens one entry sooner, at 511/1023/2047.
      if (nextCodeValue === 511) codeWidth = 10;
      else if (nextCodeValue === 1023) codeWidth = 11;
      else if (nextCodeValue === 2047) codeWidth = 12;
    }

    prevEntry = entry;
  }

  return oi;
}
