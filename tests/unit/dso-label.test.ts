import { describe, expect, it } from 'vitest';
import { isMessier, formatDsoLabel, formatCatalogId, dsoLabelVisible } from '../../src/dso-label';
import type { DSO } from '../../src/types';

function dso(id: string, over: Partial<DSO> = {}): DSO {
  return {
    id,
    ra: 0,
    dec: 0,
    mag: 8,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    type: 'Gx',
    ...over,
  } as unknown as DSO;
}

describe('isMessier', () => {
  it('accepts M<n> but not M0-prefixed ids', () => {
    expect(isMessier('M31')).toBe(true);
    expect(isMessier('M1')).toBe(true);
    expect(isMessier('M0abc')).toBe(false);
    expect(isMessier('NGC224')).toBe(false);
  });
});

describe('formatDsoLabel', () => {
  it('shows Messier ids unchanged', () => {
    expect(formatDsoLabel(dso('M31'))).toBe('M31');
  });

  it('spaces catalog prefixes', () => {
    expect(formatDsoLabel(dso('NGC7000'))).toBe('NGC 7000');
    expect(formatDsoLabel(dso('IC1805'))).toBe('IC 1805');
    expect(formatDsoLabel(dso('LBN552'))).toBe('LBN 552');
    expect(formatDsoLabel(dso('LDN1235'))).toBe('LDN 1235');
    expect(formatDsoLabel(dso('SH2-155'))).toBe('Sh2-155');
    expect(formatDsoLabel(dso('vdB141'))).toBe('vdB 141');
    expect(formatDsoLabel(dso('Abell21'))).toBe('Abell 21');
    expect(formatDsoLabel(dso('Barnard33'))).toBe('Barnard 33');
  });

  it('uses the proper name for LPN objects, falling back to the stripped id', () => {
    expect(formatDsoLabel(dso('LPN-7', { displayName: 'Cave Nebula' }))).toBe('Cave Nebula');
    expect(formatDsoLabel(dso('LPN-7', { displayName: '' }))).toBe('7');
  });
});

describe('formatCatalogId', () => {
  it('formats an alias id, not the DSO’s own primary id', () => {
    // M1's own id is Messier, but formatting its NGC alias should read as NGC.
    const m1 = dso('M1', { catalogs: ['M1', 'NGC1952'] });
    expect(formatCatalogId('NGC1952', m1)).toBe('NGC 1952');
    expect(formatDsoLabel(m1)).toBe('M1');
  });
});

describe('dsoLabelVisible', () => {
  it('shows Messier labels only past scale 100', () => {
    expect(dsoLabelVisible(dso('M31'), 10, { scale: 100 })).toBe(false);
    expect(dsoLabelVisible(dso('M31'), 10, { scale: 101 })).toBe(true);
  });

  it('shows non-Messier labels only past scale 300 and rx > 4px', () => {
    expect(dsoLabelVisible(dso('NGC7000'), 10, { scale: 300 })).toBe(false);
    expect(dsoLabelVisible(dso('NGC7000'), 4, { scale: 500 })).toBe(false);
    expect(dsoLabelVisible(dso('NGC7000'), 5, { scale: 301 })).toBe(true);
  });
});
