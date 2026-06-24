import { describe, it, expect } from 'vitest';
import {
  resolveCategory,
  groupPoisByCategory,
  buildPoiFilterGroups,
  poisMatchFilter,
  UNCATEGORIZED_ID,
} from '../../src/poi';
import type { PoiCategory, PointOfInterest } from '../../src/types';

const cats: PoiCategory[] = [
  { id: 'cat-comet', name: 'Comet', color: '#111', position: 0 },
  { id: 'cat-asteroid', name: 'Asteroid', color: '#222', position: 1 },
];

describe('resolveCategory', () => {
  it('returns the matching category', () => {
    expect(resolveCategory('cat-comet', cats).name).toBe('Comet');
  });

  it('falls back to the synthetic Uncategorized for unknown ids (orphans)', () => {
    const c = resolveCategory('cat-deleted', cats);
    expect(c.id).toBe(UNCATEGORIZED_ID);
  });
});

describe('groupPoisByCategory', () => {
  it('groups by resolved category, ordered by position', () => {
    const pois: PointOfInterest[] = [
      { name: 'Vesta', categoryId: 'cat-asteroid' },
      { name: 'C/2023 A3', categoryId: 'cat-comet' },
      { name: 'Ceres', categoryId: 'cat-asteroid' },
    ];
    const groups = groupPoisByCategory(pois, cats);
    expect(groups.map(g => g.category.id)).toEqual(['cat-comet', 'cat-asteroid']);
    expect(groups[1].pois.map(p => p.name).sort()).toEqual(['Ceres', 'Vesta']);
  });

  it('places orphan POIs in an Uncategorized bucket, last', () => {
    const pois: PointOfInterest[] = [
      { name: 'Ghost', categoryId: 'cat-deleted' },
      { name: 'C/2023 A3', categoryId: 'cat-comet' },
    ];
    const groups = groupPoisByCategory(pois, cats);
    expect(groups[groups.length - 1].category.id).toBe(UNCATEGORIZED_ID);
  });
});

describe('buildPoiFilterGroups', () => {
  it('counts distinct names per category across photos (deduped per photo)', () => {
    const photoPois: PointOfInterest[][] = [
      [{ name: 'Vesta', categoryId: 'cat-asteroid' }, { name: 'Vesta', categoryId: 'cat-asteroid' }],
      [{ name: 'Vesta', categoryId: 'cat-asteroid' }, { name: 'C/2023 A3', categoryId: 'cat-comet' }],
    ];
    const groups = buildPoiFilterGroups(photoPois, cats);
    const asteroid = groups.find(g => g.category.id === 'cat-asteroid')!;
    const vesta = asteroid.names.find(n => n.name === 'Vesta')!;
    expect(vesta.count).toBe(2); // counted once per photo, both photos have it
  });
});

describe('poisMatchFilter', () => {
  const pois: PointOfInterest[] = [
    { name: 'Vesta', categoryId: 'cat-asteroid' },
    { name: 'C/2023 A3', categoryId: 'cat-comet' },
  ];

  it('passes everything when the filter is null', () => {
    expect(poisMatchFilter(pois, cats, null)).toBe(true);
    expect(poisMatchFilter([], cats, null)).toBe(true);
  });

  it('matches when a selected category+name is present', () => {
    const sel = new Map([['cat-asteroid', new Set(['Vesta'])]]);
    expect(poisMatchFilter(pois, cats, sel)).toBe(true);
  });

  it('does not match a different name within a selected category', () => {
    const sel = new Map([['cat-asteroid', new Set(['Ceres'])]]);
    expect(poisMatchFilter(pois, cats, sel)).toBe(false);
  });

  it('an empty name-set selects the whole category', () => {
    const sel = new Map([['cat-comet', new Set<string>()]]);
    expect(poisMatchFilter(pois, cats, sel)).toBe(true);
  });

  it('photos with no POIs do not pass an active filter', () => {
    const sel = new Map([['cat-asteroid', new Set(['Vesta'])]]);
    expect(poisMatchFilter([], cats, sel)).toBe(false);
  });

  it('resolves orphan POIs to the Uncategorized bucket for matching', () => {
    const orphan: PointOfInterest[] = [{ name: 'Ghost', categoryId: 'cat-deleted' }];
    const sel = new Map([[UNCATEGORIZED_ID, new Set(['Ghost'])]]);
    expect(poisMatchFilter(orphan, cats, sel)).toBe(true);
  });
});
