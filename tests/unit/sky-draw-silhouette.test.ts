import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drawMountainHorizon } from '@myastrosky/render/sky-draw';
import { setCenterMode, setProjectionObserver, toCanvas } from '@myastrosky/core/projection';
import type { HorizonProfile } from '@myastrosky/core/horizon-io';
import type { ViewState } from '@myastrosky/core/types';

/** Path2D is absent in happy-dom: a stand-in that keeps its points. */
class FakePath2D {
  static made = 0;
  points: [number, number][] = [];
  constructor() {
    FakePath2D.made++;
  }
  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  closePath(): void {}
}

/** A context stub that records transform() and fill() calls. */
function recordingCtx() {
  const transforms: number[][] = [];
  const fills: unknown[] = [];
  const ctx = {
    transforms,
    fills,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    transform: (...m: number[]) => transforms.push(m),
    fill: (path?: unknown) => fills.push(path),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
  };
  return ctx;
}

/** Terrain 5° high all around, in two layers. */
function profile(): HorizonProfile {
  const alts = (h: number) => new Array(360).fill(h);
  return {
    lat: 45,
    lon: 6,
    obsHeightM: null,
    azStepDeg: 1,
    alts: alts(5),
    source: 'auto',
    layers: [
      { maxDistKm: 10, alts: alts(5) },
      { maxDistKm: 50, alts: alts(3) },
    ],
  } as unknown as HorizonProfile;
}

const view: ViewState = {
  centerX: 0.1,
  centerY: -0.2,
  scale: 300,
  rotationDeg: 30,
  width: 400,
  height: 800,
} as ViewState;

describe('drawMountainHorizon in local sky', () => {
  const original = (globalThis as { Path2D?: unknown }).Path2D;
  beforeAll(() => {
    (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
    setCenterMode('zenith');
    setProjectionObserver(5, 45);
  });
  afterAll(() => {
    (globalThis as { Path2D?: unknown }).Path2D = original;
    setCenterMode('pole');
  });
  beforeEach(() => {
    FakePath2D.made = 0;
  });

  it('builds each layer band once and reuses it while the view pans and zooms', () => {
    const p = profile();
    const ctx = recordingCtx();
    drawMountainHorizon(ctx as never, view, 5, 45, p);
    expect(FakePath2D.made).toBe(2);
    drawMountainHorizon(ctx as never, { ...view, centerX: 0.3, scale: 500 }, 5, 45, p);
    expect(FakePath2D.made).toBe(2);
    // Each band filled twice (colour, then the base-darkening overlay), per frame.
    expect(ctx.fills).toHaveLength(8);
  });

  it('rebuilds the bands when the sky time changes', () => {
    const p = profile();
    const ctx = recordingCtx();
    drawMountainHorizon(ctx as never, view, 5, 45, p);
    setProjectionObserver(6, 45);
    drawMountainHorizon(ctx as never, view, 6, 45, p);
    expect(FakePath2D.made).toBe(4);
  });

  it('draws the band points where toCanvas puts them', () => {
    const ctx = recordingCtx();
    drawMountainHorizon(ctx as never, view, 6, 45, profile());
    const [a, b, c, d, e, f] = ctx.transforms[0];
    const path = ctx.fills[0] as FakePath2D;
    expect(path.points.length).toBeGreaterThan(100);
    for (const [px, py] of path.points.slice(0, 40)) {
      const want = toCanvas(px, py, view);
      expect(a * px + c * py + e).toBeCloseTo(want.x, 6);
      expect(b * px + d * py + f).toBeCloseTo(want.y, 6);
    }
  });
});
