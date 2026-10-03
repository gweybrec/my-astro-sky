/**
 * Tests for PhotoOverlay.getPoiPins(): the positioned POIs (e.g. identified
 * supernovae) the sky map pins above the photo layer. They must follow the same
 * visibility rules as the photo itself — hidden photo, global photo toggle,
 * label filter — plus the "Show points of interest" toggle and the per-POI
 * dropdown (checked = shown; it hides pins, never photos), and carry their POI
 * type's colour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PhotoOverlay } from '../../src/photo-overlay';
import type { PoiCategory } from '../../src/types';
import { poiKey } from '../../src/poi';

const CATEGORIES: PoiCategory[] = [
  { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
];

function makePhoto(id: string, labels: string[] = []) {
  return {
    id,
    filename: `${id}.jpg`,
    originalName: `photo-${id}`,
    width: 100,
    height: 100,
    correspondences: [],
    labels,
    pointsOfInterest: [
      { name: `SN ${id}`, categoryId: 'cat-supernova', ra: 339.27, dec: 34.41 },
      { name: `Comet ${id}`, categoryId: 'cat-comet' },
    ],
  } as any;
}

describe('PhotoOverlay.getPoiPins()', () => {
  let overlay: PhotoOverlay;
  const requestRender = vi.fn();

  beforeEach(() => {
    requestRender.mockClear();
    overlay = new PhotoOverlay(document.createElement('div'), () => ({}) as any, {
      requestRender,
    } as any);
    overlay.setPoiCategories(CATEGORIES);
    overlay.loadPhotos([makePhoto('1', ['A']), makePhoto('2', ['B'])]);
  });

  it('returns only positioned POIs, coloured by their type', () => {
    expect(overlay.getPoiPins()).toEqual([
      { ra: 339.27, dec: 34.41, label: 'SN 1', color: '#ff5a5a' },
      { ra: 339.27, dec: 34.41, label: 'SN 2', color: '#ff5a5a' },
    ]);
  });

  it('drops the pins of a hidden photo and repaints the sky map', () => {
    overlay.toggleVisibility('1');
    expect(overlay.getPoiPins().map((p) => p.label)).toEqual(['SN 2']);
    expect(requestRender).toHaveBeenCalled();
  });

  it('drops the pins of label-filtered photos', () => {
    overlay.setVisibleLabels({ A: false, B: true });
    expect(overlay.getPoiPins().map((p) => p.label)).toEqual(['SN 2']);
  });

  it('"Show points of interest" off hides every pin but keeps the photos', () => {
    overlay.setShowPois(false);
    expect(overlay.getPoiPins()).toEqual([]);
    for (const placed of overlay.getPlacedPhotos()) {
      expect(placed.imgEl.style.display).not.toBe('none');
    }
    overlay.setShowPois(true);
    expect(overlay.getPoiPins()).toHaveLength(2);
  });

  it('an unchecked POI in the sky dropdown hides its pin, not its photo', () => {
    // Checked = shown (absent ⇒ shown); only an explicit false hides.
    overlay.setVisiblePois({ [poiKey('cat-supernova', 'SN 1')]: false });
    expect(overlay.getPoiPins().map((p) => p.label)).toEqual(['SN 2']);
    const p1 = overlay.getPlacedPhotos().find((p) => p.photo.id === '1')!;
    expect(p1.imgEl.style.display).not.toBe('none');
    overlay.setVisiblePois({ [poiKey('cat-supernova', 'SN 1')]: true });
    expect(overlay.getPoiPins()).toHaveLength(2);
  });

  it('returns nothing when photos are globally hidden', () => {
    overlay.setShowPhotos(false);
    expect(overlay.getPoiPins()).toEqual([]);
  });
});
