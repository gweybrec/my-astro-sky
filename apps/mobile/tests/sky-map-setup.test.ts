import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const created: Array<{ options: Record<string, unknown>; calls: Record<string, unknown[][]> }> = [];

vi.mock('@myastrosky/render/sky-map', () => ({
  SkyMap: class {
    calls: Record<string, unknown[][]> = {};
    options: Record<string, unknown>;
    constructor(_canvas: unknown, options: Record<string, unknown>) {
      this.options = options;
      created.push(this);
      return new Proxy(this, {
        get: (target, prop: string) =>
          prop in target
            ? (target as never)[prop]
            : (...args: unknown[]) => (target.calls[prop] ??= []).push(args),
      });
    }
  },
}));

vi.mock('@myastrosky/app-state/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({
    categories: [],
    ensureLoaded: () => Promise.resolve(),
    $subscribe: () => () => {},
  }),
}));

const getPhotos = vi.fn();
vi.mock('@myastrosky/app-state/api', async (original) => ({
  ...(await original<object>()),
  getPhotos: () => getPhotos(),
  // No address: the test's DOM would try to download the pictures.
  photoFileUrl: () => '',
}));

import { writeObserverLocation } from '@myastrosky/core/observer-location';
import { DEFAULT_SETTINGS } from '@myastrosky/core/sky-time-settings';
import { DEFAULT_SETTINGS as DISPLAY_DEFAULTS } from '@myastrosky/core/display-settings';
import { useMapPortStore } from '@myastrosky/app-state/stores/map-port';
import { PhotoLayer } from '@myastrosky/render/photo-layer';
import { createPhoneSkyMap, MAX_PIXEL_RATIO, PHOTOS_FROZEN_MS } from '../src/sky-map-setup';

describe('the Ciel tab sky map', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    created.length = 0;
    localStorage.clear();
    setActivePinia(createPinia());
  });
  afterEach(() => vi.useRealTimers());

  const make = () =>
    createPhoneSkyMap(document.createElement('canvas'), {
      photoContainer: document.createElement('div'),
      onPhotoPlacementError: () => {},
    });

  it('reads the photos again loading only what changed, and drops a reading that ends after the tab was left', async () => {
    const photo = (id: string, extra: object = {}) => ({
      id,
      filename: `${id}.jpg`,
      originalName: id,
      width: 100,
      height: 80,
      manualPlacement: { centerRa: 10, centerDec: 20, rotationDeg: 0, projPerPx: 1 },
      correspondences: [],
      labels: [],
      ...extra,
    });
    const sky = make();
    const load = vi.spyOn(sky.photos, 'loadPhotos');
    const remove = vi.spyOn(sky.photos, 'removePhotosFromMap');
    const update = vi.spyOn(sky.photos, 'updatePhotosData');
    const clear = vi.spyOn(sky.photos, 'clearAllPhotos');

    getPhotos.mockResolvedValue([photo('a'), photo('b')]);
    await sky.reloadPhotos();
    await sky.reloadPhotos();
    expect(load).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    // A label changed on one, the other placed again: only the second is drawn again.
    getPhotos.mockResolvedValue([
      photo('a', { labels: ['x'] }),
      photo('b', {
        manualPlacement: { centerRa: 11, centerDec: 20, rotationDeg: 0, projPerPx: 1 },
      }),
    ]);
    await sky.reloadPhotos();
    expect(update.mock.calls[0][0].map((p) => p.id)).toEqual(['a']);
    expect(remove).toHaveBeenLastCalledWith(['b']);
    expect(load.mock.lastCall![0].map((p) => p.id)).toEqual(['b']);

    getPhotos.mockResolvedValue([photo('a', { labels: ['x'] })]);
    sky.setActive(false);
    await sky.reloadPhotos();
    expect(sky.photos.getPlacedPhotos()).toHaveLength(2);
  });

  it('is built for a phone: touch, density capped, follows rotation, no side panel', () => {
    make();
    const { options } = created[0];
    expect(options.touch).toBe(true);
    expect(options.maxPixelRatio).toBe(MAX_PIXEL_RATIO);
    expect(options.followCanvasSize).toBe(true);
    expect((options.isOverPanel as (x: number) => boolean)(10_000)).toBe(false);
  });

  it('frames a placed photo as the desktop does, and stays put for a photo that is not on the map', () => {
    const sky = make();
    const { calls } = created[0];
    sky.showPhoto('unknown');
    expect(calls.navigateTo).toBeUndefined();
    vi.spyOn(sky.photos, 'getPhotoCenterAndScale').mockReturnValue({ ra: 10, dec: 41, scale: 900 });
    sky.showPhoto('p1');
    expect(calls.navigateTo).toEqual([[10, 41, 900]]);
  });

  it("zooms on a setup's field so it fills a third of the map, as the desktop's show on map", () => {
    const sky = make();
    const { calls } = created[0];
    Object.assign(sky.map, { getView: () => ({ width: 400, height: 800, scale: 100 }) });
    sky.focus({ ra: 10, dec: 41, scale: 0, fov: { wDeg: 2, hDeg: 1.5 } });
    sky.focus({ ra: 10, dec: 41, scale: 0, fov: { wDeg: 0.5, hDeg: 0.4 } });
    const [wide, narrow] = calls.navigateTo.map((c) => c[2] as number);
    expect(wide).toBeGreaterThan(300);
    expect(narrow).toBeCloseTo(wide * 4, 0);
  });

  it('hands the map to the shared stores through the port, and takes it back on destroy', () => {
    const sky = make();
    expect(useMapPortStore().skyMap).not.toBeNull();
    sky.destroy();
    expect(useMapPortStore().skyMap).toBeNull();
  });

  it('opens on the full sky (live mode) with the observing location, and no clock', () => {
    writeObserverLocation(48.58, 7.75);
    make();
    const { calls } = created[0];
    expect(calls.setSkyTimeMode).toEqual([['live']]);
    expect(calls.setObserverLocation.at(-1)).toEqual([48.58, 7.75]);
    const ticks = calls.setSimDate.length;
    vi.advanceTimersByTime(3000);
    expect(calls.setSimDate.length).toBe(ticks);
  });

  it('follows the clock in saved date mode', () => {
    localStorage.setItem(
      'sky-time-settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, mode: 'date' }),
    );
    make();
    const { calls } = created[0];
    expect(calls.setSkyTimeMode).toEqual([['date']]);
    const before = calls.setSimDate.length;
    vi.advanceTimersByTime(3000);
    expect(calls.setSimDate.length).toBeGreaterThan(before);
  });

  it('moves the photos with the view, without loading a full picture until the view has stopped', () => {
    const place = vi.spyOn(PhotoLayer.prototype, 'updateTransforms');
    createPhoneSkyMap(document.createElement('canvas'), {
      photoContainer: document.createElement('div'),
      onPhotoPlacementError: () => {},
    });
    const viewChanged = created[0].calls.setOnViewChange[0][0] as (reason?: string) => void;
    place.mockClear();

    // A gesture of 10 moves, 30 ms apart: the photos are placed on every move, as moving.
    for (let i = 0; i < 10; i++) {
      viewChanged('view');
      vi.advanceTimersByTime(30);
    }
    expect(place.mock.calls).toEqual(Array(10).fill([true]));

    // Still for PHOTOS_FROZEN_MS after the last move: placed once more, no longer moving.
    vi.advanceTimersByTime(PHOTOS_FROZEN_MS);
    expect(place).toHaveBeenCalledTimes(11);
    expect(place.mock.calls[10]).toEqual([]);

    // A clock tick with the view still: placed, not as moving.
    viewChanged('skyClock');
    expect(place.mock.calls[11]).toEqual([false]);
    place.mockRestore();
  });

  it('draws photo outlines off by default', () => {
    make();
    expect(created[0].calls.setShowPhotoOutlines).toEqual([[false]]);
  });

  it('applies the saved display settings to the map', () => {
    localStorage.setItem(
      'display-settings',
      JSON.stringify({
        ...DISPLAY_DEFAULTS,
        hemisphere: 'south',
        borderLatDeg: 30,
        mapRotationDeg: 90,
        showStars: false,
        showConstellationLines: false,
        showDSOLabels: false,
        showGrid: true,
        showPhotoOutlines: true,
        skyOpacity: 0.3,
        showDSOs: false,
        autoStarDensity: false,
        maxStarCount: 1234,
      }),
    );
    make();
    const { calls } = created[0];
    expect(calls.setHemisphere).toEqual([['south', 30]]);
    expect(calls.setRotationDeg).toEqual([[90]]);
    expect(calls.setShowStars).toEqual([[false]]);
    expect(calls.setShowConstellationLines).toEqual([[false]]);
    expect(calls.setShowDSOLabels).toEqual([[false]]);
    expect(calls.setShowGrid).toEqual([[true]]);
    expect(calls.setShowPhotoOutlines).toEqual([[true]]);
    expect(calls.setSkyOpacity).toEqual([[0.3]]);
    expect(calls.setShowDSOs).toEqual([[false]]);
    expect(calls.setAutoStarDensity).toEqual([[false]]);
    expect(calls.setMaxStarCount).toEqual([[1234]]);
  });

  it('draws again when a theme is chosen, and stops listening once destroyed', () => {
    const sky = make();
    const { calls } = created[0];
    const before = calls.requestRender?.length ?? 0;
    window.dispatchEvent(new CustomEvent('app-theme-changed'));
    expect(calls.requestRender.length).toBe(before + 1);
    sky.destroy();
    window.dispatchEvent(new CustomEvent('app-theme-changed'));
    expect(calls.requestRender.length).toBe(before + 1);
  });

  it('reads the location again after Réglages changed it', () => {
    const sky = make();
    writeObserverLocation(-33.9, 18.4);
    sky.refreshLocation();
    expect(created[0].calls.setObserverLocation.at(-1)).toEqual([-33.9, 18.4]);
  });
});
