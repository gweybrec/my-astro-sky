import { describe, it, expect, vi } from 'vitest';
import { smartSortPhotos } from '../../src/gallery';

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

  it('sorts catalog prefixes alphabetically (IC before M before NGC)', () => {
    // smartSortPhotos uses localeCompare on catalog names: IC < M < NGC alphabetically
    const photos = ['NGC224', 'M31', 'IC1805'].map(makePhoto);
    const sorted = smartSortPhotos(photos).map((p) => p.originalName);
    expect(sorted.indexOf('IC1805')).toBeLessThan(sorted.indexOf('M31'));
    expect(sorted.indexOf('M31')).toBeLessThan(sorted.indexOf('NGC224'));
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
