import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachSkyMapTouch,
  LONG_PRESS_MS,
  type SkyTouchHost,
} from '@myastrosky/render/sky-map-touch';
import type { EventBinding } from '@myastrosky/render/sky-map-events';
import type { PhotoOutline } from '@myastrosky/core/photo-outline';
import type { ViewState } from '@myastrosky/core/types';
import { fromCanvas } from '@myastrosky/core/projection';

/** Touch gestures for the sky map, against a stub host and synthetic pointer events. */

function makeHost(over: Partial<SkyTouchHost> = {}) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
    }) as DOMRect;
  document.body.appendChild(canvas);
  const view: ViewState = {
    centerX: 0,
    centerY: 0,
    scale: 600,
    rotationDeg: 0,
    width: 1000,
    height: 800,
  };
  const calls = {
    cancelAnimation: vi.fn(),
    dismissTooltip: vi.fn(),
    requestRenderInteractive: vi.fn(),
    viewChanged: vi.fn(),
    findClosestStar: vi.fn(() => null),
    pickDSOAt: vi.fn(() => false),
    emitStarPicked: vi.fn(),
    emitPhotoClick: vi.fn(),
    emitDSOClick: vi.fn(),
    emitLongPress: vi.fn(),
    emitClearSelection: vi.fn(),
    regionDrawPress: vi.fn(),
    regionDrawMove: vi.fn(),
    regionDrawFinish: vi.fn(),
    frameMouseDown: vi.fn(() => false),
    frameDragMove: vi.fn(),
    frameMouseUp: vi.fn(),
  };
  const state = { region: false, capturing: false, frameDrag: false, selection: false };
  const host = {
    canvas,
    view,
    interactionEnabled: true,
    pickingMode: false,
    photoOutlines: [] as PhotoOutline[],
    hasStarPickedHandler: () => false,
    hasPhotoClickHandler: () => false,
    hasSelection: () => state.selection,
    regionDrawActive: () => state.region,
    regionDrawCapturing: () => state.capturing,
    canvasToAltAz: () => ({ azDeg: 1, altDeg: 2 }),
    frameDragActive: () => state.frameDrag,
    ...calls,
    ...over,
  } as SkyTouchHost;
  const bindings = attachSkyMapTouch(host);
  return { host, canvas, view, calls, state, bindings };
}

function fire(
  canvas: HTMLCanvasElement,
  type: string,
  id: number,
  x: number,
  y: number,
  pointerType = 'touch',
) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  canvas.dispatchEvent(e);
  return e;
}

let open: Array<{ bindings: EventBinding[]; canvas: HTMLCanvasElement }> = [];
function setup(over?: Partial<SkyTouchHost>) {
  const h = makeHost(over);
  open.push(h);
  return h;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const { bindings, canvas } of open) {
    for (const b of bindings) b.target.removeEventListener(b.event, b.handler);
    canvas.remove();
  }
  open = [];
});

describe('one finger', () => {
  it('drags the map so the sky point under the finger follows it', () => {
    const { canvas, view } = setup();
    const before = fromCanvas(500, 400, view);
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 560, 430);
    fire(canvas, 'pointerup', 1, 560, 430);
    const after = fromCanvas(560, 430, view);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('does not move the map for a wobble inside the tap slop', () => {
    const { canvas, view, calls } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 503, 402);
    expect(view.centerX).toBe(0);
    expect(calls.viewChanged).not.toHaveBeenCalled();
  });

  it('ignores a mouse pointer', () => {
    const { canvas, calls } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400, 'mouse');
    expect(calls.cancelAnimation).not.toHaveBeenCalled();
  });

  it('cancels the follow-up mouse events of a touch', () => {
    const { canvas } = setup();
    expect(fire(canvas, 'pointerdown', 1, 500, 400).defaultPrevented).toBe(true);
  });
});

describe('tap', () => {
  it('finds the object under the finger without a hover and reports it', () => {
    const { canvas, calls } = setup({ pickDSOAt: vi.fn(() => true) });
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitDSOClick).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when no object is under the finger', () => {
    const { canvas, calls } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });

  it('is not a tap after a drag', () => {
    const { canvas, calls } = setup({ pickDSOAt: vi.fn(() => true) });
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 600, 400);
    fire(canvas, 'pointerup', 1, 600, 400);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });

  it('picks a star in picking mode, and nothing else', () => {
    const star = { hip: 1, ra: 0, dec: 0, mag: 1, bv: 0 };
    const { canvas, calls } = setup({
      pickingMode: true,
      hasStarPickedHandler: () => true,
      findClosestStar: vi.fn(() => star) as never,
      pickDSOAt: vi.fn(() => true),
    });
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitStarPicked).toHaveBeenCalledWith(star);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });

  it('does not select while interaction is disabled', () => {
    const { canvas, calls } = setup({ interactionEnabled: false, pickDSOAt: vi.fn(() => true) });
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });
});

describe('long press', () => {
  it('fires once after the delay and then the lift is not a tap', () => {
    const { canvas, calls } = setup({ pickDSOAt: vi.fn(() => true) });
    fire(canvas, 'pointerdown', 1, 500, 400);
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(calls.emitLongPress).toHaveBeenCalledWith(500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });

  it('does not fire when the finger moves away first', () => {
    const { canvas, calls } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 560, 400);
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(calls.emitLongPress).not.toHaveBeenCalled();
  });

  it('does not fire when a second finger lands', () => {
    const { canvas, calls } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerdown', 2, 600, 400);
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(calls.emitLongPress).not.toHaveBeenCalled();
  });
});

describe('pinch', () => {
  it('zooms in when the fingers spread, keeping the sky under their midpoint', () => {
    const { canvas, view } = setup();
    const mid = fromCanvas(500, 400, view);
    fire(canvas, 'pointerdown', 1, 450, 400);
    fire(canvas, 'pointerdown', 2, 550, 400);
    fire(canvas, 'pointermove', 1, 400, 400);
    fire(canvas, 'pointermove', 2, 600, 400);
    expect(view.scale).toBeGreaterThan(600);
    const after = fromCanvas(500, 400, view);
    expect(after.x).toBeCloseTo(mid.x, 6);
    expect(after.y).toBeCloseTo(mid.y, 6);
  });

  it('zooms out when the fingers close', () => {
    const { canvas, view } = setup();
    fire(canvas, 'pointerdown', 1, 400, 400);
    fire(canvas, 'pointerdown', 2, 600, 400);
    fire(canvas, 'pointermove', 1, 450, 400);
    fire(canvas, 'pointermove', 2, 550, 400);
    expect(view.scale).toBeLessThan(600);
  });

  it('pans with the midpoint when both fingers slide together', () => {
    const { canvas, view } = setup();
    const before = fromCanvas(500, 400, view);
    fire(canvas, 'pointerdown', 1, 450, 400);
    fire(canvas, 'pointerdown', 2, 550, 400);
    fire(canvas, 'pointermove', 1, 450, 480);
    fire(canvas, 'pointermove', 2, 550, 480);
    expect(view.scale).toBe(600);
    const after = fromCanvas(500, 480, view);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('carries on as a drag with the finger left, and lifting it is not a tap', () => {
    const { canvas, view, calls } = setup({ pickDSOAt: vi.fn(() => true) });
    fire(canvas, 'pointerdown', 1, 450, 400);
    fire(canvas, 'pointerdown', 2, 550, 400);
    fire(canvas, 'pointerup', 2, 550, 400);
    const before = fromCanvas(450, 400, view);
    fire(canvas, 'pointermove', 1, 470, 420);
    const after = fromCanvas(470, 420, view);
    expect(after.x).toBeCloseTo(before.x, 9);
    fire(canvas, 'pointerup', 1, 470, 420);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });
});

describe('tap on an empty spot', () => {
  it('clears the selection when there is one', () => {
    const { canvas, calls, state } = setup();
    state.selection = true;
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerup', 1, 500, 400);
    expect(calls.emitClearSelection).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing is selected, or when an object was tapped', () => {
    const none = setup();
    fire(none.canvas, 'pointerdown', 1, 500, 400);
    fire(none.canvas, 'pointerup', 1, 500, 400);
    expect(none.calls.emitClearSelection).not.toHaveBeenCalled();
    const hit = setup({ pickDSOAt: vi.fn(() => true) });
    hit.state.selection = true;
    fire(hit.canvas, 'pointerdown', 1, 500, 400);
    fire(hit.canvas, 'pointerup', 1, 500, 400);
    expect(hit.calls.emitClearSelection).not.toHaveBeenCalled();
  });
});

describe('region drawing with a finger', () => {
  it('draws while the finger moves, finishes on lift, and leaves the map alone', () => {
    const { canvas, view, calls, state } = setup();
    state.region = true;
    fire(canvas, 'pointerdown', 1, 500, 400);
    expect(calls.regionDrawPress).toHaveBeenCalled();
    state.capturing = true;
    fire(canvas, 'pointermove', 1, 600, 450);
    expect(calls.regionDrawMove).toHaveBeenCalledTimes(2);
    fire(canvas, 'pointerup', 1, 600, 450);
    expect(calls.regionDrawFinish).toHaveBeenCalledWith(false);
    expect(view.centerX).toBe(0);
    expect(calls.emitDSOClick).not.toHaveBeenCalled();
  });

  it('ignores a second finger and does not long-press', () => {
    const { canvas, view, calls, state } = setup();
    state.region = true;
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointerdown', 2, 600, 400);
    fire(canvas, 'pointermove', 2, 700, 400);
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(view.scale).toBe(600);
    expect(calls.emitLongPress).not.toHaveBeenCalled();
  });
});

describe('frames with a finger', () => {
  it('drags a grabbed frame instead of the map, and releases it on lift', () => {
    const { canvas, view, calls, state } = setup({ frameMouseDown: vi.fn(() => true) });
    state.frameDrag = true;
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 560, 430);
    expect(calls.frameDragMove).toHaveBeenCalledWith(560, 430);
    expect(view.centerX).toBe(0);
    fire(canvas, 'pointerup', 1, 560, 430);
    expect(calls.frameMouseUp).toHaveBeenCalled();
  });

  it('lets a touch that misses every frame pan the map', () => {
    const { canvas, view } = setup();
    fire(canvas, 'pointerdown', 1, 500, 400);
    fire(canvas, 'pointermove', 1, 600, 400);
    expect(view.centerX).not.toBe(0);
  });
});
