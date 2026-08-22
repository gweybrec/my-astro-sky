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
import type { ViewChangeReason } from '../../src/sky-map-types';

/**
 * `onViewChange` fires for two very different things, and listeners must be able to tell
 * them apart: a real view move ('view') versus the simulated clock advancing in local-sky
 * mode ('skyClock'), which re-derives the zenith projection while the view itself sits
 * still. Conflating them is what dismissed the hover tooltip once per clock tick.
 */
describe('SkyMap onViewChange reason', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let skyMap: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          setTransform: () => {},
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SkyMap.prototype, 'render').mockImplementation(() => {});
  });

  afterEach(() => {
    skyMap?.destroy();
    skyMap = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  function makeMap(): { map: SkyMap; reasons: ViewChangeReason[] } {
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
    const reasons: ViewChangeReason[] = [];
    map.setOnViewChange((reason) => reasons.push(reason));
    return { map, reasons };
  }

  /** Local-sky mode needs date mode plus an observer location, or it stays off. */
  function enterLocalSky(map: SkyMap) {
    map.setSkyTimeMode('date');
    map.setObserverLocation(45, 5);
    map.setSimDate(new Date('2026-03-14T21:00:00Z'));
    map.setLocalSkyMode(true);
  }

  it('reports view moves as "view"', () => {
    const { map, reasons } = makeMap();

    map.panBy(20, 10);
    map.zoomBy(1.2);
    map.setRotationDeg(30);

    expect(reasons).toEqual(['view', 'view', 'view']);
  });

  it('reports entering local-sky mode as "view" (it resets center/scale/rotation)', () => {
    const { map, reasons } = makeMap();

    enterLocalSky(map);

    expect(map.getLocalSkyMode()).toBe(true);
    expect(reasons.at(-1)).toBe('view');
    expect(reasons).not.toContain('skyClock');
  });

  it('reports a simulated-clock tick in local-sky mode as "skyClock"', () => {
    const { map, reasons } = makeMap();
    enterLocalSky(map);
    reasons.length = 0;

    map.setSimDate(new Date('2026-03-14T21:00:01Z'));
    map.setSimDate(new Date('2026-03-14T21:00:02Z'));

    expect(reasons).toEqual(['skyClock', 'skyClock']);
  });

  it('does not fire at all for a clock tick outside local-sky mode', () => {
    const { map, reasons } = makeMap();
    map.setSkyTimeMode('date');
    map.setObserverLocation(45, 5);
    reasons.length = 0;

    map.setSimDate(new Date('2026-03-14T22:00:00Z'));

    expect(reasons).toEqual([]);
  });
});
