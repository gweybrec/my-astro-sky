import { beforeEach, describe, expect, it } from 'vitest';
import type { Photo } from '@myastrosky/core/types';
import {
  DEFAULT_GALLERY_SORT,
  emptyGalleryFilters,
  filterGalleryPhotos,
  gallerySetupItems,
  loadGallerySort,
  NO_SETUP,
  saveGallerySort,
  sortGalleryPhotos,
  type GalleryFilters,
} from '@myastrosky/core/gallery-filter';
import { NO_LABEL } from '@myastrosky/core/photo-placement';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M42',
    width: 1000,
    height: 700,
    createdAt: '2024-01-01T00:00:00.000Z',
    correspondences: [],
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

const ctx = { knownSetupIds: new Set(['s1']), poiCategories: [] };
const ids = (photos: Photo[]) => photos.map((p) => p.id);
const filter = (photos: Photo[], over: Partial<GalleryFilters>) =>
  ids(filterGalleryPhotos(photos, { ...emptyGalleryFilters(), ...over }, ctx));

describe('filterGalleryPhotos', () => {
  const photos = [
    makePhoto({ id: 'a', originalName: 'Orion', dsoIds: ['M42'], labels: ['nebula'] }),
    makePhoto({ id: 'b', originalName: 'NGC7000 North America', gearSetupId: 's1' }),
    makePhoto({ id: 'c', originalName: 'Andromeda', dsoIds: ['M31'], notes: 'First light' }),
    makePhoto({ id: 'd', originalName: 'Moon', gearSetupId: 'gone' }),
  ];

  it('passes every photo with no filter on', () => {
    expect(filter(photos, {})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('passes no photo through an empty list or map, unlike a filter that is off', () => {
    expect(filter(photos, { labels: [] })).toEqual([]);
    expect(filter(photos, { setups: [] })).toEqual([]);
    expect(filter(photos, { dsoCatalogs: [] })).toEqual([]);
    expect(filter(photos, { pois: new Map() })).toEqual([]);
    // photos with no object always pass the types filter
    expect(filter(photos, { dsoTypes: [] })).toEqual(['b', 'd']);
  });

  it('searches names, objects, labels and notes', () => {
    expect(filter(photos, { query: 'm31' })).toEqual(['c']);
    expect(filter(photos, { query: 'nebula' })).toEqual(['a']);
    expect(filter(photos, { query: '  FIRST ' })).toEqual(['c']);
  });

  it('filters labels, with the no-label sentinel for unlabelled photos', () => {
    expect(filter(photos, { labels: ['nebula'] })).toEqual(['a']);
    expect(filter(photos, { labels: [NO_LABEL] })).toEqual(['b', 'c', 'd']);
  });

  it('filters setups, a dangling setup counting as none', () => {
    expect(filter(photos, { setups: ['s1'] })).toEqual(['b']);
    expect(filter(photos, { setups: [NO_SETUP] })).toEqual(['a', 'c', 'd']);
  });

  it('filters catalogues on objects, or on the file name of a photo without one', () => {
    expect(filter(photos, { dsoCatalogs: ['NGC'] })).toEqual(['b']);
    expect(filter(photos, { dsoCatalogs: ['M'] })).toEqual(['a', 'c']);
  });

  it('filters dates: a single day, an inclusive range, a reversed range; undated photos drop out', () => {
    const dated = [
      makePhoto({ id: 'x', observationDate: '2024-03-14T21:05:00.000Z' }),
      makePhoto({ id: 'y', observationDate: '2024-04-02T22:00:00.000Z' }),
      makePhoto({ id: 'z', observationDate: null }),
    ];
    expect(filter(dated, { dateFrom: '2024-03-14' })).toEqual(['x']);
    expect(filter(dated, { dateFrom: '2024-03-14', dateTo: '2024-04-02' })).toEqual(['x', 'y']);
    expect(filter(dated, { dateFrom: '2024-04-02', dateTo: '2024-03-14' })).toEqual(['x', 'y']);
  });
});

describe('sortGalleryPhotos', () => {
  const photos = [
    makePhoto({ id: 'm100', originalName: 'M100', observationDate: '2024-03-14T21:05:00.000Z' }),
    makePhoto({ id: 'm2', originalName: 'M2', observationDate: '2025-01-02T03:30:00.000Z' }),
    makePhoto({ id: 'm31', originalName: 'M31', observationDate: null }),
    makePhoto({ id: 'm13', originalName: 'M13', observationDate: '2024-03-14T21:05:00.000Z' }),
  ];

  it('sorts by name, catalogue numbers in order, both ways', () => {
    expect(ids(sortGalleryPhotos(photos, 'name-asc'))).toEqual(['m2', 'm13', 'm31', 'm100']);
    expect(ids(sortGalleryPhotos(photos, 'name-desc'))).toEqual(['m100', 'm31', 'm13', 'm2']);
  });

  it('sorts by date both ways, undated photos last and equal dates by name', () => {
    expect(ids(sortGalleryPhotos(photos, 'date-desc'))).toEqual(['m2', 'm13', 'm100', 'm31']);
    expect(ids(sortGalleryPhotos(photos, 'date-asc'))).toEqual(['m13', 'm100', 'm2', 'm31']);
  });

  it('does not change the list it is given', () => {
    const before = ids(photos);
    sortGalleryPhotos(photos, 'date-desc');
    expect(ids(photos)).toEqual(before);
  });
});

describe('gallerySetupItems', () => {
  it('counts photos per used setup, sorted by name, with the no-setup entry last', () => {
    const items = gallerySetupItems(
      [
        makePhoto({ gearSetupId: 'b' }),
        makePhoto({ gearSetupId: 'a' }),
        makePhoto({ gearSetupId: 'a' }),
        makePhoto({ gearSetupId: 'gone' }),
      ],
      new Map([
        ['a', 'Zeta'],
        ['b', 'Alpha'],
        ['unused', 'Unused'],
      ]),
    );
    expect(items).toEqual([
      { setupId: 'b', name: 'Alpha', count: 1 },
      { setupId: 'a', name: 'Zeta', count: 2 },
      { setupId: NO_SETUP, name: NO_SETUP, count: 1 },
    ]);
  });
});

describe('stored sort', () => {
  beforeEach(() => configureStorage(createMemoryStore()));

  it('reads the default until an order is saved, and ignores an unknown value', () => {
    expect(loadGallerySort()).toBe(DEFAULT_GALLERY_SORT);
    saveGallerySort('date-desc');
    expect(loadGallerySort()).toBe('date-desc');
    saveGallerySort('bogus' as never);
    expect(loadGallerySort()).toBe(DEFAULT_GALLERY_SORT);
  });
});
