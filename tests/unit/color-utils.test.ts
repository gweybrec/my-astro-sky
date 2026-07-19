import { describe, it, expect } from 'vitest';
import { lerpColor } from '../../src/color-utils';

describe('lerpColor', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerpColor('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0)).toBe('rgba(0, 0, 0, 1)');
    expect(lerpColor('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 1)).toBe('rgba(200, 100, 50, 1)');
  });

  it('interpolates channels at the midpoint', () => {
    expect(lerpColor('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0.5)).toBe('rgba(100, 50, 25, 1)');
  });

  it('interpolates alpha', () => {
    expect(lerpColor('rgba(0, 0, 0, 0.2)', 'rgba(0, 0, 0, 0.8)', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('clamps t outside [0,1]', () => {
    expect(lerpColor('rgb(10, 10, 10)', 'rgb(20, 20, 20)', -1)).toBe('rgba(10, 10, 10, 1)');
    expect(lerpColor('rgb(10, 10, 10)', 'rgb(20, 20, 20)', 2)).toBe('rgba(20, 20, 20, 1)');
  });

  it('falls back to white on unparseable input', () => {
    expect(lerpColor('nope', 'rgb(0,0,0)', 0)).toBe('rgba(255, 255, 255, 1)');
  });
});
