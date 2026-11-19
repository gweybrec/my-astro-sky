import { describe, it, expect } from 'vitest';
import { findPhotoWithFileName, stripExtension } from '@myastrosky/core/photo-name-match';

describe('stripExtension', () => {
  it('removes only the last extension', () => {
    expect(stripExtension('M101.fit')).toBe('M101');
    expect(stripExtension('M101.v2.tiff')).toBe('M101.v2');
    expect(stripExtension('M101')).toBe('M101');
  });
});

describe('findPhotoWithFileName', () => {
  const photos = [
    { id: 'a', originalName: 'M101' },
    { id: 'b', originalName: 'NGC 7000' },
  ];

  it('finds the photo named like the file without its extension', () => {
    expect(findPhotoWithFileName('M101.fit', photos)?.id).toBe('a');
    expect(findPhotoWithFileName('NGC 7000.jpg', photos)?.id).toBe('b');
  });

  it('is exact and case-sensitive', () => {
    expect(findPhotoWithFileName('m101.fit', photos)).toBeUndefined();
    expect(findPhotoWithFileName('M101 crop.fit', photos)).toBeUndefined();
  });

  it('finds nothing in an empty list', () => {
    expect(findPhotoWithFileName('M101.fit', [])).toBeUndefined();
  });
});
