import { describe, it, expect } from 'vitest';
import {
  ANY_PHOTO_EXT_RE,
  RASTER_PHOTO_EXT_RE,
  RAW_ASTRO_EXT_RE,
  PHOTO_PICKER_ACCEPT,
  RAW_COMPANION_ACCEPT,
  isRawAstroFile,
} from '@myastrosky/core/photo-formats';

describe('RASTER_PHOTO_EXT_RE', () => {
  it('accepts jpg/jpeg/png/webp, case-insensitively', () => {
    for (const name of ['photo.jpg', 'photo.JPG', 'photo.jpeg', 'photo.png', 'photo.webp']) {
      expect(RASTER_PHOTO_EXT_RE.test(name)).toBe(true);
    }
  });

  it('rejects raw astro formats and unrelated extensions', () => {
    for (const name of ['raw.fit', 'raw.fits', 'raw.tif', 'raw.tiff', 'raw.cr2', 'photo.jpg.txt']) {
      expect(RASTER_PHOTO_EXT_RE.test(name)).toBe(false);
    }
  });
});

describe('RAW_ASTRO_EXT_RE / isRawAstroFile', () => {
  it('accepts tif/tiff/fit/fits, case-insensitively', () => {
    for (const name of ['M101.fit', 'M101.FITS', 'M101.tif', 'M101.TIFF']) {
      expect(RAW_ASTRO_EXT_RE.test(name)).toBe(true);
      expect(isRawAstroFile(name)).toBe(true);
    }
  });

  it('rejects raster and unrelated extensions', () => {
    for (const name of ['photo.jpg', 'photo.png', 'raw.cr2', 'raw.fit.txt']) {
      expect(isRawAstroFile(name)).toBe(false);
    }
  });
});

describe('ANY_PHOTO_EXT_RE', () => {
  it('accepts both raster and raw astro formats', () => {
    for (const name of [
      'photo.jpg',
      'photo.png',
      'photo.webp',
      'raw.fit',
      'raw.fits',
      'raw.tiff',
    ]) {
      expect(ANY_PHOTO_EXT_RE.test(name)).toBe(true);
    }
  });

  it('rejects unrelated extensions', () => {
    for (const name of ['raw.cr2', 'notes.txt', 'archive.zip']) {
      expect(ANY_PHOTO_EXT_RE.test(name)).toBe(false);
    }
  });
});

describe('accept strings', () => {
  it('the photo picker accept string offers both MIME types and raw extensions', () => {
    expect(PHOTO_PICKER_ACCEPT).toContain('image/jpeg');
    expect(PHOTO_PICKER_ACCEPT).toContain('.fit');
    expect(PHOTO_PICKER_ACCEPT).toContain('.fits');
    expect(PHOTO_PICKER_ACCEPT).toContain('.tif');
    expect(PHOTO_PICKER_ACCEPT).toContain('.tiff');
  });

  it('the companion accept string only offers raw extensions', () => {
    expect(RAW_COMPANION_ACCEPT).toBe('.fit,.fits,.tif,.tiff');
  });
});
