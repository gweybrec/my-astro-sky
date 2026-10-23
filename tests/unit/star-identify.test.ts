import { describe, expect, it } from 'vitest';
import { raDecFromSexagesimal, starDisplayLabel } from '@myastrosky/core/star-identify';
import type { Star } from '@myastrosky/core/types';

const star = (over: Partial<Star>): Star => ({
  hip: 102098,
  ra: 310.36,
  dec: 45.28,
  mag: 1.25,
  bv: 0.09,
  ...over,
});

describe('starDisplayLabel', () => {
  it('names a star by its proper name and Bayer letter', () => {
    expect(starDisplayLabel(star({ name: 'Deneb', bayer: 'α', constellation: 'Cyg' }))).toBe(
      'Deneb (α Cyg)',
    );
    expect(starDisplayLabel(star({ name: 'Deneb' }))).toBe('Deneb');
  });

  it('falls back on the designation, the Flamsteed number, then the Hipparcos number', () => {
    expect(starDisplayLabel(star({ desig: 'β', constellation: 'Cyg' }))).toBe('β Cyg');
    expect(starDisplayLabel(star({ flam: '61', constellation: 'Cyg' }))).toBe('61 Cyg');
    expect(starDisplayLabel(star({ constellation: 'Cyg' }))).toBe('HIP 102098 (Cyg, mag 1.3)');
    expect(starDisplayLabel(star({}))).toBe('HIP 102098 (?, mag 1.3)');
  });
});

describe('raDecFromSexagesimal', () => {
  const fields = (
    raHours: string,
    raMinutes: string,
    raSeconds: string,
    decDegrees: string,
    decMinutes: string,
    decSeconds: string,
  ) => ({
    raHours,
    raMinutes,
    raSeconds,
    decDegrees,
    decMinutes,
    decSeconds,
  });

  it('turns h m s and ° \' " into degrees', () => {
    const p = raDecFromSexagesimal(fields('20', '41', '25.9', '45', '16', '49'))!;
    expect(p.ra).toBeCloseTo(310.3579, 4);
    expect(p.dec).toBeCloseTo(45.2803, 4);
  });

  it('keeps the sign of a southern declination, also under one degree', () => {
    expect(raDecFromSexagesimal(fields('5', '35', '17', '-5', '23', '28'))!.dec).toBeCloseTo(
      -5.3911,
      4,
    );
    expect(raDecFromSexagesimal(fields('0', '0', '0', '-0', '30', '0'))!.dec).toBeCloseTo(-0.5, 6);
  });

  it('refuses an empty field, a word or a value out of its range', () => {
    expect(raDecFromSexagesimal(fields('', '0', '0', '0', '0', '0'))).toBeNull();
    expect(raDecFromSexagesimal(fields('a', '0', '0', '0', '0', '0'))).toBeNull();
    expect(raDecFromSexagesimal(fields('24', '0', '0', '0', '0', '0'))).toBeNull();
    expect(raDecFromSexagesimal(fields('0', '60', '0', '0', '0', '0'))).toBeNull();
    expect(raDecFromSexagesimal(fields('0', '0', '0', '90', '0', '0'))).toBeNull();
    expect(raDecFromSexagesimal(fields('0', '0', '0', '0', '0', '-1'))).toBeNull();
  });
});
