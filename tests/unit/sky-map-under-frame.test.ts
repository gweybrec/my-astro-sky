import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/star-catalog', () => ({
  getStars: () => [],
  getConstellationLines: () => [],
  getConstellationVertexMags: () => [],
  getConstellationInfos: () => [],
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => [],
  getDSOCatalog: () => null,
}));

import { project, toCanvas } from '@myastrosky/core/projection';
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import { SkyMap } from '@myastrosky/render/sky-map';

/** The phone's search while a frame floats: the searched object comes under the frame (note "Cadre flottant et recherche"). */
describe('SkyMap.navigateUnderFrame', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let skyMap: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({ setTransform: () => {} }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SkyMap.prototype, 'render').mockImplementation(() => {});
  });

  afterEach(() => {
    skyMap?.destroy();
    skyMap = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  function makeMap(): SkyMap {
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
      }),
    });
    const map = new SkyMap(canvas);
    skyMap = map;
    // The move is checked where it ends, without the animation.
    const fly = (map as unknown as { flyTo: (...a: unknown[]) => void }).flyTo.bind(map);
    vi.spyOn(map as never, 'flyTo').mockImplementation(((target: unknown, scale: unknown) =>
      fly(target, scale, false)) as never);
    return map;
  }

  const frame = (over: Partial<RenderableFrame>): RenderableFrame => ({
    id: 'a1',
    name: 'Équipement 1',
    label: 'Équipement 1',
    wDeg: 2,
    hDeg: 1,
    active: true,
    movable: true,
    pinnable: true,
    anchorKind: 'screen',
    nx: 0.25,
    ny: 0.3,
    ...over,
  });

  it('puts the object where the floating frame is on the screen, at the scale asked', () => {
    const map = makeMap();
    map.setFovInstances([frame({})]);
    expect(map.navigateUnderFrame('a1', 83.8, -5.4, 1500)).toBe(true);
    const view = map.getView();
    expect(view.scale).toBe(1500);
    const at = project(83.8, -5.4);
    const p = toCanvas(at.x, at.y, view);
    expect(p.x).toBeCloseTo(0.25 * view.width, 6);
    expect(p.y).toBeCloseTo(0.3 * view.height, 6);
  });

  it('does nothing for a pinned frame or one that is not there', () => {
    const map = makeMap();
    map.setFovInstances([
      frame({ anchorKind: 'sky', ra: 10, dec: 40, nx: undefined, ny: undefined }),
    ]);
    const before = { ...map.getView() };
    expect(map.navigateUnderFrame('a1', 83.8, -5.4, 1500)).toBe(false);
    expect(map.navigateUnderFrame('nope', 83.8, -5.4, 1500)).toBe(false);
    expect(map.getView().centerX).toBe(before.centerX);
    expect(map.getView().scale).toBe(before.scale);
  });
});
