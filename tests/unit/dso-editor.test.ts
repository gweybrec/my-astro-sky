import { describe, it, expect } from 'vitest';
import { shouldOverrideConstellation, shouldOverrideType } from '../../src/dso-editor';

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
