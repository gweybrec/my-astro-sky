import { describe, it, expect, vi } from 'vitest';
import { smartSortPhotos } from '@myastrosky/core/photo-search';

// Mock i18n and DOM to avoid browser dependency
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

function makePhoto(name: string) {
  return {
    id: name,
    filename: name + '.jpg',
    originalName: name,
    width: 100,
    height: 100,
    correspondences: [],
    dsoIds: [],
    labels: [],
    notes: '',
    group: null,
  } as any;
}

describe('smartSortPhotos', () => {
  it('sorts Messier objects numerically (M1 before M8 before M31 before M100)', () => {
    const photos = ['M100', 'M1', 'M31', 'M8'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('M1')).toBeLessThan(sorted.indexOf('M8'));
    expect(sorted.indexOf('M8')).toBeLessThan(sorted.indexOf('M31'));
    expect(sorted.indexOf('M31')).toBeLessThan(sorted.indexOf('M100'));
  });

  it('sorts catalogs by importance (M before NGC before IC), not alphabetically', () => {
    const photos = ['IC1805', 'NGC224', 'M31'].map(makePhoto);
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual(['M31', 'NGC224', 'IC1805']);
  });

  it('follows the full catalog importance order, unknown catalogs next, plain names last', () => {
    const photos = [
      'Andromeda Galaxy',
      'Cr399',
      'Barnard 33',
      'LDN1235',
      'SH2-101',
      'IC434',
      'vdB142',
      'M4',
      'LBN438',
      'NGC7000',
    ].map(makePhoto);
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual([
      'M4',
      'NGC7000',
      'IC434',
      'SH2-101',
      'LBN438',
      'LDN1235',
      'vdB142',
      'Barnard 33',
      'Cr399',
      'Andromeda Galaxy',
    ]);
  });

  it('reads the whole number of a Sharpless name (SH2-99 before SH2-101)', () => {
    const photos = ['SH2-101', 'Sh2 99', 'sh2_240'].map(makePhoto);
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual([
      'Sh2 99',
      'SH2-101',
      'sh2_240',
    ]);
  });

  it('keeps several photos of one object in natural order of the rest of their names', () => {
    const photos = ['M42 pass 10', 'M42', 'M42 pass 2', 'M4'].map(makePhoto);
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual([
      'M4',
      'M42',
      'M42 pass 2',
      'M42 pass 10',
    ]);
  });

  it('places a photo with no catalogue in its name by its most important solved object', () => {
    const photos = [
      makePhoto('Veil East'),
      { ...makePhoto('Andromeda_stack'), dsoIds: ['M110', 'NGC224', 'M31'] },
      makePhoto('M42'),
      makePhoto('M31_2024'),
      { ...makePhoto('Heart'), dsoIds: ['IC1805'] },
      makePhoto('NGC7000'),
    ];
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual([
      'M31_2024',
      'Andromeda_stack',
      'M42',
      'NGC7000',
      'Heart',
      'Veil East',
    ]);
  });

  it('keeps the catalogue number of the name over the solved objects', () => {
    const photos = [{ ...makePhoto('NGC7000 wide'), dsoIds: ['M1'] }, makePhoto('M42')];
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual(['M42', 'NGC7000 wide']);
  });

  it('sorts plain names in natural order, ignoring case', () => {
    const photos = ['moon 10', 'Moon 2', 'aurora'].map(makePhoto);
    expect(smartSortPhotos(photos).map((p) => p.originalName)).toEqual([
      'aurora',
      'Moon 2',
      'moon 10',
    ]);
  });

  it('sorts NGC objects numerically (NGC224 before NGC1976 before NGC7089)', () => {
    const photos = ['NGC7089', 'NGC224', 'NGC1976'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('NGC224')).toBeLessThan(sorted.indexOf('NGC1976'));
    expect(sorted.indexOf('NGC1976')).toBeLessThan(sorted.indexOf('NGC7089'));
  });

  it('SH2 objects sort after Messier and NGC', () => {
    const photos = ['SH2-280', 'M42', 'NGC1976'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('M42')).toBeLessThan(sorted.indexOf('SH2-280'));
  });

  it('Sh2 (lowercase) parses same as SH2', () => {
    const photos = ['Sh2-280', 'M42'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('M42')).toBeLessThan(sorted.indexOf('Sh2-280'));
  });

  it('objects without catalog prefix sort alphabetically at the end', () => {
    const photos = ['NGC7089', 'Andromeda Galaxy'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('NGC7089')).toBeLessThan(sorted.indexOf('Andromeda Galaxy'));
  });

  it('does not mutate the input array', () => {
    const photos = ['M100', 'M1'].map(makePhoto);
    const original = [...photos];
    smartSortPhotos(photos);
    expect(photos[0].originalName).toBe(original[0].originalName);
  });

  it('handles empty array', () => {
    expect(smartSortPhotos([])).toEqual([]);
  });

  it('handles single element', () => {
    const photos = [makePhoto('M42')];
    expect(smartSortPhotos(photos)).toHaveLength(1);
  });
});
