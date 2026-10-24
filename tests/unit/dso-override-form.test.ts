import { describe, it, expect } from 'vitest';
import {
  buildDsoOverride,
  dsoConstellationOptions,
  dsoOverrideForm,
  shouldOverrideConstellation,
  shouldOverrideType,
} from '@myastrosky/core/catalog/dso-override-form';

describe('shouldOverrideConstellation', () => {
  it('returns false for empty string (no selection)', () => {
    expect(shouldOverrideConstellation('', 'Ori')).toBe(false);
  });

  it('returns false when selected equals base constellation', () => {
    expect(shouldOverrideConstellation('Ori', 'Ori')).toBe(false);
  });

  it('returns true when selected differs from base constellation', () => {
    expect(shouldOverrideConstellation('Tau', 'Ori')).toBe(true);
  });

  it('returns true for any non-empty selection when base is null', () => {
    expect(shouldOverrideConstellation('Ori', null)).toBe(true);
  });

  it('returns true for any non-empty selection when base is undefined', () => {
    expect(shouldOverrideConstellation('Ori', undefined)).toBe(true);
  });

  it('returns false for empty string even when base is null', () => {
    expect(shouldOverrideConstellation('', null)).toBe(false);
  });

  it('returns false for empty string even when base is undefined', () => {
    expect(shouldOverrideConstellation('', undefined)).toBe(false);
  });

  it('is case-sensitive (different case is treated as an override)', () => {
    expect(shouldOverrideConstellation('ori', 'Ori')).toBe(true);
  });
});

describe('shouldOverrideType', () => {
  it('returns false for empty string (no selection)', () => {
    expect(shouldOverrideType('', 'EN')).toBe(false);
  });

  it('returns false when selected equals base type', () => {
    expect(shouldOverrideType('EN', 'EN')).toBe(false);
  });

  it('returns true when selected differs from base type', () => {
    expect(shouldOverrideType('RN', 'EN')).toBe(true);
  });

  it('returns true for any non-empty selection when base is null', () => {
    expect(shouldOverrideType('GC', null)).toBe(true);
  });

  it('returns true for any non-empty selection when base is undefined', () => {
    expect(shouldOverrideType('OC', undefined)).toBe(true);
  });

  it('returns false for empty string even when base is null', () => {
    expect(shouldOverrideType('', null)).toBe(false);
  });
});

describe('the object editor form', () => {
  const base = { constellation: 'And', type: 'GxS' };
  const at = { ra: 10.6847, dec: 41.269 };
  const empty = () => dsoOverrideForm(undefined, base);

  it("starts from the user's override, and from the catalogue's constellation and type", () => {
    expect(dsoOverrideForm({ names: { fr: 'Andromède' }, rating: 4 }, base)).toEqual({
      names: { fr: 'Andromède', en: '', es: '', de: '' },
      ra: '',
      dec: '',
      constellation: 'And',
      rating: '4',
      difficulty: '',
      type: 'GxS',
    });
  });

  it('keeps nothing when the fields show the catalogue', () => {
    expect(buildDsoOverride(empty(), at, base)).toEqual({});
  });

  it('keeps the typed names, trimmed, the moved position, the ratings in 1–5 and a changed type or constellation', () => {
    const form = empty();
    form.names.en = '  Andromeda  ';
    form.ra = '11';
    form.dec = String(at.dec);
    form.rating = '6';
    form.difficulty = '2';
    form.type = 'Gx';
    form.constellation = 'Cas';
    expect(buildDsoOverride(form, at, base)).toEqual({
      names: { en: 'Andromeda' },
      ra: 11,
      constellation: 'Cas',
      difficulty: 2,
      type: 'Gx',
    });
  });

  it('refuses a right ascension or a declination out of range', () => {
    expect(() => buildDsoOverride({ ...empty(), ra: '360' }, at, base)).toThrow();
    expect(() => buildDsoOverride({ ...empty(), dec: '-91' }, at, base)).toThrow();
  });

  it('lists each constellation once (Serpens has two parts), by its name', () => {
    expect(
      dsoConstellationOptions([
        { id: 'Ser', displayName: 'Serpent' },
        { id: 'And', displayName: 'Andromède' },
        { id: 'Ser', displayName: 'Serpent' },
      ]),
    ).toEqual([
      { id: 'And', name: 'Andromède' },
      { id: 'Ser', name: 'Serpent' },
    ]);
  });
});
