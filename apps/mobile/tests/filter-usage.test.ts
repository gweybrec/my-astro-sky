import { beforeEach, describe, expect, it } from 'vitest';
import { noteFilterUse, recentFilters, resetFilterUse } from '../src/filter-usage';

describe('the filters chosen while the app runs', () => {
  beforeEach(() => resetFilterUse());

  it('come first, the last chosen first, before the photos’ filters, each once', () => {
    noteFilterUse('Ha');
    noteFilterUse(' OIII ');
    noteFilterUse('ha');
    expect(recentFilters(['L', 'OIII', 'SII'], 5)).toEqual(['ha', 'OIII', 'L', 'SII']);
  });

  it('keep to the limit and ignore an empty name', () => {
    noteFilterUse('');
    expect(recentFilters(['L', 'R', 'G'], 2)).toEqual(['L', 'R']);
  });
});
