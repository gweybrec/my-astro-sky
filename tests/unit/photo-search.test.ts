import { describe, expect, it } from 'vitest';
import type { Photo } from '../../src/types';
import { buildPhotoQueryMatches } from '../../src/photo-search';

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M42 Orion',
    width: 1200,
    height: 900,
    createdAt: new Date().toISOString(),
    correspondences: [],
    dsoIds: ['M42', 'NGC1976'],
    labels: ['nebula', 'orion'],
    notes: 'great winter target',
    ...overrides,
  };
}

describe('buildPhotoQueryMatches', () => {
  it('returns empty list for empty query', () => {
    const matches = buildPhotoQueryMatches([makePhoto()], '   ');
    expect(matches).toEqual([]);
  });

  it('matches on original name', () => {
    const photos = [
      makePhoto({ id: 'a', originalName: 'M42 Orion', dsoIds: [], labels: [], notes: '' }),
      makePhoto({ id: 'b', originalName: 'M31 Andromeda', dsoIds: [], labels: [], notes: '' }),
    ];

    const matches = buildPhotoQueryMatches(photos, 'orion');
    expect(matches).toHaveLength(1);
    expect(matches[0].photo.id).toBe('a');
  });

  it('includes only chips matching the query', () => {
    const photo = makePhoto({ dsoIds: ['M42', 'NGC1976'], labels: ['orion', 'nebula'] });
    const matches = buildPhotoQueryMatches([photo], 'ngc');

    expect(matches).toHaveLength(1);
    expect(matches[0].matchingDsoIds).toEqual(['NGC1976']);
    expect(matches[0].matchingLabels).toEqual([]);
  });

  it('matches by notes while keeping chip matches empty when no chips match', () => {
    const photo = makePhoto({ notes: 'captured with filter', dsoIds: ['M42'], labels: ['widefield'] });
    const matches = buildPhotoQueryMatches([photo], 'filter');

    expect(matches).toHaveLength(1);
    expect(matches[0].matchingDsoIds).toEqual([]);
    expect(matches[0].matchingLabels).toEqual([]);
  });
});
