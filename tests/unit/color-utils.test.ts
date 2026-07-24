import { describe, it, expect } from 'vitest';
import { lerpColor, filterBadgeColors, cssColorToHex, hexToRgba } from '../../src/color-utils';

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

describe('filterBadgeColors', () => {
  it('derives a translucent fill and a stronger border from the catalog hex', () => {
    // #b42828 is the Ha hue seeded into resources/filters.json.
    expect(filterBadgeColors('#b42828')).toEqual({
      bg: 'rgba(180, 40, 40, 0.4)',
      text: 'rgb(221, 158, 158)',
      border: 'rgba(180, 40, 40, 0.55)',
    });
  });

  it('lightens dark hues so the label stays readable', () => {
    // Dual-band violet is far too dark to use as text directly.
    const { text } = filterBadgeColors('#501e96');
    const [r, g, b] = text.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(0x50);
    expect(g).toBeGreaterThan(0x1e);
    expect(b).toBeGreaterThan(0x96);
  });

  it('never produces an out-of-range channel, even from white', () => {
    const { text } = filterBadgeColors('#ffffff');
    expect(text).toBe('rgb(255, 255, 255)');
  });

  it('accepts shorthand hex', () => {
    expect(filterBadgeColors('#abc').bg).toBe('rgba(170, 187, 204, 0.4)');
  });
});

describe('cssColorToHex / hexToRgba (moved here from observation-windows)', () => {
  it('normalises shorthand and rgb() input', () => {
    expect(cssColorToHex('#abc')).toBe('#aabbcc');
    expect(cssColorToHex('rgba(180,40,40,0.4)')).toBe('#b42828');
  });

  it('falls back to a neutral blue on unparseable input', () => {
    expect(cssColorToHex('nonsense')).toBe('#3b6fd0');
  });

  it('converts a hex to rgba at the given alpha', () => {
    expect(hexToRgba('#12ab34', 0.3)).toBe('rgba(18, 171, 52, 0.3)');
  });
});
