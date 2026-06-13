import { describe, expect, it } from 'vitest';
import { filterFilterCandidates, filterLabelCandidates } from '../../src/autocomplete-utils';

function makeFilterMap(labels: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of labels) m.set(l.toLowerCase(), l);
  return m;
}

// ─── filterFilterCandidates ───────────────────────────────────────────────────

describe('filterFilterCandidates', () => {
  const DEFAULT_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

  it('empty query returns all entries when count ≤ maxResults', () => {
    const map = makeFilterMap(['Ha', 'OIII', 'SII']);
    expect(filterFilterCandidates(map, '')).toEqual(['Ha', 'OIII', 'SII']);
  });

  it('empty query is capped at maxResults (default 8)', () => {
    const map = makeFilterMap([...DEFAULT_FILTERS, 'Extra']);
    expect(filterFilterCandidates(map, '')).toHaveLength(8);
  });

  it('caps at explicit maxResults', () => {
    const map = makeFilterMap(DEFAULT_FILTERS);
    expect(filterFilterCandidates(map, '', 3)).toHaveLength(3);
  });

  it('query filters by substring match', () => {
    const map = makeFilterMap(['Ha', 'OIII', 'Halpha', 'SII']);
    const results = filterFilterCandidates(map, 'ha');
    expect(results).toContain('Ha');
    expect(results).toContain('Halpha');
    expect(results).not.toContain('OIII');
    expect(results).not.toContain('SII');
  });

  it('query matching is case-insensitive on both query and label', () => {
    const map = makeFilterMap(['OIII', 'Ha']);
    expect(filterFilterCandidates(map, 'oiii')).toContain('OIII');
    expect(filterFilterCandidates(map, 'HA')).toContain('Ha');
  });

  it('query with no match returns empty array', () => {
    const map = makeFilterMap(['Ha', 'OIII']);
    expect(filterFilterCandidates(map, 'xyz')).toHaveLength(0);
  });

  it('whitespace-only query is treated as empty (show all)', () => {
    const map = makeFilterMap(['Ha', 'OIII']);
    expect(filterFilterCandidates(map, '   ')).toHaveLength(2);
  });

  it('empty map always returns empty array', () => {
    expect(filterFilterCandidates(new Map(), '')).toHaveLength(0);
    expect(filterFilterCandidates(new Map(), 'ha')).toHaveLength(0);
  });
});

// ─── filterLabelCandidates ────────────────────────────────────────────────────

describe('filterLabelCandidates', () => {
  const KNOWN = ['Widefield', 'Nebula', 'Galaxy', 'Mosaic', 'Ha-only'];

  it('empty query returns all non-excluded labels', () => {
    expect(filterLabelCandidates(KNOWN, [], '')).toEqual(KNOWN);
  });

  it('already-selected labels are excluded from results', () => {
    const results = filterLabelCandidates(KNOWN, ['Galaxy'], '');
    expect(results).not.toContain('Galaxy');
    expect(results).toContain('Nebula');
    expect(results).toContain('Widefield');
  });

  it('multiple exclusions are all removed', () => {
    const results = filterLabelCandidates(KNOWN, ['Galaxy', 'Mosaic'], '');
    expect(results).not.toContain('Galaxy');
    expect(results).not.toContain('Mosaic');
  });

  it('query filters by substring (case-insensitive)', () => {
    // 'gal' matches 'Galaxy'; does not match Widefield, Nebula, Mosaic, Ha-only
    const results = filterLabelCandidates(KNOWN, [], 'gal');
    expect(results).toContain('Galaxy');
    expect(results).not.toContain('Widefield');
    expect(results).not.toContain('Nebula');
    expect(results).not.toContain('Mosaic');
    expect(results).not.toContain('Ha-only');
  });

  it('query matching is case-insensitive on both sides', () => {
    expect(filterLabelCandidates(KNOWN, [], 'NEBULA')).toContain('Nebula');
    expect(filterLabelCandidates(KNOWN, [], 'galaxy')).toContain('Galaxy');
  });

  it('exclusion and query work together', () => {
    // 'Galaxy' matches 'la' but is excluded
    const results = filterLabelCandidates(KNOWN, ['Galaxy'], 'la');
    expect(results).not.toContain('Galaxy');
  });

  it('whitespace-only query is treated as empty (show all)', () => {
    expect(filterLabelCandidates(KNOWN, [], '   ')).toEqual(KNOWN);
  });

  it('query with no match returns empty array', () => {
    expect(filterLabelCandidates(KNOWN, [], 'zxcv')).toHaveLength(0);
  });

  it('capped at maxResults (default 8)', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Label${i}`);
    expect(filterLabelCandidates(many, [], '')).toHaveLength(8);
  });

  it('explicit maxResults is respected', () => {
    expect(filterLabelCandidates(KNOWN, [], '', 2)).toHaveLength(2);
  });

  it('empty known labels always returns empty array', () => {
    expect(filterLabelCandidates([], [], '')).toHaveLength(0);
    expect(filterLabelCandidates([], [], 'ha')).toHaveLength(0);
  });

  it('newly typed label appears in next query after being added to knownLabels', () => {
    const known = ['Widefield', 'Nebula'];
    known.push('Ha-mosaic'); // simulates commitLabel adding to localKnownLabels
    const results = filterLabelCandidates(known, [], 'ha');
    expect(results).toContain('Ha-mosaic');
  });
});
