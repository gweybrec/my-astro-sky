import { describe, expect, it } from 'vitest';

import type { Photo } from '@myastrosky/core/types';
import {
  filterDrawOrderPhotos,
  findOverlappingPhotoIds,
  fullPhotoOrder,
  mergeFilteredOrder,
  polygonsOverlap,
  type PhotoCanvasQuad,
} from '@myastrosky/core/photo-draw-order';

function makePhoto(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    filename: `${id}.jpg`,
    originalName: id,
    width: 1200,
    height: 900,
    createdAt: new Date().toISOString(),
    correspondences: [],
    dsoIds: [],
    labels: [],
    notes: '',
    ...overrides,
  };
}

function rect(id: string, x0: number, y0: number, x1: number, y1: number): PhotoCanvasQuad {
  return {
    id,
    name: id,
    corners: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

describe('photo draw order helpers', () => {
  it('detects polygon overlap for intersecting quads', () => {
    const a = rect('a', 10, 10, 70, 70).corners;
    const b = rect('b', 50, 20, 110, 80).corners;

    expect(polygonsOverlap(a, b)).toBe(true);
  });

  it('finds only quads overlapping the current photo', () => {
    const quads = [
      rect('current', 10, 10, 70, 70),
      rect('overlap', 50, 20, 110, 80),
      rect('separate', 140, 140, 180, 180),
    ];

    expect(findOverlappingPhotoIds('current', quads)).toEqual(new Set(['current', 'overlap']));
  });

  it('filters by query and preserves existing order', () => {
    const photos = [
      makePhoto('c', { originalName: 'Rosette widefield', labels: ['nebula'] }),
      makePhoto('b', { originalName: 'M31 core', labels: ['galaxy'] }),
      makePhoto('a', { originalName: 'M42 detail', labels: ['nebula'] }),
    ];

    const filtered = filterDrawOrderPhotos(photos, 'nebula', false, 'a', []);

    expect(filtered.map((photo) => photo.id)).toEqual(['c', 'a']);
  });

  it('combines query and overlap filters conjunctively', () => {
    const photos = [
      makePhoto('top', { originalName: 'M31 top frame', notes: 'galaxy' }),
      makePhoto('mid', { originalName: 'M42 overlap frame', notes: 'nebula' }),
      makePhoto('current', { originalName: 'M42 base frame', notes: 'nebula' }),
    ];
    const quads = [
      rect('top', 150, 150, 220, 220),
      rect('mid', 30, 30, 100, 100),
      rect('current', 10, 10, 80, 80),
    ];

    const filtered = filterDrawOrderPhotos(photos, 'm42', true, 'current', quads);

    expect(filtered.map((photo) => photo.id)).toEqual(['mid', 'current']);
  });
});

describe('mergeFilteredOrder', () => {
  it('reorders the filtered ids in their own slots and keeps the others', () => {
    const full = ['a', 'b', 'c', 'd', 'e'];
    expect(mergeFilteredOrder(full, ['d', 'b'], new Set(['b', 'd']))).toEqual([
      'a',
      'd',
      'c',
      'b',
      'e',
    ]);
  });

  it('leaves the order unchanged when the filtered order is unchanged', () => {
    const full = ['a', 'b', 'c'];
    expect(mergeFilteredOrder(full, ['a', 'c'], new Set(['a', 'c']))).toEqual(full);
  });
});

describe('fullPhotoOrder', () => {
  it('keeps the photos without a placement where they were', () => {
    // u1 and u2 have no placement: they are not on the map and keep their slots.
    const all = ['p1', 'u1', 'p2', 'p3', 'u2'];
    expect(fullPhotoOrder(all, ['p3', 'p1', 'p2'])).toEqual(['p3', 'u1', 'p1', 'p2', 'u2']);
  });

  it('holds every photo once', () => {
    const all = ['p1', 'u1', 'p2'];
    const out = fullPhotoOrder(all, ['p2', 'p1']);
    expect([...out].sort()).toEqual([...all].sort());
  });
});
