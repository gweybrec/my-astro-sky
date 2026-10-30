import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DsoOutlines, drawDsoMarkerFill, dsoMarkerHasFill } from '@myastrosky/render/dso-draw';

/** A canvas 2D context stub that records the name and arguments of every call. */
function recordingCtx(): CanvasRenderingContext2D & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const target: Record<string, unknown> = { calls };
  return new Proxy(target, {
    get(t, prop) {
      const key = prop as string;
      if (!(key in t)) {
        t[key] = (...args: unknown[]) => {
          calls.push([key, args]);
          return key.startsWith('create') ? { addColorStop: () => {} } : undefined;
        };
      }
      return t[key];
    },
    set(t, prop, value) {
      calls.push([`set ${String(prop)}`, [value]]);
      t[prop as string] = value;
      return true;
    },
  }) as never;
}

const names = (ctx: { calls: [string, unknown[]][] }): string[] => ctx.calls.map(([n]) => n);

describe('drawDsoMarkerFill', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    // Every canvas (the pre-drawn fills included) gets a context, so the fills can be made.
    HTMLCanvasElement.prototype.getContext = function () {
      return recordingCtx();
    } as never;
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  let ctx: ReturnType<typeof recordingCtx>;
  beforeEach(() => {
    ctx = recordingCtx();
  });

  it('stretches a pre-drawn fill over the ellipse instead of filling a gradient', () => {
    drawDsoMarkerFill(ctx, 'Gx', 10, 4);
    expect(names(ctx)).not.toContain('createRadialGradient');
    const draw = ctx.calls.find(([n]) => n === 'drawImage')!;
    const [sprite, x, y, w, h] = draw[1] as [HTMLCanvasElement, number, number, number, number];
    expect([x, y, w, h]).toEqual([-10, -4, 20, 8]);
    expect(sprite.width).toBe(32); // the smallest size at least 20 px across
    // The outline is not drawn here (see DsoOutlines).
    expect(names(ctx)).not.toContain('stroke');
  });

  it('stretches a circle marker to its major radius', () => {
    drawDsoMarkerFill(ctx, 'GC', 6, 3);
    const draw = ctx.calls.find(([n]) => n === 'drawImage')!;
    expect(draw[1].slice(1)).toEqual([-6, -6, 12, 12]);
  });

  it('reuses one pre-drawn fill per style and size', () => {
    drawDsoMarkerFill(ctx, 'EN', 5, 5);
    drawDsoMarkerFill(ctx, 'EN', 7, 3);
    const sprites = ctx.calls.filter(([n]) => n === 'drawImage').map(([, a]) => a[0]);
    expect(sprites).toHaveLength(2);
    expect(sprites[0]).toBe(sprites[1]);
  });

  it('keeps the live gradient where a picture would show its edge (supernova remnant rim)', () => {
    drawDsoMarkerFill(ctx, 'SNR', 10, 6);
    expect(names(ctx)).toContain('createRadialGradient');
    expect(names(ctx)).not.toContain('drawImage');
  });

  it('keeps the live gradient when it reaches past the body, or the marker is larger than every picture', () => {
    drawDsoMarkerFill(ctx, 'GxE', 4, 8); // radiusMode 'max' with ry > rx
    drawDsoMarkerFill(ctx, 'Gx', 200, 100); // 400 px across
    expect(names(ctx).filter((n) => n === 'createRadialGradient')).toHaveLength(2);
    expect(names(ctx)).not.toContain('drawImage');
  });

  it('fills a one-colour style with its colour', () => {
    drawDsoMarkerFill(ctx, 'PS', 3, 3);
    expect(names(ctx)).not.toContain('createRadialGradient');
    expect(names(ctx)).not.toContain('drawImage');
    expect(ctx.calls).toContainEqual(['set fillStyle', ['rgba(230, 220, 200, 0.5)']]);
  });

  it('draws nothing for an outline-only style', () => {
    expect(dsoMarkerHasFill('OC')).toBe(false);
    drawDsoMarkerFill(ctx, 'OC', 5, 5);
    expect(ctx.calls).toEqual([]);
  });
});

describe('DsoOutlines', () => {
  const strokes = (ctx: ReturnType<typeof recordingCtx>) =>
    names(ctx).filter((n) => n === 'stroke').length;

  it('strokes the outlines of a style and opacity once, however many markers', () => {
    const ctx = recordingCtx();
    const outlines = new DsoOutlines();
    for (let i = 0; i < 50; i++) outlines.add('Gx', 10 * i, 20, 6, 3, 0.5, 0.8);
    outlines.draw(ctx);
    expect(strokes(ctx)).toBe(1);
    expect(names(ctx).filter((n) => n === 'ellipse')).toHaveLength(50);
    // Each ellipse starts its own piece of the path, at its first point (rx along the turned axis).
    const i = ctx.calls.findIndex(([n]) => n === 'ellipse');
    expect(ctx.calls[i - 1][0]).toBe('moveTo');
    expect(ctx.calls[i - 1][1][0]).toBeCloseTo(6 * Math.cos(0.5));
    expect(ctx.calls[i][1]).toEqual([0, 20, 6, 3, 0.5, 0, Math.PI * 2]);
  });

  it('groups by type and by opacity rounded to 1/20', () => {
    const ctx = recordingCtx();
    const outlines = new DsoOutlines();
    outlines.add('Gx', 0, 0, 5, 5, 0, 0.8);
    outlines.add('Gx', 0, 0, 5, 5, 0, 0.81); // rounds to 0.8
    outlines.add('Gx', 0, 0, 5, 5, 0, 0.5);
    outlines.add('EN', 0, 0, 5, 5, 0, 0.8);
    outlines.draw(ctx);
    expect(strokes(ctx)).toBe(3);
    expect(ctx.calls.filter(([n]) => n === 'set globalAlpha').map(([, a]) => a[0])).toContain(0.8);
  });

  it('draws a circle marker round, with its turned cross, and the planetary nebula inner ring', () => {
    const ctx = recordingCtx();
    const outlines = new DsoOutlines();
    outlines.add('GC', 100, 50, 8, 3, Math.PI / 2, 1);
    outlines.add('PN', 0, 0, 10, 10, 0, 1);
    outlines.draw(ctx);
    const ellipses = ctx.calls.filter(([n]) => n === 'ellipse').map(([, a]) => a.slice(0, 4));
    expect(ellipses).toContainEqual([100, 50, 8, 8]); // a circle keeps rx
    expect(ellipses).toContainEqual([0, 0, 10, 10]);
    expect(ellipses).toContainEqual([0, 0, 4, 4]); // inner ring at 0.4 × rx
    // The cross turned a quarter: its first arm is vertical.
    const lines = ctx.calls
      .filter(([n]) => n === 'moveTo' || n === 'lineTo')
      .map(([, a]) => a as number[]);
    const arm = lines.findIndex(([x, y]) => Math.abs(x - 100) < 1e-9 && Math.abs(y - 42) < 1e-9);
    expect(arm).toBeGreaterThanOrEqual(0);
    expect(lines[arm + 1][0]).toBeCloseTo(100);
    expect(lines[arm + 1][1]).toBeCloseTo(58);
  });

  it('dashes only the dashed style, and leaves the opacity and dash as found', () => {
    const ctx = recordingCtx();
    (ctx as unknown as { globalAlpha: number }).globalAlpha = 0.7;
    const outlines = new DsoOutlines();
    outlines.add('OC', 0, 0, 5, 5, 0, 1);
    outlines.add('Gx', 0, 0, 5, 5, 0, 1);
    outlines.draw(ctx);
    const dashes = ctx.calls.filter(([n]) => n === 'setLineDash').map(([, a]) => a[0]);
    expect(dashes).toEqual([[3, 3], [], []]);
    expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(0.7);
    // Drawn once: a second draw strokes nothing.
    const before = strokes(ctx);
    outlines.draw(ctx);
    expect(strokes(ctx)).toBe(before);
  });
});

describe('DsoOutlines at a very low opacity', () => {
  it('strokes nothing for markers that would round to transparent', () => {
    const ctx = recordingCtx();
    const outlines = new DsoOutlines();
    outlines.add('Gx', 0, 0, 5, 5, 0, 0.02);
    outlines.add('Gx', 10, 0, 5, 5, 0, 0);
    outlines.draw(ctx);
    expect(names(ctx).filter((n) => n === 'stroke')).toEqual([]);
  });
});

describe('drawDsoMarkerFill on a high-density screen', () => {
  it('chooses the pre-drawn fill by the size in canvas pixels', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return recordingCtx();
    } as never;
    try {
      const ctx = recordingCtx();
      drawDsoMarkerFill(ctx, 'Gx', 10, 4, 2); // 20 view px across, 40 canvas px
      const sprite = ctx.calls.find(([n]) => n === 'drawImage')![1][0] as HTMLCanvasElement;
      expect(sprite.width).toBe(64);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});
