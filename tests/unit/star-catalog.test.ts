import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// t() echoes its key so we can assert which i18n key was selected for each star count.
vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'en',
}));

import { formatMultiplicity, starDisplayName, expandMultiples } from '../../src/star-catalog';

describe('starDisplayName', () => {
  it('prefers proper name, then Bayer, then Flamsteed, then HIP', () => {
    expect(starDisplayName({ hip: 1, name: 'Albireo', bayer: 'β', constellation: 'Cyg' })).toBe(
      'Albireo',
    );
    expect(starDisplayName({ hip: 2, bayer: 'β', constellation: 'Cyg' })).toBe('β Cyg');
    expect(starDisplayName({ hip: 3, flam: '61', constellation: 'Cyg' })).toBe('61 Cyg');
    expect(starDisplayName({ hip: 12345 })).toBe('HIP 12345');
  });
});

describe('formatMultiplicity', () => {
  it('maps the star count to the matching type key (binary … octuple)', () => {
    expect(formatMultiplicity({ components: 2 })).toBe('stars.multiple.binary');
    expect(formatMultiplicity({ components: 3 })).toBe('stars.multiple.triple');
    expect(formatMultiplicity({ components: 4 })).toBe('stars.multiple.quadruple');
    expect(formatMultiplicity({ components: 6 })).toBe('stars.multiple.sextuple');
    expect(formatMultiplicity({ components: 8 })).toBe('stars.multiple.octuple');
  });

  it('falls back to the generic N-star system key beyond the named range', () => {
    expect(formatMultiplicity({ components: 9 })).toBe('stars.multiple.system');
  });

  it('appends the separation in arcseconds when present', () => {
    expect(formatMultiplicity({ components: 2, sep: '34.3' })).toBe(
      'stars.multiple.binary · 34.3″',
    );
  });
});

describe('expandMultiples', () => {
  it('attaches the metadata to the primary and every listed companion HIP', () => {
    const map = expandMultiples({
      '95947': { components: 2, sep: '34.3', members: [95951] },
    });
    expect(map.get(95947)).toEqual({ components: 2, sep: '34.3' });
    // The companion inherits the same metadata…
    expect(map.get(95951)).toEqual({ components: 2, sep: '34.3' });
    // …but `members` is stripped from the attached object.
    expect(map.get(95951)).not.toHaveProperty('members');
  });

  it('omits sep when absent', () => {
    const map = expandMultiples({ '65477': { components: 2 } });
    expect(map.get(65477)).toEqual({ components: 2 });
  });
});

describe('star-multiples.json', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const data: Record<
    string,
    { components: number; sep?: string; members?: number[]; magB?: number; bvB?: number }
  > = JSON.parse(
    readFileSync(path.join(__dirname, '../../public/data/star-multiples.json'), 'utf-8'),
  );

  it('is keyed by numeric HIP strings with a valid star count (2..8)', () => {
    for (const [hip, m] of Object.entries(data)) {
      expect(/^\d+$/.test(hip)).toBe(true);
      expect(Number.isInteger(m.components)).toBe(true);
      expect(m.components).toBeGreaterThanOrEqual(2);
      expect(m.components).toBeLessThanOrEqual(8);
      if (m.sep !== undefined) expect(typeof m.sep).toBe('string');
      if (m.members !== undefined) {
        expect(Array.isArray(m.members)).toBe(true);
        for (const member of m.members) expect(Number.isInteger(member)).toBe(true);
      }
      if (m.magB !== undefined) expect(typeof m.magB).toBe('number');
      if (m.bvB !== undefined) expect(typeof m.bvB).toBe('number');
    }
  });

  it('gives every system a companion photometry source (catalogued member or magB+bvB) and a separation, so the recommender can rate it', () => {
    for (const [hip, m] of Object.entries(data)) {
      const hasMember = Array.isArray(m.members) && m.members.length > 0;
      const hasCurated = m.magB !== undefined && m.bvB !== undefined;
      expect(hasMember || hasCurated, `HIP ${hip} needs members or magB+bvB`).toBe(true);
      expect(m.sep, `HIP ${hip} needs a separation`).toBeDefined();
    }
  });
});
