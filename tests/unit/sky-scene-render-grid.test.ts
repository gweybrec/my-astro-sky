import { describe, expect, it, vi } from 'vitest';
import type { Star, ViewState } from '@myastrosky/core/types';

/** A deterministic random catalogue over the whole sky, brightest first like the real registry. */
const stars: Star[] = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list = Array.from({ length: 20000 }, (_, i) => ({
    hip: i + 1,
    ra: rnd() * 360,
    dec: Math.asin(2 * rnd() - 1) * (180 / Math.PI),
    mag: -1 + 15 * Math.cbrt(rnd()),
    bv: rnd() * 2 - 0.3,
  }));
  return list.sort((a, b) => a.mag - b.mag);
})();

vi.mock('@myastrosky/core/catalog/star-registry', () => ({
  getStars: () => stars,
  getStarByHip: (hip: number) => stars.find((s) => s.hip === hip),
}));

import { renderStars } from '@myastrosky/render/sky-scene-render';
import { starAreaBudget } from '@myastrosky/core/star-budget';
import { setHemisphere } from '@myastrosky/core/projection';
import { SKY_THEME } from '@myastrosky/core/sky-themes';
import type { SkyScene } from '@myastrosky/render/sky-scene';

/** Every drawing call of one star pass, in order. */
function drawn(view: ViewState, starSearch: 'catalog' | 'grid', highlightedStar: number | null) {
  const calls: unknown[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const fn = (...args: unknown[]) => {
        calls.push([prop, ...args.filter((a) => typeof a === 'number')]);
        return { addColorStop() {} };
      };
      target[prop] = fn;
      return fn;
    },
  });
  const mags = stars.map((s) => s.mag);
  renderStars({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    view,
    theme: SKY_THEME,
    horizon: null,
    hemisphere: 'north',
    borderLatDeg: 30,
    localSkyMode: false,
    fisheyeMode: false,
    highlightedStar,
    belowHorizonAlpha: 0.4,
    interacting: false,
    starSearch,
    starBudget: starAreaBudget(view, 30, 3000, mags),
    atlas: {
      beginFrame: () => ({ frozen: false, spriteScale: 1 }),
      spriteFor: () => ({ canvas: { width: 4, height: 4 }, half: 2 }),
    },
  } as unknown as SkyScene);
  return calls;
}

describe('renderStars: the position index draws what the catalog walk draws', () => {
  for (const hemisphere of ['north', 'south'] as const) {
    it(`in the same order, at every zoom, pan and turn (${hemisphere})`, () => {
      setHemisphere(hemisphere);
      let total = 0;
      for (const scale of [150, 600, 2500, 10000])
        for (const [centerX, centerY] of [
          [0, 0],
          [0.3, -0.5],
          [1.2, 0.4],
        ])
          for (const rotationDeg of [0, 37])
            for (const highlighted of [null, stars[0].hip, stars[stars.length - 1].hip]) {
              const view = { centerX, centerY, scale, rotationDeg, width: 400, height: 700 };
              const grid = drawn(view, 'grid', highlighted);
              expect(grid).toEqual(drawn(view, 'catalog', highlighted));
              total += grid.length;
            }
      expect(total).toBeGreaterThan(1000);
      setHemisphere('north');
    });
  }

  it('draws stars of equal magnitude in catalog order', () => {
    // The real catalogue's magnitudes have two decimals, so many stars share one; rounding keeps the list sorted.
    const exact = stars.map((s) => s.mag);
    for (const s of stars) s.mag = Math.round(s.mag * 10) / 10;
    try {
      for (const scale of [600, 2500])
        for (const [centerX, centerY] of [
          [0, 0],
          [0.3, -0.5],
        ]) {
          const view = { centerX, centerY, scale, rotationDeg: 0, width: 400, height: 700 };
          expect(drawn(view, 'grid', null)).toEqual(drawn(view, 'catalog', null));
        }
    } finally {
      stars.forEach((s, i) => (s.mag = exact[i]));
    }
  });
});
