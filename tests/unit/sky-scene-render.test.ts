import { describe, expect, it, vi } from 'vitest';
import type { Star, ViewState } from '@myastrosky/core/types';

/** Brightest first, like the real registry: two drawable stars, then 1,000 past the cutoff. */
const stars: Star[] = [];
let faintReads = 0;
function star(hip: number, mag: number): Star {
  return { hip, ra: (hip * 7) % 360, dec: 85, mag, bv: 0.5 };
}
stars.push(star(1, 1), star(2, 2));
for (let i = 0; i < 1000; i++) {
  const s = star(100 + i, 8 + i / 1000);
  // Counts how often the loop looks at a star past the cutoff beyond its magnitude.
  Object.defineProperty(s, 'dec', {
    get: () => {
      faintReads++;
      return 85;
    },
  });
  stars.push(s);
}

vi.mock('@myastrosky/core/catalog/star-registry', () => ({
  getStars: () => stars,
  getStarByHip: (hip: number) => stars.find((s) => s.hip === hip),
}));

import { renderStars } from '@myastrosky/render/sky-scene-render';
import { SKY_THEME } from '@myastrosky/core/sky-themes';
import type { SkyScene } from '@myastrosky/render/sky-scene';

/** A 2D context whose every method is a spy (gradients included). */
function fakeCtx() {
  const calls: Record<string, unknown[][]> = {};
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const fn = (...args: unknown[]) => {
        (calls[String(prop)] ??= []).push(args);
        return { addColorStop() {} };
      };
      target[prop] = fn;
      return fn;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function scene(highlightedStar: number | null) {
  const { ctx, calls } = fakeCtx();
  const view: ViewState = {
    centerX: 0,
    centerY: 0,
    scale: 400,
    rotationDeg: 0,
    width: 800,
    height: 600,
  };
  const s = {
    ctx,
    view,
    theme: SKY_THEME,
    horizon: null,
    hemisphere: 'north',
    borderLatDeg: -30,
    localSkyMode: false,
    fisheyeMode: false,
    highlightedStar,
    belowHorizonAlpha: 0.4,
    interacting: false,
    starBudget: { mags: stars.map((x) => x.mag), count: 2, aNorm: 1, edgeMag: 5 },
    atlas: {
      beginFrame: () => ({ frozen: false, spriteScale: 1 }),
      spriteFor: () => ({ canvas: { width: 4, height: 4 }, half: 2 }),
    },
  } as unknown as SkyScene;
  return { s, calls };
}

describe('renderStars', () => {
  it('stops at the first star past the cutoff instead of visiting the rest', () => {
    faintReads = 0;
    const { s, calls } = scene(null);
    renderStars(s);
    expect(calls.drawImage).toHaveLength(2);
    expect(faintReads).toBe(0);
  });

  it('still draws a highlighted star fainter than the cutoff, with its ring', () => {
    const { s, calls } = scene(150);
    renderStars(s);
    expect(calls.drawImage).toHaveLength(2);
    expect(calls.arc?.length).toBeGreaterThan(0);
    expect(calls.stroke?.length).toBeGreaterThan(0);
  });

  it('draws a bright highlighted star once, live rather than from the atlas', () => {
    const { s, calls } = scene(1);
    renderStars(s);
    expect(calls.drawImage).toHaveLength(1);
    expect(calls.arc?.length).toBeGreaterThan(0);
  });
});
