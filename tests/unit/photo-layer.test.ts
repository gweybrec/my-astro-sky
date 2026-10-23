import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoLayer } from '@myastrosky/render/photo-layer';
import type { Photo, ViewState } from '@myastrosky/core/types';
import { setCenterMode, setHemisphere, setProjectionMode } from '@myastrosky/core/projection';

/** The photo layer on its own: its files and its errors come from the hooks of the app that uses it. */

const VIEW: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 500,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

const placedPhoto = (id: string, over: Partial<Photo> = {}): Photo =>
  ({
    id,
    filename: `${id}.jpg`,
    thumbFilename: `${id}-thumb.jpg`,
    originalName: `photo-${id}`,
    width: 100,
    height: 100,
    correspondences: [],
    manualPlacement: {
      centerRa: 0,
      centerDec: 60,
      rotationDeg: 0,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    },
    ...over,
  }) as unknown as Photo;

describe('PhotoLayer', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
  });
  afterEach(() => vi.restoreAllMocks());

  const make = (hooks: Partial<ConstructorParameters<typeof PhotoLayer>[2]> = {}) => {
    const container = document.createElement('div');
    const layer = new PhotoLayer(container, () => VIEW, {
      photoUrl: (name) => `/files/${name}`,
      ...hooks,
    });
    return { container, layer };
  };

  it('stops the downloads of the pictures not loaded yet while paused, and starts them again', () => {
    const { container, layer } = make();
    layer.loadPhotos([placedPhoto('1'), placedPhoto('2')]);
    const [first, second] = [...container.querySelectorAll('img')];
    Object.defineProperty(first, 'complete', { value: true });
    Object.defineProperty(second, 'complete', { value: false });
    layer.setLoadingPaused(true);
    expect(first.getAttribute('src')).toBe('/files/1.jpg');
    expect(second.hasAttribute('src')).toBe(false);
    layer.setLoadingPaused(false);
    expect(second.getAttribute('src')).toBe('/files/2.jpg');
  });

  it('replaces a turned photo by its new picture, keeping its draw order, opacity and hiding', () => {
    const { container, layer } = make();
    layer.loadPhotos([placedPhoto('1'), placedPhoto('2'), placedPhoto('3')]);
    layer.setPhotoOpacity('2', 0.4);
    layer.toggleVisibility('2');
    const changed = vi.fn();
    layer.addOnPhotosChanged(changed);
    layer.replacePhoto(placedPhoto('2', { filename: '2-b.jpg', width: 60, height: 100 }));
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      '/files/1.jpg',
      '/files/2-b.jpg',
      '/files/3.jpg',
    ]);
    expect([imgs[1].style.width, imgs[1].style.opacity, imgs[1].style.display]).toEqual([
      '60px',
      '0.4',
      'none',
    ]);
    const placed = layer.getPlacedPhotos();
    expect(placed.map((p) => p.photo.id)).toEqual(['1', '2', '3']);
    expect(placed[1]).toMatchObject({ visible: false, opacity: 0.4 });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('takes the address of a photo file from the app', () => {
    const { container, layer } = make();
    layer.loadPhotos([placedPhoto('1')]);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/files/1.jpg');
    expect(img.className).toBe('photo-overlay-img');
    expect(img.style.width).toBe('100px');
  });

  it('moves a placed photo with a CSS matrix at the view', () => {
    const { container, layer } = make();
    layer.loadPhotos([placedPhoto('1')]);
    layer.updateTransforms();
    expect(container.querySelector('img')!.style.transform).toMatch(/^matrix\(/);
  });

  it('tells the app once when a photo cannot be placed', () => {
    const onPlacementError = vi.fn();
    const { layer } = make({ onPlacementError });
    // Three points on a line: the affine fit has no solution.
    const colinear = placedPhoto('1', {
      manualPlacement: undefined,
      // Three stars at one sky position, three different photo points: the fit has no solution.
      correspondences: [0, 1, 2].map((i) => ({
        pointIndex: i,
        photoX: i * 10,
        photoY: i * 10,
        starHip: 0,
        starName: `s${i}`,
        starRa: 10,
        starDec: 50,
      })) as never,
    });
    layer.loadPhotos([colinear]);
    layer.updateTransforms();
    layer.updateTransforms();
    expect(onPlacementError).toHaveBeenCalledTimes(1);
    expect(onPlacementError.mock.calls[0][0].id).toBe('1');
  });

  it('tells the app when a loaded photo is not the size stored with it', () => {
    const onDimensionMismatch = vi.fn();
    const { container, layer } = make({ onDimensionMismatch });
    layer.loadPhotos([placedPhoto('1')]);
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 80 });
    Object.defineProperty(img, 'naturalHeight', { value: 100 });
    Object.defineProperty(img, 'src', { value: new URL('/files/1.jpg', document.baseURI).href });
    img.onload?.(new Event('load'));
    expect(onDimensionMismatch).toHaveBeenCalledWith(expect.anything(), '100×100', '80×100');
  });

  it('hides every photo with the global switch and shows them again', () => {
    const { container, layer } = make();
    layer.loadPhotos([placedPhoto('1')]);
    layer.updateTransforms();
    const img = container.querySelector('img')!;
    layer.setShowPhotos(false);
    expect(img.style.display).toBe('none');
    layer.setShowPhotos(true);
    expect(img.style.display).toBe('block');
  });

  it('redraws the map when the photos pins or visibility change', () => {
    const requestRender = vi.fn();
    const { layer } = make({ skyMap: { requestRender } });
    layer.setShowPois(false);
    layer.setVisiblePois({});
    layer.setShowPhotos(false);
    expect(requestRender).toHaveBeenCalledTimes(3);
  });
});
