import { describe, it, expect } from 'vitest';
import { bytesToAscii7 } from '@myastrosky/core/raw-decode/ascii';

describe('bytesToAscii7', () => {
  it('round-trips plain ASCII', () => {
    const text = 'SIMPLE  =                    T / FITS header\0end';
    expect(bytesToAscii7(new TextEncoder().encode(text))).toBe(text);
  });

  it('masks the high bit like Buffer ascii decoding, for every byte value', () => {
    for (let b = 0; b < 256; b++) {
      expect(bytesToAscii7(Uint8Array.of(b))).toBe(Buffer.from([b]).toString('ascii'));
    }
    expect(bytesToAscii7(Uint8Array.of(0x80))).toBe('\0');
    expect(bytesToAscii7(Uint8Array.of(0xe9))).toBe('i');
  });

  it('decodes a range inside a larger array with a non-zero byteOffset', () => {
    const backing = new Uint8Array(32).map((_, i) => 0x41 + (i % 26));
    const sub = backing.subarray(5); // byteOffset 5
    expect(bytesToAscii7(sub, 2, 6)).toBe(Buffer.from(backing).toString('ascii', 7, 11));
    expect(bytesToAscii7(sub, 0, 3)).toBe('FGH');
  });

  it('clamps out-of-range bounds like subarray and defaults to the whole array', () => {
    const buf = Uint8Array.from([0x61, 0x62, 0x63]);
    expect(bytesToAscii7(buf, 1, 99)).toBe('bc');
    expect(bytesToAscii7(buf, 5, 9)).toBe('');
    expect(bytesToAscii7(buf)).toBe('abc');
  });

  it('handles inputs longer than 100 000 bytes', () => {
    const big = new Uint8Array(250_001).map((_, i) => i & 0xff);
    const out = bytesToAscii7(big);
    expect(out.length).toBe(big.length);
    expect(out).toBe(Buffer.from(big).toString('ascii'));
  });
});
