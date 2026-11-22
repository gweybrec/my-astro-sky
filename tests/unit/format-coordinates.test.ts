import { describe, it, expect } from 'vitest';
import { formatDec, formatRA } from '@myastrosky/core/format-utils';

describe('formatRA', () => {
  it('writes hours, minutes and seconds to a tenth', () => {
    expect(formatRA(0)).toBe('0h 00m 00.0s');
    expect(formatRA(314)).toBe('20h 56m 00.0s');
    expect(formatRA(83.8221)).toBe('5h 35m 17.3s');
  });

  it('carries a second that rounds up into the minute, never "60.0s"', () => {
    // 314.7° is 20h 58m 48s exactly, which floating point puts a hair below
    expect(formatRA(314.7)).toBe('20h 58m 48.0s');
    expect(formatRA(15 * (1 - 0.01 / 3600))).toBe('1h 00m 00.0s');
  });

  it('wraps a value that rounds up to 24h back to 0h', () => {
    expect(formatRA(360 - 1e-9)).toBe('0h 00m 00.0s');
  });
});

describe('formatDec', () => {
  it('writes the sign, degrees, minutes and seconds', () => {
    expect(formatDec(44)).toBe('+44° 00\' 00"');
    expect(formatDec(-5.391)).toBe('−5° 23\' 28"');
  });

  it('carries a second that rounds up into the minute, never 60"', () => {
    expect(formatDec(44.3)).toBe('+44° 18\' 00"');
    expect(formatDec(43.8)).toBe('+43° 48\' 00"');
    expect(formatDec(-(1 - 0.2 / 3600))).toBe('−1° 00\' 00"');
  });
});
