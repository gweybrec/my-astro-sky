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

  it('starts a photo placed by its stars with its thumbnail, and loads the full picture once it shows large', async () => {
    const starPlaced = (id: string, spread: number, size = 100) =>
      placedPhoto(id, {
        width: size,
        height: size,
        thumbFilename: `${id}-thumb.jpg`,
        manualPlacement: undefined,
        correspondences: [
          [0, 0, 10, 50],
          [100, 0, 10 + spread, 50],
          [0, 100, 10, 50 + spread],
        ].map(([photoX, photoY, starRa, starDec], i) => ({
          pointIndex: i,
          photoX,
          photoY,
          starHip: 0,
          starName: `s${i}`,
          starRa,
          starDec,
        })) as never,
      });
    // The full picture is decoded off-screen before it replaces the thumbnail.
    const decodes: { src: string; done: () => void }[] = [];
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (
      this: HTMLImageElement,
    ) {
      return new Promise<void>((done) => decodes.push({ src: this.getAttribute('src')!, done }));
    });
    const { container, layer } = make();
    // its first 100 px spanning 0.01° it shows tiny; a 1000 px photo whose first 100 px span 40° shows over 300 px
    layer.loadPhotos([
      starPlaced('small', 0.01),
      starPlaced('large', 40, 1000),
      placedPhoto('hand'),
    ]);
    const src = () => [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(src()).toEqual(['/files/small-thumb.jpg', '/files/large-thumb.jpg', '/files/hand.jpg']);
    layer.updateTransforms();
    layer.updateTransforms();
    // still the thumbnail while the full picture decodes, and one decode for both frames
    expect(src()).toEqual(['/files/small-thumb.jpg', '/files/large-thumb.jpg', '/files/hand.jpg']);
    expect(decodes.map((d) => d.src)).toEqual(['/files/large.jpg']);
    decodes[0].done();
    await Promise.resolve();
    expect(src()).toEqual(['/files/small-thumb.jpg', '/files/large.jpg', '/files/hand.jpg']);
  });

  it('keeps the thumbnail when the photo shows small again before its full picture is decoded', async () => {
    let finish = () => {};
    const decode = vi
      .spyOn(HTMLImageElement.prototype, 'decode')
      .mockImplementation(() => new Promise<void>((done) => (finish = done)));
    const photo = placedPhoto('big', {
      width: 1000,
      height: 1000,
      thumbFilename: 'big-thumb.jpg',
      manualPlacement: undefined,
      correspondences: [
        [0, 0, 10, 50],
        [100, 0, 50, 50],
        [0, 100, 10, 90],
      ].map(([photoX, photoY, starRa, starDec], i) => ({
        pointIndex: i,
        photoX,
        photoY,
        starHip: 0,
        starName: `s${i}`,
        starRa,
        starDec,
      })) as never,
    });
    let view = VIEW;
    const container = document.createElement('div');
    const layer = new PhotoLayer(container, () => view, { photoUrl: (name) => `/files/${name}` });
    layer.loadPhotos([photo]);
    layer.updateTransforms(); // shows large: the full picture starts decoding
    expect(decode).toHaveBeenCalledTimes(1);
    view = { ...VIEW, scale: 0.5 }; // zoomed far out: the photo shows small again
    layer.updateTransforms();
    finish();
    await Promise.resolve();
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/files/big-thumb.jpg');
  });

  describe('a large photo with a medium-sized copy', () => {
    // A hand-placed 4000 × 3000 photo at the pole: its longer side spans 4000 × 0.0001 × scale page pixels.
    const setUp = ({ medium = true } = {}) => {
      vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
      let view = VIEW;
      const container = document.createElement('div');
      const layer = new PhotoLayer(container, () => view, { photoUrl: (name) => `/files/${name}` });
      layer.loadPhotos([
        placedPhoto('big', {
          width: 4000,
          height: 3000,
          thumbFilename: 'big-thumb.jpg',
          mediumFilename: medium ? 'big-medium.jpg' : undefined,
          manualPlacement: {
            centerRa: 0,
            centerDec: 90,
            rotationDeg: 0,
            projPerPx: 0.0001,
            mirrorX: false,
            mirrorY: false,
          },
        }),
      ]);
      const img = container.querySelector('img')!;
      const shownAt = async (scale: number, moving = false) => {
        view = { ...VIEW, scale };
        layer.updateTransforms(moving);
        await new Promise((r) => setTimeout(r, 0));
        return img.getAttribute('src');
      };
      return { img, shownAt };
    };
    afterEach(() => vi.unstubAllGlobals());

    it('shows its thumbnail, then the copy, then the full picture as it shows larger, and back', async () => {
      const { img, shownAt } = setUp();
      expect(img.getAttribute('src')).toBe('/files/big-thumb.jpg');
      expect(await shownAt(900)).toBe('/files/big-thumb.jpg'); // 360 px: not over the thumbnail's 400
      expect(await shownAt(2500)).toBe('/files/big-medium.jpg'); // 1000 px
      expect(await shownAt(5000)).toBe('/files/big-medium.jpg'); // 2000 px: not over the copy's 2048
      expect(await shownAt(10000)).toBe('/files/big.jpg'); // 4000 px
      expect(await shownAt(2500)).toBe('/files/big-medium.jpg');
      expect(await shownAt(500)).toBe('/files/big-thumb.jpg');
    });

    it('while the view moves, shows the copy instead of loading the full picture, and keeps a full one shown', async () => {
      const { shownAt } = setUp();
      expect(await shownAt(10000, true)).toBe('/files/big-medium.jpg'); // 4000 px, but moving
      expect(await shownAt(10000)).toBe('/files/big.jpg'); // stopped: the full picture
      expect(await shownAt(12000, true)).toBe('/files/big.jpg'); // kept while moving
      expect(await shownAt(500, true)).toBe('/files/big.jpg'); // even when it shows small
      expect(await shownAt(500)).toBe('/files/big-thumb.jpg');
      expect(await shownAt(2500, true)).toBe('/files/big-medium.jpg'); // smaller pictures still follow the size
    });

    it('loads no full picture when the copy finishes loading during the gesture', async () => {
      const { img, shownAt } = setUp();
      expect(await shownAt(10000, true)).toBe('/files/big-medium.jpg');
      img.onload?.(new Event('load')); // the copy has loaded: the photo is placed again
      await new Promise((r) => setTimeout(r, 0));
      expect(img.getAttribute('src')).toBe('/files/big-medium.jpg');
      expect(await shownAt(10000)).toBe('/files/big.jpg'); // the view has stopped
    });

    it('without a copy, loads the full picture while moving as at rest, not the stretched thumbnail', async () => {
      const { shownAt } = setUp({ medium: false });
      expect(await shownAt(10000, true)).toBe('/files/big.jpg');
    });

    it('counts the screen pixels, not the page pixels', async () => {
      vi.stubGlobal('devicePixelRatio', 2);
      const { shownAt } = setUp();
      expect(await shownAt(900)).toBe('/files/big-medium.jpg'); // 360 page px, 720 screen px
      expect(await shownAt(5000)).toBe('/files/big.jpg'); // 2000 page px, 4000 screen px
    });
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
