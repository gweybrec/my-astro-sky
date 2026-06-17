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

import { SkyMap } from '../../src/sky-map';

describe('SkyMap overlay canvas', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let skyMap: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D));

    vi.spyOn(SkyMap.prototype, 'render').mockImplementation(() => {});
  });

  afterEach(() => {
    skyMap?.destroy();
    skyMap = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  function makeMap(): { map: SkyMap; canvas: HTMLCanvasElement } {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, width: 800, height: 600,
        right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
      }),
    });
    const map = new SkyMap(canvas);
    skyMap = map;
    return { map, canvas };
  }

  it('getOverlayCanvas() returns null before setOverlayCanvas() is called', () => {
    const { map } = makeMap();
    expect(map.getOverlayCanvas()).toBeNull();
  });

  it('setOverlayCanvas() / getOverlayCanvas() round-trip', () => {
    const { map } = makeMap();
    const overlayCanvas = document.createElement('canvas');
    map.setOverlayCanvas(overlayCanvas);
    expect(map.getOverlayCanvas()).toBe(overlayCanvas);
  });

  it('setOverlayCanvas() syncs overlay canvas backing-store dimensions to match the main canvas', () => {
    const { map, canvas } = makeMap();

    // resize() was called by the constructor — manually trigger the canvas sizing
    // that resize() would have produced (render is mocked so we reproduce the effect).
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 800 * dpr;
    canvas.height = 600 * dpr;

    const overlayCanvas = document.createElement('canvas');
    map.setOverlayCanvas(overlayCanvas);

    expect(overlayCanvas.width).toBe(canvas.width);
    expect(overlayCanvas.height).toBe(canvas.height);
  });

  it('resize() re-syncs overlay canvas dimensions when overlay is already set', () => {
    const { map, canvas } = makeMap();
    const overlayCanvas = document.createElement('canvas');
    map.setOverlayCanvas(overlayCanvas);

    // Force new dimensions on the main canvas as resize() would set them.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 1024 * dpr;
    canvas.height = 768 * dpr;

    map.resize();

    expect(overlayCanvas.width).toBe(canvas.width);
    expect(overlayCanvas.height).toBe(canvas.height);
  });
});
