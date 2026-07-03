import type { DSO } from './types';
import type { UnifiedSearchResult } from './search';

export function normalizeChipKey(input: string): string {
  return input.trim().toUpperCase();
}

export function shouldApplyChipSearchResults(currentInputValue: string, chipId: string): boolean {
  return normalizeChipKey(currentInputValue) === normalizeChipKey(chipId);
}

export function matchesChipDSO(result: UnifiedSearchResult, chipId: string): boolean {
  const chipKey = normalizeChipKey(chipId);
  if (result.type !== 'dso' || !result.dso) return false;

  if (normalizeChipKey(String(result.dso.id ?? '')) === chipKey) {
    return true;
  }

  if (!Array.isArray(result.dso.catalogs)) {
    return false;
  }

  return result.dso.catalogs.some((catalogId) => normalizeChipKey(String(catalogId)) === chipKey);
}

export function findChipDSOResult(
  results: UnifiedSearchResult[],
  chipId: string,
): UnifiedSearchResult | undefined {
  return results.find((result) => matchesChipDSO(result, chipId));
}

export function buildFallbackDSOResult(dso: DSO): UnifiedSearchResult {
  return {
    type: 'dso',
    dso,
    label: dso.displayName ? `${dso.id} – ${dso.displayName}` : dso.id,
    ra: dso.ra,
    dec: dso.dec,
    mag: dso.mag ?? 99,
    score: 0,
  };
}
