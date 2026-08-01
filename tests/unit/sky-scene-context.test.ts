import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Long enough that the catalog length never becomes the binding budget constraint. */
const MAGS = Array.from({ length: 50000 }, (_, i) => 15 * Math.cbrt(i / 50000));

vi.mock('../../src/star-catalog', () => ({
  getStars: () => [],
  getStarMagsSorted: () => MAGS,
  getConstellationLines: () => [],
  getConstellationInfos: () => [],
  loadConstellationStyle: vi.fn(),
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => [],
  getDSOById: () => null,
  getDSOImportanceRank: () => new Map(),
  getDSOCatalog: () => null,
}));

import { SkyMap } from '../../src/sky-map';
import type { ViewState } from '../../src/types';

/**
 * The per-frame render context.
 *
 * The point of making the scene an explicit value is that an off-screen export is
 * just "a different scene" — before, `renderToCanvas` temporarily reassigned the live
 * `ctx`, `view` and layer flags and restored them in a `finally`, so any throw (or a
 * re-entrant render) could leave the on-screen map pointing at the export canvas.
 * These tests pin that the live map is untouched by an export.
 */

/** A canvas 2D context stub that records nothing but satisfies every call. */
function stubCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const returns: Record<string, unknown> = {
    createRadialGradient: gradient,
    createLinearGradient: gradient,
    measureText: { width: 10 },
    getImageData: { data: new Uint8ClampedArray(4) },
    canvas: { width: 0, height: 0 },
  };
  return new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      const key = prop as string;
      if (key === 'canvas') return returns.canvas;
      if (!(key in target)) {
        const fixed = returns[key];
        target[key] = fixed !== undefined ? () => fixed : () => {};
      }
      return target[key];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('SkyMap render scene', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let map: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    // One stable context per canvas, so identity comparisons are meaningful.
    const perCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      let ctx = perCanvas.get(this);
      if (!ctx) {
        ctx = stubCtx();
        perCanvas.set(this, ctx);
      }
      return ctx;
    } as never;
  });

  afterEach(() => {
    map?.destroy();
    map = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  function makeMap(): { map: SkyMap; canvas: HTMLCanvasElement } {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
      }) as DOMRect;
    document.body.appendChild(canvas);
    const m = new SkyMap(canvas);
    map = m;
    return { map: m, canvas };
  }

  /** Reads the private scene builder — this is the contract under test. */
  function buildScene(m: SkyMap, over: Record<string, unknown> = {}) {
    return (m as unknown as { buildScene: (o?: unknown) => Record<string, unknown> }).buildScene(
      over,
    );
  }

  it('builds a scene from the live map state', () => {
    const { map: m, canvas } = makeMap();
    const scene = buildScene(m);
    expect(scene.view).toEqual(m.getView());
    expect(scene.offscreen).toBe(false);
    expect(scene.ctx).toBe(canvas.getContext('2d'));
    // Layer flags mirror the map's current display settings.
    expect(scene.showStars).toBe(true);
    expect(scene.showDSOs).toBe(true);
  });

  it('applies overrides on top of the live state', () => {
    const { map: m } = makeMap();
    const exportView: ViewState = {
      centerX: 1,
      centerY: 2,
      scale: 1234,
      rotationDeg: 30,
      width: 2000,
      height: 1500,
    };
    const scene = buildScene(m, { view: exportView, offscreen: true, showDSOs: false });
    expect(scene.view).toBe(exportView);
    expect(scene.offscreen).toBe(true);
    expect(scene.showDSOs).toBe(false);
    expect(scene.showStars).toBe(true); // untouched flags keep the live value
  });

  it('derives the star budget from the scene view, not the live view', () => {
    const { map: m } = makeMap();
    const live = buildScene(m);
    const zoomed = buildScene(m, {
      view: { ...m.getView(), scale: m.getView().scale * 4 },
    });
    // The budget scales with zoom, so a bigger export view yields a bigger count.
    const liveCount = (live.starBudget as { count: number }).count;
    const zoomedCount = (zoomed.starBudget as { count: number }).count;
    expect(zoomedCount).toBeGreaterThan(liveCount);
  });

  describe('renderToCanvas', () => {
    function exportTarget() {
      const target = document.createElement('canvas');
      target.width = 400;
      target.height = 300;
      return target;
    }

    const exportView: ViewState = {
      centerX: 5,
      centerY: -5,
      scale: 999,
      rotationDeg: 45,
      width: 400,
      height: 300,
    };

    it('leaves the live view untouched', () => {
      const { map: m } = makeMap();
      const before = m.getView();
      m.renderToCanvas(exportTarget(), exportView, 2);
      expect(m.getView()).toEqual(before);
    });

    it('leaves the live layer flags untouched', () => {
      const { map: m } = makeMap();
      const before = buildScene(m);
      m.renderToCanvas(exportTarget(), exportView, 2, {
        showStars: false,
        showDSOs: false,
        showGrid: false,
        showStarLabels: false,
        showDSOLabels: false,
        showConstellationLines: false,
        showConstellationNames: false,
      });
      const after = buildScene(m);
      expect(after.showStars).toBe(before.showStars);
      expect(after.showDSOs).toBe(before.showDSOs);
      expect(after.showGrid).toBe(before.showGrid);
      expect(after.showConstellationLines).toBe(before.showConstellationLines);
    });

    it('leaves the live context untouched', () => {
      const { map: m, canvas } = makeMap();
      const before = buildScene(m).ctx;
      m.renderToCanvas(exportTarget(), exportView, 2);
      expect(buildScene(m).ctx).toBe(before);
      expect(before).toBe(canvas.getContext('2d'));
    });

    it('is a no-op when the target has no 2D context', () => {
      const { map: m } = makeMap();
      const before = m.getView();
      const target = document.createElement('canvas');
      target.getContext = () => null;
      expect(() => m.renderToCanvas(target, exportView, 2)).not.toThrow();
      expect(m.getView()).toEqual(before);
    });

    it('can be called repeatedly without drift', () => {
      const { map: m } = makeMap();
      const before = m.getView();
      for (let i = 0; i < 3; i++) m.renderToCanvas(exportTarget(), exportView, 2);
      expect(m.getView()).toEqual(before);
    });
  });
});
