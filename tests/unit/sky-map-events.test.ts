import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachSkyMapEvents,
  CLICK_SLOP_PX,
  type EventBinding,
  type SkyEventHost,
} from '../../src/sky-map-events';
import type { PhotoOutline } from '../../src/photo-outline';
import type { Star, ViewState } from '../../src/types';
import { setCenterMode, setHemisphere, setProjectionMode } from '../../src/projection';

/**
 * Pointer/keyboard routing for the sky map. These handlers decide *which subsystem
 * claims a gesture*, in a fixed precedence order — the part that is easy to break
 * and was previously unreachable without a canvas. Synthetic DOM events against a
 * stub host are enough to pin every rule.
 */

const STAR: Star = { hip: 1, ra: 0, dec: 85, mag: 2, bv: 0.5 };

/** A photo outline covering the centre of the canvas. */
const PHOTO: PhotoOutline = {
  name: 'andromeda.jpg',
  corners: [
    { x: 400, y: 300 },
    { x: 600, y: 300 },
    { x: 600, y: 500 },
    { x: 400, y: 500 },
  ],
};

function makeHost(over: Partial<SkyEventHost> = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 800;
  // happy-dom gives a zero rect for a detached canvas; pin it so client→canvas
  // coordinate conversion is the identity and the tests can use plain numbers.
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
    requestHover: vi.fn(),
    requestRenderInteractive: vi.fn(),
    render: vi.fn(),
    viewChanged: vi.fn(),
    exitPickingMode: vi.fn(),
    regionDrawPress: vi.fn(),
    regionDrawMove: vi.fn(),
    regionDrawFinish: vi.fn(),
    frameMouseDown: vi.fn(() => false),
    frameDragMove: vi.fn(),
    frameMouseUp: vi.fn(),
    frameClearInteraction: vi.fn(),
    frameSelect: vi.fn(),
    findClosestStar: vi.fn(() => null as Star | null),
    emitStarPicked: vi.fn(),
    emitPhotoClick: vi.fn(),
    emitDSOClick: vi.fn(),
    emitClearSelection: vi.fn(),
  };

  const state = {
    regionActive: false,
    regionCapturing: false,
    frameDragging: false,
    frameActive: false,
    hoveredDSO: null as { id: string } | null,
    selection: false,
  };

  const host: SkyEventHost = {
    canvas,
    view,
    borderLatDeg: 45,
    interactionEnabled: true,
    pickingMode: false,
    photoOutlines: [],
    get hoveredDSO() {
      return state.hoveredDSO;
    },
    hasSelection: () => state.selection,
    hasStarPickedHandler: () => false,
    hasPhotoClickHandler: () => true,
    regionDrawActive: () => state.regionActive,
    regionDrawCapturing: () => state.regionCapturing,
    canvasToAltAz: () => ({ azDeg: 10, altDeg: 20 }),
    frameDragActive: () => state.frameDragging,
    frameHasActive: () => state.frameActive,
    ...calls,
    ...over,
  } as SkyEventHost;

  const bindings = attachSkyMapEvents(host);
  return { host, canvas, view, calls, state, bindings };
}

let open: Array<{ bindings: EventBinding[]; canvas: HTMLCanvasElement }> = [];

function setup(over: Partial<SkyEventHost> = {}) {
  const h = makeHost(over);
  open.push({ bindings: h.bindings, canvas: h.canvas });
  return h;
}

function detach() {
  for (const { bindings, canvas } of open) {
    for (const b of bindings) b.target.removeEventListener(b.event, b.handler);
    canvas.remove();
  }
  open = [];
}

const mouse = (type: string, x: number, y: number, extra: MouseEventInit = {}) =>
  new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...extra,
  });

describe('attachSkyMapEvents', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
  });

  afterEach(detach);

  describe('wheel', () => {
    it('zooms in on a scroll up and out on a scroll down', () => {
      const { canvas, view } = setup();
      const before = view.scale;
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 500, clientY: 400, cancelable: true }),
      );
      expect(view.scale).toBeGreaterThan(before);
      const zoomedIn = view.scale;
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, clientX: 500, clientY: 400, cancelable: true }),
      );
      expect(view.scale).toBeLessThan(zoomedIn);
    });

    it('keeps the sky point under the cursor anchored (off-centre zoom shifts the view)', () => {
      const { canvas, view } = setup();
      const before = { cx: view.centerX, cy: view.centerY };
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 800, clientY: 200, cancelable: true }),
      );
      expect(view.centerX).not.toBe(before.cx);
      expect(view.centerY).not.toBe(before.cy);
    });

    it('cancels any running animation and dismisses the tooltip', () => {
      const { canvas, calls } = setup();
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 500, clientY: 400, cancelable: true }),
      );
      expect(calls.cancelAnimation).toHaveBeenCalled();
      expect(calls.dismissTooltip).toHaveBeenCalled();
      expect(calls.viewChanged).toHaveBeenCalled();
      expect(calls.requestRenderInteractive).toHaveBeenCalled();
    });
  });

  describe('mousedown precedence', () => {
    it('region drawing claims the press before frames or pan', () => {
      const { canvas, calls, state } = setup();
      state.regionActive = true;
      canvas.dispatchEvent(mouse('mousedown', 500, 400));
      expect(calls.regionDrawPress).toHaveBeenCalled();
      expect(calls.regionDrawMove).toHaveBeenCalledWith({ azDeg: 10, altDeg: 20 });
      expect(calls.frameMouseDown).not.toHaveBeenCalled();
    });

    it('a frame claims the press before pan, and hides the tooltip', () => {
      const { canvas, calls } = setup({ frameMouseDown: vi.fn(() => true) });
      canvas.dispatchEvent(mouse('mousedown', 500, 400));
      expect(calls.dismissTooltip).toHaveBeenCalled();
      // No pan started: a later mousemove must not move the view.
      const before = { cx: 0, cy: 0 };
      window.dispatchEvent(mouse('mousemove', 560, 460));
      expect(before).toEqual({ cx: 0, cy: 0 });
    });

    it('falls through to a pan when nothing claims the press', () => {
      const { canvas, view } = setup();
      canvas.dispatchEvent(mouse('mousedown', 500, 400));
      window.dispatchEvent(mouse('mousemove', 560, 440));
      expect(view.centerX).not.toBe(0);
    });

    it('ignores a non-left button', () => {
      const { canvas, calls, view } = setup();
      canvas.dispatchEvent(mouse('mousedown', 500, 400, { button: 2 }));
      expect(calls.frameMouseDown).not.toHaveBeenCalled();
      window.dispatchEvent(mouse('mousemove', 560, 440));
      expect(view.centerX).toBe(0); // no pan started
    });

    it('sets the grabbing cursor when panning, but not in picking mode', () => {
      const a = setup();
      a.canvas.dispatchEvent(mouse('mousedown', 500, 400));
      expect(a.canvas.style.cursor).toBe('grabbing');

      const b = setup({ pickingMode: true });
      b.canvas.dispatchEvent(mouse('mousedown', 500, 400));
      expect(b.canvas.style.cursor).not.toBe('grabbing');
    });
  });

  describe('mousemove precedence', () => {
    it('region drawing captures points and suppresses hover', () => {
      const { calls, state } = setup();
      state.regionActive = true;
      state.regionCapturing = true;
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.regionDrawMove).toHaveBeenCalled();
      expect(calls.dismissTooltip).toHaveBeenCalled();
      expect(calls.requestHover).not.toHaveBeenCalled();
    });

    it('suppresses hover during the whole region gesture, even before the press', () => {
      const { calls, state } = setup();
      state.regionActive = true;
      state.regionCapturing = false;
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.regionDrawMove).not.toHaveBeenCalled(); // nothing captured yet
      expect(calls.requestHover).not.toHaveBeenCalled();
    });

    it('a frame drag beats pan and hover', () => {
      const { calls, state } = setup();
      state.frameDragging = true;
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.frameDragMove).toHaveBeenCalledWith(500, 400);
      expect(calls.requestHover).not.toHaveBeenCalled();
    });

    it('panning beats hover', () => {
      const { canvas, calls } = setup();
      canvas.dispatchEvent(mouse('mousedown', 500, 400));
      window.dispatchEvent(mouse('mousemove', 540, 430));
      expect(calls.requestHover).not.toHaveBeenCalled();
      expect(calls.viewChanged).toHaveBeenCalled();
    });

    it('hover runs when nothing else claims the move', () => {
      const { calls } = setup();
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.requestHover).toHaveBeenCalledWith(500, 400, 500, 400);
    });

    it('does nothing at all when interaction is disabled', () => {
      const { calls } = setup({ interactionEnabled: false });
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.requestHover).not.toHaveBeenCalled();
      expect(calls.dismissTooltip).not.toHaveBeenCalled();
    });

    it('dismisses the tooltip outside the border circle instead of hovering', () => {
      const { calls, view } = setup();
      // Zoom out until the sky disc is smaller than the canvas, so the corners are
      // genuinely outside the rim (at the default zoom the disc covers everything).
      view.scale = 150;
      window.dispatchEvent(mouse('mousemove', 5, 795)); // black corner
      expect(calls.requestHover).not.toHaveBeenCalled();
      expect(calls.dismissTooltip).toHaveBeenCalled();

      // …and the centre of the disc still hovers normally.
      window.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.requestHover).toHaveBeenCalledWith(500, 400, 500, 400);
    });

    it('leaves the tooltip alone while the cursor is over it', () => {
      const { calls } = setup();
      const tooltip = document.createElement('div');
      tooltip.id = 'tooltip';
      document.body.appendChild(tooltip);
      tooltip.dispatchEvent(mouse('mousemove', 500, 400));
      expect(calls.requestHover).not.toHaveBeenCalled();
      expect(calls.dismissTooltip).not.toHaveBeenCalled();
      tooltip.remove();
    });
  });

  describe('mouseup precedence', () => {
    it('region drawing finishes, completing when points were captured', () => {
      const { calls, state } = setup();
      state.regionActive = true;
      state.regionCapturing = true;
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(calls.regionDrawFinish).toHaveBeenCalledWith(false);
    });

    it('a region gesture released without ever drawing is cancelled', () => {
      const { calls, state } = setup();
      state.regionActive = true;
      state.regionCapturing = false;
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(calls.regionDrawFinish).toHaveBeenCalledWith(true);
    });

    it('a frame drag release goes to the frame controller', () => {
      const { calls, state } = setup();
      state.frameDragging = true;
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(calls.frameMouseUp).toHaveBeenCalled();
    });

    it('is a no-op when nothing was pressed', () => {
      const { calls } = setup();
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(calls.emitPhotoClick).not.toHaveBeenCalled();
      expect(calls.emitDSOClick).not.toHaveBeenCalled();
    });
  });

  describe('click vs drag routing', () => {
    function press(h: ReturnType<typeof setup>, x = 500, y = 400) {
      h.canvas.dispatchEvent(mouse('mousedown', x, y));
    }

    it('a click inside a photo outline fires the photo click', () => {
      const h = setup({ photoOutlines: [PHOTO] });
      press(h);
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(h.calls.emitPhotoClick).toHaveBeenCalledWith('andromeda.jpg');
    });

    it('a drag past the slop suppresses the click', () => {
      const h = setup({ photoOutlines: [PHOTO] });
      press(h);
      const far = 500 + CLICK_SLOP_PX + 2;
      window.dispatchEvent(mouse('mouseup', far, 400));
      expect(h.calls.emitPhotoClick).not.toHaveBeenCalled();
    });

    it('a release exactly at the slop still counts as a click', () => {
      const h = setup({ photoOutlines: [PHOTO] });
      press(h);
      window.dispatchEvent(mouse('mouseup', 500 + CLICK_SLOP_PX, 400));
      expect(h.calls.emitPhotoClick).toHaveBeenCalled();
    });

    it('measures the slop as |dx| + |dy|, not per-axis', () => {
      const h = setup({ photoOutlines: [PHOTO] });
      press(h);
      // 2 + 2 = 4 > 3, though neither axis alone exceeds the slop.
      window.dispatchEvent(mouse('mouseup', 502, 402));
      expect(h.calls.emitPhotoClick).not.toHaveBeenCalled();
    });

    it('a DSO click fires alongside the photo click', () => {
      const h = setup({ photoOutlines: [PHOTO] });
      h.state.hoveredDSO = { id: 'M31' };
      press(h);
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(h.calls.emitPhotoClick).toHaveBeenCalled();
      expect(h.calls.emitDSOClick).toHaveBeenCalled();
    });

    it('picking mode selects a star and suppresses the photo/DSO paths', () => {
      const h = setup({
        pickingMode: true,
        photoOutlines: [PHOTO],
        findClosestStar: vi.fn(() => STAR),
        hasStarPickedHandler: () => true,
      });
      h.state.hoveredDSO = { id: 'M31' };
      press(h);
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(h.calls.emitStarPicked).toHaveBeenCalledWith(STAR);
      expect(h.calls.emitPhotoClick).not.toHaveBeenCalled();
      expect(h.calls.emitDSOClick).not.toHaveBeenCalled();
    });

    it('skips the star hit-test when nothing is listening for a pick', () => {
      const findClosestStar = vi.fn(() => STAR);
      const h = setup({ pickingMode: true, findClosestStar, hasStarPickedHandler: () => false });
      press(h);
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(findClosestStar).not.toHaveBeenCalled();
      expect(h.calls.emitStarPicked).not.toHaveBeenCalled();
    });

    it('restores the cursor on release (crosshair in picking mode)', () => {
      const a = setup();
      a.canvas.dispatchEvent(mouse('mousedown', 500, 400));
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(a.canvas.style.cursor).toBe('default');

      const b = setup({ pickingMode: true });
      b.canvas.dispatchEvent(mouse('mousedown', 500, 400));
      window.dispatchEvent(mouse('mouseup', 500, 400));
      expect(b.canvas.style.cursor).toBe('crosshair');
    });
  });

  describe('contextmenu', () => {
    it('clears the selection and suppresses the menu when something is selected', () => {
      const { canvas, calls, state } = setup();
      state.selection = true;
      const e = mouse('contextmenu', 500, 400);
      canvas.dispatchEvent(e);
      expect(calls.emitClearSelection).toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });

    it('leaves the browser menu alone when nothing is selected', () => {
      const { canvas, calls, state } = setup();
      state.selection = false;
      const e = mouse('contextmenu', 500, 400);
      canvas.dispatchEvent(e);
      expect(calls.emitClearSelection).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe('Escape precedence', () => {
    const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    it('cancels region drawing first', () => {
      const { calls, state } = setup({ pickingMode: true });
      state.regionActive = true;
      state.frameActive = true;
      esc();
      expect(calls.regionDrawFinish).toHaveBeenCalledWith(true);
      expect(calls.exitPickingMode).not.toHaveBeenCalled();
      expect(calls.frameSelect).not.toHaveBeenCalled();
    });

    it('exits picking mode before deselecting a frame', () => {
      const { calls, state } = setup({ pickingMode: true });
      state.frameActive = true;
      esc();
      expect(calls.exitPickingMode).toHaveBeenCalled();
      expect(calls.frameSelect).not.toHaveBeenCalled();
    });

    it('deselects the active frame, clearing any in-flight drag or snap', () => {
      const { calls, state } = setup();
      state.frameActive = true;
      esc();
      expect(calls.frameClearInteraction).toHaveBeenCalled();
      expect(calls.frameSelect).toHaveBeenCalledWith(null);
      expect(calls.render).toHaveBeenCalled();
    });

    it('does nothing when nothing is active', () => {
      const { calls } = setup();
      esc();
      expect(calls.frameSelect).not.toHaveBeenCalled();
      expect(calls.exitPickingMode).not.toHaveBeenCalled();
    });

    it('ignores other keys', () => {
      const { calls, state } = setup();
      state.frameActive = true;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(calls.frameSelect).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('returns every binding, and removing them stops all handling', () => {
      const h = setup();
      expect(h.bindings.map((b) => b.event).sort()).toEqual([
        'contextmenu',
        'keydown',
        'mousedown',
        'mousemove',
        'mouseup',
        'wheel',
      ]);

      for (const b of h.bindings) b.target.removeEventListener(b.event, b.handler);
      open = open.filter((o) => o.bindings !== h.bindings);

      const scaleBefore = h.view.scale;
      h.canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 500, clientY: 400, cancelable: true }),
      );
      window.dispatchEvent(mouse('mousemove', 500, 400));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(h.view.scale).toBe(scaleBefore);
      expect(h.calls.requestHover).not.toHaveBeenCalled();
      h.canvas.remove();
    });
  });
});
