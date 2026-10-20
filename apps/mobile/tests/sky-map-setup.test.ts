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
import { useMapPortStore } from '@myastrosky/app-state/stores/map-port';
import { createPhoneSkyMap, MAX_PIXEL_RATIO } from '../src/sky-map-setup';

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

  it('applies the saved photo display settings (outlines are off by default)', () => {
    make();
    expect(created[0].calls.setShowPhotoOutlines).toEqual([[false]]);
  });

  it('reads the location again after Réglages changed it', () => {
    const sky = make();
    writeObserverLocation(-33.9, 18.4);
    sky.refreshLocation();
    expect(created[0].calls.setObserverLocation.at(-1)).toEqual([-33.9, 18.4]);
  });
});
