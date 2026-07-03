import { describe, expect, it } from 'vitest';

import type { Photo } from '../../src/types';
import {
  filterDrawOrderPhotos,
  findOverlappingPhotoIds,
  polygonsOverlap,
  type PhotoCanvasQuad,
} from '../../src/photo-draw-order';

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
