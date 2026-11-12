import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Photo, ViewState } from '@myastrosky/core/types';
import { setCenterMode, setHemisphere, setProjectionMode } from '@myastrosky/core/projection';

/**
 * The photo layer with WebGL (happy-dom has none: a stand-in drawer records what it is asked to draw). The photos
 * follow the view while it moves, as they did as images.
 */
const render = vi.fn((_view: ViewState, photos: unknown[]) => {
  drawn.push(photos.length);
  return { pending: false, failed: [] };
});
let drawn: number[] = [];
vi.mock('@myastrosky/render/photo-gl', () => ({
  PhotoGlRenderer: { create: () => ({ render, release: vi.fn(), clear: vi.fn() }) },
}));

const { PhotoLayer } = await import('@myastrosky/render/photo-layer');

const VIEW: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 500,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

const photo = {
  id: '1',
  filename: '1.jpg',
  originalName: 'one',
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
    angleOnSky: true,
  },
} as unknown as Photo;

describe('PhotoLayer with WebGL', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
    drawn = [];
    render.mockClear();
  });

  const make = () => {
    const container = document.createElement('div');
    const layer = new PhotoLayer(container, () => VIEW, { photoUrl: (n) => `/files/${n}` });
    layer.loadPhotos([photo]);
    const img = layer.getPlacedPhotos()[0].imgEl;
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 100 });
    img.dispatchEvent(new Event('load'));
    return { container, layer, img };
  };

  it('draws on one canvas over the map and keeps the images out of the page', () => {
    const { container } = make();
    const canvases = container.querySelectorAll('canvas.photo-gl-canvas');
    expect(canvases).toHaveLength(1);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('keeps drawing the photos while the view moves', () => {
    const { container, layer } = make();
    // The apps mark the layer while the view moves; the photos must still follow it.
    container.classList.add('photos-frozen');
    layer.updateTransforms(true);
    expect(drawn.at(-1)).toBe(1);
    // and the canvas is not one of the elements that mark hides (`.photos-frozen .photo-overlay-img`).
    expect(container.querySelector('canvas')!.classList.contains('photo-overlay-img')).toBe(false);
  });
});
