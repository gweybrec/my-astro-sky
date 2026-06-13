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

import { fromCanvas } from '../../src/projection';
import { SkyMap, normalizeRotationDeg } from '../../src/sky-map';

describe('SkyMap rotation', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let skyMap: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: () => {},
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
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    const map = new SkyMap(canvas);
    skyMap = map;
    return { map, canvas };
  }

  it('normalizes rotation degrees into [-180, 180]', () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(180)).toBe(180);
    expect(normalizeRotationDeg(181)).toBe(-179);
    expect(normalizeRotationDeg(359)).toBe(-1);
    expect(normalizeRotationDeg(540)).toBe(180);
    expect(normalizeRotationDeg(-181)).toBe(179);
    expect(normalizeRotationDeg(-360)).toBe(0);
  });

  it('setRotationDeg, rotateByDeg and resetRotation update view rotation', () => {
    const { map } = makeMap();

    map.setRotationDeg(200);
    expect(map.getView().rotationDeg).toBe(-160);

    map.rotateByDeg(25);
    expect(map.getView().rotationDeg).toBe(-135);

    map.resetRotation();
    expect(map.getView().rotationDeg).toBe(0);
  });

  it('wheel zoom keeps the same projection point under cursor with rotation', () => {
    const { map, canvas } = makeMap();
    map.setRotationDeg(35);

    const mx = 610;
    const my = 190;
    const before = fromCanvas(mx, my, map.getView());

    const wheelEvt = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
    Object.defineProperties(wheelEvt, {
      deltaY: { value: -120 },
      clientX: { value: mx },
      clientY: { value: my },
    });
    canvas.dispatchEvent(wheelEvt);

    const after = fromCanvas(mx, my, map.getView());
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('drag pan keeps anchor projection point under cursor with rotation', () => {
    const { map, canvas } = makeMap();
    map.setRotationDeg(28);

    const startX = 520;
    const startY = 260;
    const endX = 470;
    const endY = 315;

    const anchor = fromCanvas(startX, startY, map.getView());

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      button: 0,
      clientX: startX,
      clientY: startY,
      bubbles: true,
      cancelable: true,
    }));

    window.dispatchEvent(new MouseEvent('mousemove', {
      clientX: endX,
      clientY: endY,
      bubbles: true,
      cancelable: true,
    }));

    const after = fromCanvas(endX, endY, map.getView());
    expect(after.x).toBeCloseTo(anchor.x, 8);
    expect(after.y).toBeCloseTo(anchor.y, 8);

    window.dispatchEvent(new MouseEvent('mouseup', {
      button: 0,
      clientX: endX,
      clientY: endY,
      bubbles: true,
      cancelable: true,
    }));
  });
});
