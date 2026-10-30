import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drawDsoMarker } from '@myastrosky/render/dso-draw';

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

describe('drawDsoMarker', () => {
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
    drawDsoMarker(ctx, 'Gx', 10, 4);
    expect(names(ctx)).not.toContain('createRadialGradient');
    const draw = ctx.calls.find(([n]) => n === 'drawImage')!;
    const [sprite, x, y, w, h] = draw[1] as [HTMLCanvasElement, number, number, number, number];
    expect([x, y, w, h]).toEqual([-10, -4, 20, 8]);
    expect(sprite.width).toBe(32); // the smallest size at least 20 px across
    // The outline is still stroked over the body.
    expect(names(ctx)).toContain('stroke');
  });

  it('stretches a circle marker to its major radius', () => {
    drawDsoMarker(ctx, 'GC', 6, 3);
    const draw = ctx.calls.find(([n]) => n === 'drawImage')!;
    expect(draw[1].slice(1)).toEqual([-6, -6, 12, 12]);
  });

  it('reuses one pre-drawn fill per style and size', () => {
    drawDsoMarker(ctx, 'EN', 5, 5);
    drawDsoMarker(ctx, 'EN', 7, 3);
    const sprites = ctx.calls.filter(([n]) => n === 'drawImage').map(([, a]) => a[0]);
    expect(sprites).toHaveLength(2);
    expect(sprites[0]).toBe(sprites[1]);
  });

  it('keeps the live gradient where a picture would show its edge (supernova remnant rim)', () => {
    drawDsoMarker(ctx, 'SNR', 10, 6);
    expect(names(ctx)).toContain('createRadialGradient');
    expect(names(ctx)).not.toContain('drawImage');
  });

  it('keeps the live gradient when it reaches past the body, or the marker is larger than every picture', () => {
    drawDsoMarker(ctx, 'GxE', 4, 8); // radiusMode 'max' with ry > rx
    drawDsoMarker(ctx, 'Gx', 200, 100); // 400 px across
    expect(names(ctx).filter((n) => n === 'createRadialGradient')).toHaveLength(2);
    expect(names(ctx)).not.toContain('drawImage');
  });

  it('fills a one-colour style with its colour', () => {
    drawDsoMarker(ctx, 'PS', 3, 3);
    expect(names(ctx)).not.toContain('createRadialGradient');
    expect(names(ctx)).not.toContain('drawImage');
    expect(ctx.calls).toContainEqual(['set fillStyle', ['rgba(230, 220, 200, 0.5)']]);
  });

  it('draws outline-only styles without a fill', () => {
    drawDsoMarker(ctx, 'OC', 5, 5);
    expect(names(ctx)).not.toContain('fill');
    expect(names(ctx)).not.toContain('drawImage');
    expect(names(ctx)).toContain('stroke');
  });
});
