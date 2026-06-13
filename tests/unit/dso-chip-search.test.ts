import { describe, expect, it } from 'vitest';
import type { DSO } from '../../src/types';
import type { UnifiedSearchResult } from '../../src/search';
import {
  buildFallbackDSOResult,
  findChipDSOResult,
  matchesChipDSO,
  normalizeChipKey,
  shouldApplyChipSearchResults,
} from '../../src/dso-chip-search';

function makeDso(overrides: Partial<DSO> = {}): DSO {
  return {
    id: 'M1',
    ra: 83.633,
    dec: 22.0145,
    type: 'SNR',
    majAxis: 6,
    minAxis: 4,
    pa: 45,
    mag: 8.4,
    displayName: 'Crab Nebula',
    catalogs: ['M1', 'NGC1952'],
    emissionLines: null,
    constellation: 'Tau',
    rating: 5,
    difficulty: 3,
    ...overrides,
  };
}

function makeDsoResult(dso: DSO, score = 10): UnifiedSearchResult {
  return {
    type: 'dso',
    label: dso.displayName ? `${dso.id} – ${dso.displayName}` : dso.id,
    score,
    mag: dso.mag ?? 99,
    ra: dso.ra,
    dec: dso.dec,
    dso,
  };
}

describe('dso chip search helpers', () => {
  it('normalizes chip key using trim + uppercase', () => {
    expect(normalizeChipKey('  ngc1952  ')).toBe('NGC1952');
  });

  it('matches chip against primary DSO id and aliases case-insensitively', () => {
    const result = makeDsoResult(makeDso());

    expect(matchesChipDSO(result, 'm1')).toBe(true);
    expect(matchesChipDSO(result, 'ngc1952')).toBe(true);
    expect(matchesChipDSO(result, 'M42')).toBe(false);
  });

  it('finds the exact matching DSO result even if not first in the list', () => {
    const m110 = makeDsoResult(makeDso({ id: 'M110', catalogs: ['M110', 'NGC205'] }), 100);
    const m1 = makeDsoResult(makeDso({ id: 'M1', catalogs: ['M1', 'NGC1952'] }), 90);

    const exact = findChipDSOResult([m110, m1], 'M1');

    expect(exact).toBeDefined();
    expect(exact?.dso?.id).toBe('M1');
  });

  it('guards async result application when input no longer matches chip', () => {
    expect(shouldApplyChipSearchResults('M1', 'm1')).toBe(true);
    expect(shouldApplyChipSearchResults('  m1 ', 'M1')).toBe(true);
    expect(shouldApplyChipSearchResults('M10', 'M1')).toBe(false);
  });

  it('builds deterministic fallback result from DSO', () => {
    const dso = makeDso({ id: 'M1', displayName: 'Crab Nebula', mag: null });
    const fallback = buildFallbackDSOResult(dso);

    expect(fallback.type).toBe('dso');
    expect(fallback.dso?.id).toBe('M1');
    expect(fallback.label).toBe('M1 – Crab Nebula');
    expect(fallback.mag).toBe(99);
    expect(fallback.ra).toBe(dso.ra);
    expect(fallback.dec).toBe(dso.dec);
  });
});
