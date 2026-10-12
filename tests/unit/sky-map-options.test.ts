import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/star-catalog', () => ({
  getStars: () => [],
  getConstellationLines: () => [],
  getConstellationInfos: () => [],
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => [],
  getDSOCatalog: () => null,
}));

import { SkyMap, type SkyMapOptions } from '@myastrosky/render/sky-map';

/** What an app can change about how the map reads its page. */
describe('SkyMap options', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalRatio: number;
  let map: SkyMap | null = null;
  let box = { width: 800, height: 600 };
  let resizeCallback: (() => void) | null = null;
  let disconnected = false;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalRatio = window.devicePixelRatio;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({ setTransform: vi.fn(), clearRect: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SkyMap.prototype, 'render').mockImplementation(() => {});
    box = { width: 800, height: 600 };
    disconnected = false;
    resizeCallback = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    );
  });

  afterEach(() => {
    map?.destroy();
    map = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    Object.defineProperty(window, 'devicePixelRatio', { value: originalRatio, configurable: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function make(options?: SkyMapOptions) {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, ...box, right: box.width, bottom: box.height, x: 0, y: 0 }),
    });
    map = new SkyMap(canvas, options);
    return canvas;
  }
  const ratio = (r: number) =>
    Object.defineProperty(window, 'devicePixelRatio', { value: r, configurable: true });

  it('uses the screen density when there is no cap', () => {
    ratio(3);
    expect(make().width).toBe(2400);
  });

  it('caps the density at maxPixelRatio', () => {
    ratio(3);
    expect(make({ maxPixelRatio: 2 }).width).toBe(1600);
  });

  it('keeps a lower density than the cap', () => {
    ratio(1.5);
    expect(make({ maxPixelRatio: 2 }).width).toBe(1200);
  });

  it('resizes when the canvas box changes, with followCanvasSize', () => {
    ratio(1);
    const canvas = make({ followCanvasSize: true });
    box = { width: 600, height: 800 };
    resizeCallback?.();
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(800);
    expect(map!.getView().width).toBe(600);
  });

  it('does not watch the canvas size by default, and stops watching on destroy', () => {
    make();
    expect(resizeCallback).toBeNull();
    map!.destroy();
    map = null;
    make({ followCanvasSize: true });
    map!.destroy();
    expect(disconnected).toBe(true);
    map = null;
  });

  it('resetView() goes back to the opening view', () => {
    ratio(1);
    make();
    map!.setRotationDeg(40);
    map!.panBy(100, 50);
    expect(map!.getView().rotationDeg).toBe(40);
    expect(map!.getView().centerX).not.toBe(0);
    map!.resetView();
    const after = map!.getView();
    expect(after.centerX).toBe(0);
    expect(after.centerY).toBe(0);
    expect(after.rotationDeg).toBe(0);
    expect(after.scale).toBeCloseTo(600 / 2.2, 6);
  });

  it('sets touch-action none only when touch is on', () => {
    expect(make().style.touchAction).toBe('');
    map!.destroy();
    expect(make({ touch: true }).style.touchAction).toBe('none');
  });
});
