import { describe, expect, it } from 'vitest';
import {
  buildCatalogStars,
  buildDeepStars,
  forEachStar,
  type StarsColumnsJson,
  type StarsGeoJson,
} from '@myastrosky/core/catalog/star-lists';

/** Three stars in file order (not sorted): one with no colour index, one past magnitude 11, one RA below 0. */
const geo: StarsGeoJson = {
  features: [
    {
      id: 2,
      properties: { mag: 9.27, bv: '0.999' },
      geometry: { coordinates: [0.0043, -19.4988] },
    },
    { id: 7, properties: { mag: 12.1, bv: '' }, geometry: { coordinates: [10, 20] } },
    { id: 3, properties: { mag: 6.61, bv: -0.019 }, geometry: { coordinates: [-5, 38.86] } },
  ],
};
/** The same stars in column form, brightest first (what scripts/stars-to-columns.mjs writes). */
const cols: StarsColumnsJson = {
  fields: ['hip', 'ra', 'dec', 'mag', 'bv'],
  columns: [
    [3, 2, 7],
    [-5, 0.0043, 10],
    [38.86, -19.4988, 20],
    [6.61, 9.27, 12.1],
    [-0.019, 0.999, null],
  ],
};

const rows = (json: StarsGeoJson | StarsColumnsJson) => {
  const out: number[][] = [];
  forEachStar(json, (...r) => out.push(r));
  return out;
};

describe('forEachStar', () => {
  it('reads the column form in file order, an unknown colour index as 0', () => {
    expect(rows(cols)).toEqual([
      [3, -5, 38.86, 6.61, -0.019],
      [2, 0.0043, -19.4988, 9.27, 0.999],
      [7, 10, 20, 12.1, 0],
    ]);
  });

  it('reads the GeoJSON form the same way, the colour index parsed from text', () => {
    expect(rows(geo)).toEqual([
      [2, 0.0043, -19.4988, 9.27, 0.999],
      [7, 10, 20, 12.1, 0],
      [3, -5, 38.86, 6.61, -0.019],
    ]);
  });
});

describe('star lists from either form', () => {
  const names = { '3': { name: 'Test', c: 'Lyr' } };

  it('builds the same deep catalogue (magnitude 11 and brighter, brightest first)', () => {
    const fromCols = buildDeepStars(cols, names);
    expect(fromCols).toEqual(buildDeepStars(geo, names));
    expect(fromCols.map((s) => s.hip)).toEqual([3, 2]);
    expect(fromCols[0]).toMatchObject({ ra: 355, name: 'Test', constellation: 'Lyr', bv: -0.019 });
  });

  it('builds the same matching catalogue (every magnitude, brightest first)', () => {
    const fromCols = buildCatalogStars(cols, names);
    expect(fromCols).toEqual(buildCatalogStars(geo, names));
    expect(fromCols.map((s) => s.hip)).toEqual([3, 2, 7]);
  });
});
