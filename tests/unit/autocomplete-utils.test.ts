import { describe, expect, it } from 'vitest';
import {
  filterFilterCandidates,
  filterCandidatesWithCatalog,
  type FilterCatalogEntry,
} from '../../src/autocomplete-utils';

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

// ─── filterCandidatesWithCatalog ──────────────────────────────────────────────

describe('filterCandidatesWithCatalog', () => {
  const catalogEntry = (over: Partial<FilterCatalogEntry> = {}): FilterCatalogEntry => ({
    label: 'Antlia Pro Luminance',
    color: '#c8c8c8',
    detail: 'luminance',
    brand: 'Antlia',
    model: 'Pro LRGB – L',
    series: 'Pro',
    subtype: 'luminance',
    ...over,
  });

  const CATALOG: FilterCatalogEntry[] = [
    catalogEntry(),
    catalogEntry({
      label: 'Antlia ALP-T Dual Band 5nm',
      color: '#501e96',
      detail: 'Ha+OIII · 656.3nm + 500.7nm',
      model: 'ALP-T 5nm',
      subtype: 'Ha+OIII',
    }),
    catalogEntry({
      label: 'Optolong L-eXtreme',
      color: '#501e96',
      detail: 'Ha+OIII',
      brand: 'Optolong',
      model: 'L-eXtreme',
      series: null,
      subtype: 'Ha+OIII',
    }),
  ];

  const KNOWN = makeFilterMap(['L', 'Ha', 'OIII']);

  it('lists known band names before catalog products', () => {
    const results = filterCandidatesWithCatalog(KNOWN, CATALOG, '');
    expect(results.slice(0, 3).map((r) => r.label)).toEqual(['L', 'Ha', 'OIII']);
    expect(results.slice(3).map((r) => r.label)).toContain('Antlia Pro Luminance');
  });

  it('known band names carry no colour or detail (they use the legacy tokens)', () => {
    const [first] = filterCandidatesWithCatalog(KNOWN, CATALOG, '');
    expect(first).toEqual({ label: 'L', color: null, detail: null });
  });

  it('catalog candidates carry their colour and detail', () => {
    const results = filterCandidatesWithCatalog(new Map(), CATALOG, 'l-extreme');
    expect(results).toEqual([{ label: 'Optolong L-eXtreme', color: '#501e96', detail: 'Ha+OIII' }]);
  });

  it('matches on brand', () => {
    const labels = filterCandidatesWithCatalog(new Map(), CATALOG, 'optolong').map((r) => r.label);
    expect(labels).toEqual(['Optolong L-eXtreme']);
  });

  it('matches on the model even when the display label differs from it', () => {
    // "Antlia Pro Luminance" (AstroBin name) contains neither "LRGB" nor "Pro LRGB".
    const labels = filterCandidatesWithCatalog(new Map(), CATALOG, 'pro lrgb').map((r) => r.label);
    expect(labels).toEqual(['Antlia Pro Luminance']);
  });

  it('matches on subtype', () => {
    const labels = filterCandidatesWithCatalog(new Map(), CATALOG, 'ha+oiii').map((r) => r.label);
    expect(labels).toEqual(['Antlia ALP-T Dual Band 5nm', 'Optolong L-eXtreme']);
  });

  it('matches on series', () => {
    const labels = filterCandidatesWithCatalog(new Map(), CATALOG, 'pro').map((r) => r.label);
    expect(labels).toContain('Antlia Pro Luminance');
  });

  it('is case-insensitive', () => {
    expect(filterCandidatesWithCatalog(new Map(), CATALOG, 'ANTLIA')).toHaveLength(2);
  });

  it('de-duplicates a catalog entry that a known name already covers', () => {
    const known = makeFilterMap(['Optolong L-eXtreme']);
    const results = filterCandidatesWithCatalog(known, CATALOG, 'l-extreme');
    expect(results).toHaveLength(1);
    // The known entry wins, so it has no catalog colour attached.
    expect(results[0]).toEqual({ label: 'Optolong L-eXtreme', color: null, detail: null });
  });

  it('is uncapped by default: an empty query offers the whole catalog for browsing', () => {
    const results = filterCandidatesWithCatalog(KNOWN, CATALOG, '');
    // 3 known band names + all 3 catalog entries, nothing dropped.
    expect(results).toHaveLength(KNOWN.size + CATALOG.length);
    expect(results.map((r) => r.label)).toEqual([
      'L',
      'Ha',
      'OIII',
      'Antlia Pro Luminance',
      'Antlia ALP-T Dual Band 5nm',
      'Optolong L-eXtreme',
    ]);
  });

  it('respects an explicit maxResults across both sources', () => {
    expect(filterCandidatesWithCatalog(KNOWN, CATALOG, '', 4)).toHaveLength(4);
    expect(filterCandidatesWithCatalog(KNOWN, CATALOG, '', 2).map((r) => r.label)).toEqual([
      'L',
      'Ha',
    ]);
  });

  it('an empty catalog degrades to the known names only', () => {
    const labels = filterCandidatesWithCatalog(KNOWN, [], '').map((r) => r.label);
    expect(labels).toEqual(['L', 'Ha', 'OIII']);
  });

  it('returns nothing when neither source matches', () => {
    expect(filterCandidatesWithCatalog(KNOWN, CATALOG, 'zzz')).toEqual([]);
  });
});
