import { describe, it, expect } from 'vitest';
import { toByte } from '@myastrosky/core/raw-decode/linear-map';

describe('toByte — faithful linear [0,1] -> [0,255] mapping (no stretch)', () => {
  it('maps the endpoints exactly', () => {
    expect(toByte(0)).toBe(0);
    expect(toByte(1)).toBe(255);
  });

  it('clamps out-of-range values instead of wrapping', () => {
    expect(toByte(-0.5)).toBe(0);
    expect(toByte(2)).toBe(255);
  });

  it('maps NaN and infinities to 0 rather than propagating them', () => {
    expect(toByte(NaN)).toBe(0);
    expect(toByte(Infinity)).toBe(0);
    expect(toByte(-Infinity)).toBe(0);
  });

  it('rounds mid-range values with a fixed, explicit rule (round-half-up)', () => {
    // 0.5 * 255 = 127.5 -> rounds to 128 (Math.round convention)
    expect(toByte(0.5)).toBe(128);
    // Pin a value matching the real-world validation (M26.tiff mean 0.13022 -> reference JPEG byte 33)
    expect(toByte(0.13022)).toBe(33);
  });
});
