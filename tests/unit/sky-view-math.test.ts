import { describe, expect, it, beforeEach } from 'vitest';
import {
  easeInOutCubic, navigateDurationMs, navigateProfile, zoomAboutPoint,
} from '../../src/sky-view-math';
import { fromCanvas, setHemisphere } from '../../src/projection';
import type { ViewState } from '../../src/types';

const view: ViewState = { centerX: 0.1, centerY: 0.2, scale: 600, rotationDeg: 0, width: 800, height: 600 };

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });

  it('is monotonic increasing', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('navigateDurationMs', () => {
  it('floors at 300ms for a tiny move', () => {
    expect(navigateDurationMs(0, 1)).toBe(300);
  });

  it('caps at 1200ms for a large move + big zoom', () => {
    expect(navigateDurationMs(1, 1e6)).toBe(1200);
  });

  it('grows with distance and zoom ratio', () => {
    expect(navigateDurationMs(0.5, 1)).toBeGreaterThan(navigateDurationMs(0, 1));
    expect(navigateDurationMs(0, 8)).toBeGreaterThan(navigateDurationMs(0, 1));
  });
});

describe('navigateProfile', () => {
  it('reports a zoomRatio ≥ 1 regardless of zoom direction', () => {
    const zin = navigateProfile(view, view.centerX, view.centerY, view.scale * 4);
    const zout = navigateProfile(view, view.centerX, view.centerY, view.scale / 4);
    expect(zin.zoomRatio).toBeCloseTo(4, 6);
    expect(zout.zoomRatio).toBeCloseTo(4, 6);
  });

  it('clamps normalizedDist to 1 for a far target', () => {
    const p = navigateProfile(view, 100, 100, view.scale);
    expect(p.normalizedDist).toBe(1);
  });
});

describe('zoomAboutPoint', () => {
  beforeEach(() => setHemisphere('north'));

  it('keeps the projection point under the cursor fixed across the zoom', () => {
    const mx = 520, my = 240;
    const before = fromCanvas(mx, my, view);
    const z = zoomAboutPoint(view, mx, my, 1.1, 50, 1e6);
    const after = fromCanvas(mx, my, { ...view, scale: z.scale, centerX: z.centerX, centerY: z.centerY });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('applies the zoom factor and respects the max clamp', () => {
    expect(zoomAboutPoint(view, 400, 300, 1.1, 50, 1e6).scale).toBeCloseTo(660, 6);
    expect(zoomAboutPoint(view, 400, 300, 1000, 50, 700).scale).toBe(700); // clamped
  });

  it('respects the min clamp when zooming out hard', () => {
    expect(zoomAboutPoint(view, 400, 300, 0.001, 50, 1e6).scale).toBe(50);
  });
});
