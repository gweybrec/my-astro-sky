import { describe, expect, it } from 'vitest';
import { renderDSOs } from '@myastrosky/render/sky-scene-render';
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

function render(skyOpacity: number, highlightedDSO: string | null) {
  const ctx = recordingCtx();
  renderDSOs({
    ctx,
    view: { centerX: 0, centerY: 0, scale: 800, rotationDeg: 0, width: 800, height: 800 },
    horizon: null,
    highlightedDSO,
    localSkyMode: false,
    skyOpacity,
    belowHorizonAlpha: 0.4,
    selectedDSOs: () => [dso('A', 'Gx', 10), dso('B', 'OC', 20), dso('C', 'EN', 30)],
  } as unknown as SkyScene);
  return ctx.calls;
}

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
});
