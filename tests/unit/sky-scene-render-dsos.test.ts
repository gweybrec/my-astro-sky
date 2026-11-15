import { describe, expect, it } from 'vitest';
import { renderDSOs, renderDSOLabels } from '@myastrosky/render/sky-scene-render';
import { SELECTION_RING } from '@myastrosky/core/canvas-theme';
import type { SkyScene } from '@myastrosky/render/sky-scene';
import type { DSO } from '@myastrosky/core/types';

/** A canvas context stub recording calls and property sets, in order. */
function recordingCtx() {
  const calls: [string, unknown[]][] = [];
  const target: Record<string, unknown> = { calls, globalAlpha: 1 };
  return new Proxy(target, {
    get(t, prop) {
      const key = prop as string;
      if (!(key in t)) {
        t[key] = (...args: unknown[]) => {
          calls.push([key, args]);
          return key.startsWith('create') ? { addColorStop() {} } : undefined;
        };
      }
      return t[key];
    },
    set(t, prop, value) {
      calls.push([`set ${String(prop)}`, [value]]);
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { calls: [string, unknown[]][] };
}

const dso = (id: string, type: DSO['type'], ra: number): DSO =>
  ({ id, type, ra, dec: 60, majAxis: 30, minAxis: 15, pa: 20, mag: 8 }) as DSO;

function scene(
  ctx: CanvasRenderingContext2D,
  skyOpacity: number,
  highlightedDSO: string | null,
  photoFootprints: { x: number; y: number }[][] = [],
): SkyScene {
  return {
    ctx,
    view: { centerX: 0, centerY: 0, scale: 800, rotationDeg: 0, width: 800, height: 800 },
    horizon: null,
    highlightedDSO,
    localSkyMode: false,
    skyOpacity,
    belowHorizonAlpha: 0.4,
    selectedDSOs: () => [dso('A', 'Gx', 10), dso('B', 'OC', 20), dso('C', 'EN', 30)],
    photoFootprints,
  } as unknown as SkyScene;
}

function render(skyOpacity: number, highlightedDSO: string | null) {
  const ctx = recordingCtx();
  renderDSOs(scene(ctx, skyOpacity, highlightedDSO));
  return ctx.calls;
}

const PHOTO_A = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];
const PHOTO_B = PHOTO_A.map((p) => ({ x: p.x + 150, y: p.y + 50 }));

describe('renderDSOs', () => {
  it('leaves the selected object’s ring to the overlay, above the photos (no ring under them)', () => {
    const styles = render(1, 'B')
      .filter(([n]) => n === 'set strokeStyle')
      .map(([, [v]]) => v);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles).not.toContain(SELECTION_RING.color);
  });

  it('draws no outline when the sky opacity is 0', () => {
    const calls = render(0, null);
    expect(calls.filter(([n]) => n === 'stroke')).toEqual([]);
  });

  it('draws no marker under a photo: each shown photo is cut out of the clip, overlaps included', () => {
    const ctx = recordingCtx();
    renderDSOs(scene(ctx, 1, null, [PHOTO_A, PHOTO_B]));
    const names = ctx.calls.map(([n]) => n);
    const clips = ctx.calls.filter(([n]) => n === 'clip');
    // One clip per photo, each the outside of that photo (even-odd: the big rectangle minus the photo); successive
    // clips intersect, so a point under either photo, or both, is outside the clip.
    expect(clips).toEqual([
      ['clip', ['evenodd']],
      ['clip', ['evenodd']],
    ]);
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('stroke'));
    expect(names.lastIndexOf('restore')).toBeGreaterThan(names.lastIndexOf('stroke'));
  });

  it('clips nothing when no photo is shown', () => {
    expect(render(1, null).filter(([n]) => n === 'clip')).toEqual([]);
  });
});

describe('renderDSOLabels', () => {
  it('draws no label under a photo either', () => {
    const ctx = recordingCtx();
    ctx.measureText = () => ({ width: 10 }) as TextMetrics;
    renderDSOLabels(scene(ctx, 1, null, [PHOTO_A]));
    const names = ctx.calls.map(([n]) => n);
    expect(names.filter((n) => n === 'clip')).toHaveLength(1);
    expect(names[names.length - 1]).toBe('restore');
  });
});
