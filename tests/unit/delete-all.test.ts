import { describe, it, expect } from 'vitest';
import { buildDeleteSummaryLines, type DeleteOptions } from '../../src/delete-utils';

// Minimal stub: returns the key with simple {n}/{total} substitution
function t(key: string): string {
  const map: Record<string, string> = {
    'settings.deleteSummaryPhotoMeta': 'All photo metadata',
    'settings.deleteSummaryDsoOverrides': 'All DSO overrides',
    'settings.deleteSummaryCustomGear': 'All custom gear',
    'settings.deleteSummaryPhotosAll': 'All {n} photo(s)',
    'settings.deleteSummaryPhotosPartial': '{n} of {total} photo(s)',
  };
  return map[key] ?? key;
}

function opts(overrides: Partial<DeleteOptions> = {}): DeleteOptions {
  return {
    photoMetadata: false,
    dsoOverrides: false,
    customGear: false,
    photoIds: [],
    totalPhotos: 5,
    ...overrides,
  };
}

describe('buildDeleteSummaryLines', () => {
  it('returns empty array when nothing selected', () => {
    expect(buildDeleteSummaryLines(opts(), t)).toEqual([]);
  });

  it('returns photo metadata line only', () => {
    const lines = buildDeleteSummaryLines(opts({ photoMetadata: true }), t);
    expect(lines).toEqual(['All photo metadata']);
  });

  it('returns DSO overrides line only', () => {
    const lines = buildDeleteSummaryLines(opts({ dsoOverrides: true }), t);
    expect(lines).toEqual(['All DSO overrides']);
  });

  it('returns custom gear line only', () => {
    const lines = buildDeleteSummaryLines(opts({ customGear: true }), t);
    expect(lines).toEqual(['All custom gear']);
  });

  it('returns "all N photos" when all photos selected', () => {
    const lines = buildDeleteSummaryLines(
      opts({ photoIds: ['a', 'b', 'c', 'd', 'e'], totalPhotos: 5 }),
      t,
    );
    expect(lines).toEqual(['All 5 photo(s)']);
  });

  it('returns "N of total" when only some photos selected', () => {
    const lines = buildDeleteSummaryLines(
      opts({ photoIds: ['a', 'b'], totalPhotos: 5 }),
      t,
    );
    expect(lines).toEqual(['2 of 5 photo(s)']);
  });

  it('returns multiple lines when multiple options selected', () => {
    const lines = buildDeleteSummaryLines(
      opts({
        photoMetadata: true,
        dsoOverrides: true,
        customGear: true,
        photoIds: ['a'],
        totalPhotos: 3,
      }),
      t,
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('All photo metadata');
    expect(lines[1]).toBe('All DSO overrides');
    expect(lines[2]).toBe('All custom gear');
    expect(lines[3]).toBe('1 of 3 photo(s)');
  });

  it('treats photoIds.length >= totalPhotos as "all" even when totalPhotos is 0', () => {
    // edge: no photos on map, nothing selected in list → no photo line
    const lines = buildDeleteSummaryLines(
      opts({ photoIds: [], totalPhotos: 0 }),
      t,
    );
    expect(lines).toEqual([]);
  });
});
