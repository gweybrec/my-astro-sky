import { describe, it, expect } from 'vitest';
import { packBitsDecode } from '../../server/raw-decode/codec/packbits';
import { lzwDecode } from '../../server/raw-decode/codec/lzw';
import { applyHorizontalPredictor } from '../../server/raw-decode/codec/predictor';

// ─── PackBits ───────────────────────────────────────────────────────────────────

describe('packBitsDecode', () => {
  it('copies a literal run (control byte 0..127)', () => {
    // control 3 -> copy next 4 bytes literally
    const src = Uint8Array.of(3, 0xaa, 0xbb, 0xcc, 0xdd);
    const out = new Uint8Array(4);
    expect(packBitsDecode(src, out)).toBe(4);
    expect(Array.from(out)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it('repeats a byte (control byte -1..-127)', () => {
    // control -3 (0xFD) -> repeat next byte (1-(-3))=4 times
    const src = Uint8Array.of(0xfd, 0x7f);
    const out = new Uint8Array(4);
    expect(packBitsDecode(src, out)).toBe(4);
    expect(Array.from(out)).toEqual([0x7f, 0x7f, 0x7f, 0x7f]);
  });

  it('treats -128 as a no-op', () => {
    const src = Uint8Array.of(0x80, 2, 0x01, 0x02, 0x03);
    const out = new Uint8Array(3);
    expect(packBitsDecode(src, out)).toBe(3);
    expect(Array.from(out)).toEqual([0x01, 0x02, 0x03]);
  });

  it('mixes literal and repeat runs across a full row', () => {
    // literal [1,2,3] then repeat 9 four times then literal [5]
    const src = Uint8Array.of(2, 1, 2, 3, 0xfe /* -2 -> 3x */, 9, 0, 5);
    const out = new Uint8Array(7);
    expect(packBitsDecode(src, out)).toBe(7);
    expect(Array.from(out)).toEqual([1, 2, 3, 9, 9, 9, 5]);
  });

  it('stops without overrunning when out is smaller than the encoded data', () => {
    const src = Uint8Array.of(9, ...Array(10).fill(0x11));
    const out = new Uint8Array(4);
    expect(packBitsDecode(src, out)).toBe(4);
    expect(Array.from(out)).toEqual([0x11, 0x11, 0x11, 0x11]);
  });
});

// ─── LZW ────────────────────────────────────────────────────────────────────────

/**
 * Minimal TIFF-style LZW encoder used only to build round-trip fixtures for the
 * decoder above (same table semantics: CLEAR=256, EOI=257, 9-12 bit codes, MSB-first
 * packing, early code-width change).
 */
function lzwEncode(data: number[]): Uint8Array {
  const CLEAR = 256;
  const EOI = 257;
  let table: Map<string, number>;
  let nextCode: number;
  let codeWidth: number;

  const bits: number[] = [];
  function emitCode(code: number) {
    for (let b = codeWidth - 1; b >= 0; b--) bits.push((code >> b) & 1);
  }
  function reset() {
    table = new Map();
    for (let i = 0; i < 256; i++) table.set(String(i), i);
    nextCode = 258;
    codeWidth = 9;
  }
  reset();
  emitCode(CLEAR);

  let w = '';
  for (const byte of data) {
    const wc = w === '' ? String(byte) : w + ',' + byte;
    if (table.has(wc)) {
      w = wc;
    } else {
      emitCode(table.get(w)!);
      if (nextCode <= 4094) {
        table.set(wc, nextCode);
        nextCode++;
        if (nextCode === 511) codeWidth = 10;
        else if (nextCode === 1023) codeWidth = 11;
        else if (nextCode === 2047) codeWidth = 12;
      }
      w = String(byte);
    }
  }
  if (w !== '') emitCode(table.get(w)!);
  emitCode(EOI);

  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}

describe('lzwDecode', () => {
  it('round-trips a short sequence through the matching encoder', () => {
    const data = [7, 7, 7, 8, 8, 7, 7, 6, 6];
    const encoded = lzwEncode(data);
    const out = new Uint8Array(data.length);
    expect(lzwDecode(encoded, out)).toBe(data.length);
    expect(Array.from(out)).toEqual(data);
  });

  it('round-trips a long repeating pattern that crosses the 9->10 bit code-width change', () => {
    const data: number[] = [];
    for (let i = 0; i < 600; i++) data.push(i % 4, (i * 7) % 251, 1, 2, 3);
    const encoded = lzwEncode(data);
    const out = new Uint8Array(data.length);
    expect(lzwDecode(encoded, out)).toBe(data.length);
    expect(Array.from(out)).toEqual(data);
  });

  it('round-trips data long enough to force multiple Clear codes and 11-12 bit widths', () => {
    const data: number[] = [];
    for (let i = 0; i < 3000; i++) data.push((i * 13 + 5) % 256, i % 3, i % 7);
    const encoded = lzwEncode(data);
    const out = new Uint8Array(data.length);
    expect(lzwDecode(encoded, out)).toBe(data.length);
    expect(Array.from(out)).toEqual(data);
  });

  it('stops at EOI without overrunning a larger output buffer', () => {
    const data = [1, 2, 3];
    const encoded = lzwEncode(data);
    const out = new Uint8Array(10).fill(0xff);
    const written = lzwDecode(encoded, out);
    expect(written).toBe(3);
    expect(Array.from(out.slice(0, 3))).toEqual(data);
  });
});

// ─── Predictor 2 (horizontal differencing) ──────────────────────────────────────

describe('applyHorizontalPredictor', () => {
  it('undoes 8-bit differencing for a mono row', () => {
    // Original samples: 10, 12, 15, 11 -> differenced: 10, 2, 3, -4 (mod 256)
    const row = Uint8Array.of(10, 2, 3, -4 & 0xff);
    applyHorizontalPredictor(row, 4, 1, 8, true);
    expect(Array.from(row)).toEqual([10, 12, 15, 11]);
  });

  it('undoes 8-bit differencing per-channel for RGB (samplesPerPixel=3)', () => {
    // R,G,B original: (10,20,30),(12,22,33) -> diffs: (10,20,30),(2,2,3)
    const row = Uint8Array.of(10, 20, 30, 2, 2, 3);
    applyHorizontalPredictor(row, 2, 3, 8, true);
    expect(Array.from(row)).toEqual([10, 20, 30, 12, 22, 33]);
  });

  it('undoes 16-bit differencing (little-endian)', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE(1000, 0);
    buf.writeUInt16LE(50, 2); // diff -> original 1050
    buf.writeUInt16LE(0xffff & (2000 - 1050), 4); // diff -> original 2000
    buf.writeUInt16LE(500, 6); // diff -> original 2500
    const row = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    applyHorizontalPredictor(row, 4, 1, 16, true);
    const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
    expect(view.getUint16(0, true)).toBe(1000);
    expect(view.getUint16(2, true)).toBe(1050);
    expect(view.getUint16(4, true)).toBe(2000);
    expect(view.getUint16(6, true)).toBe(2500);
  });

  it('undoes 32-bit differencing (big-endian)', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(100000, 0);
    buf.writeUInt32BE((50000 - 100000) >>> 0, 4);
    const row = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    applyHorizontalPredictor(row, 2, 1, 32, false);
    const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
    expect(view.getUint32(0, false)).toBe(100000);
    expect(view.getUint32(4, false)).toBe(50000);
  });

  it('throws for unsupported bit depths', () => {
    const row = new Uint8Array(8);
    expect(() => applyHorizontalPredictor(row, 2, 1, 64, true)).toThrow();
  });
});
