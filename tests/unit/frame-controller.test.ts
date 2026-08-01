import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DSO, DSOType, ViewState } from '../../src/types';
import type { RenderableFrame, FovFrameChange } from '../../src/sky-map-types';
import { FrameController, type FrameHost } from '../../src/frame-controller';
import { frameGeometry, framePinGlyphPos } from '../../src/frame-geometry';
import { rotateHandlePos } from '../../src/fov-frame-geometry';
import { setCenterMode, setHemisphere, setProjectionMode } from '../../src/projection';

/**
 * The interactive FOV-frame state machine, driven against a stub host — no canvas.
 *
 * The mousedown priority order is the most regression-prone part: a handle that is
 * hit-tested in the wrong order silently steals a gesture from another (e.g. the
 * centre move dot swallowing a corner resize). Each ordering rule gets its own test.
 */

/**
 * Zoomed in far enough (~52 px/deg near dec 85) that a 3° frame renders large
 * enough for `frameHandlesVisible` — otherwise every handle test would silently
 * fall through to the border-move path.
 */
function view(over: Partial<ViewState> = {}): ViewState {
  return { centerX: 0, centerY: 0, scale: 6000, rotationDeg: 0, width: 1000, height: 800, ...over };
}

function makeFrame(over: Partial<RenderableFrame> & { id: string }): RenderableFrame {
  return {
    name: 'Setup',
    label: 'Setup 1.0° × 0.8°',
    wDeg: 1,
    hDeg: 0.8,
    active: false,
    movable: true,
    anchorKind: 'sky',
    ra: 0,
    dec: 85,
    paDeg: 0,
    ...over,
  };
}

function makeDSO(over: Partial<DSO> & { id: string }): DSO {
  return {
    ra: 0,
    dec: 85,
    type: 'GxS' as DSOType,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    mag: 8,
    displayName: over.id,
    catalogs: [over.id],
    emissionLines: null,
    constellation: 'UMi',
    rating: 3,
    difficulty: 2,
    containerId: null,
    priority: 0,
    catalog: 'NGC',
    ...over,
  };
}

interface Harness {
  fc: FrameController;
  host: FrameHost;
  changes: Array<{ id: string; change: FovFrameChange }>;
  selects: Array<string | null>;
  resizes: Array<{ id: string; region: unknown }>;
  tileAdds: Array<{ ra: number; dec: number }>;
  tileRemoves: string[];
  merges: Array<{ movedId: string; targetId: string }>;
  render: ReturnType<typeof vi.fn>;
  navigateTo: ReturnType<typeof vi.fn>;
  /** DSO returned by findClosestDSO — set per test. */
  nearDso: DSO | null;
  /** DSOs returned by dsosInFrame — set per test. */
  framedDsos: DSO[];
  v: ViewState;
}

function harness(
  over: { v?: ViewState; interactionEnabled?: boolean; pickingMode?: boolean } = {},
) {
  const state = {
    nearDso: null as DSO | null,
    framedDsos: [] as DSO[],
    v: over.v ?? view(),
  };
  const changes: Harness['changes'] = [];
  const selects: Harness['selects'] = [];
  const resizes: Harness['resizes'] = [];
  const tileAdds: Harness['tileAdds'] = [];
  const tileRemoves: string[] = [];
  const merges: Harness['merges'] = [];
  const render = vi.fn();
  const navigateTo = vi.fn();

  const host: FrameHost = {
    get view() {
      return state.v;
    },
    interactionEnabled: over.interactionEnabled ?? true,
    pickingMode: over.pickingMode ?? false,
    findClosestDSO: () => state.nearDso,
    dsosInFrame: () => state.framedDsos,
    requestRenderInteractive: vi.fn(),
    render,
    navigateTo,
  };

  const fc = new FrameController(host);
  fc.setOnChange((id, change) => changes.push({ id, change }));
  fc.setOnSelect((id) => selects.push(id));
  fc.setOnResize((id, region) => resizes.push({ id, region }));
  fc.setOnTileAdd((ra, dec) => tileAdds.push({ ra, dec }));
  fc.setOnTileRemove((id) => tileRemoves.push(id));
  fc.setOnMerge((movedId, targetId) => merges.push({ movedId, targetId }));

  return {
    fc,
    host,
    changes,
    selects,
    resizes,
    tileAdds,
    tileRemoves,
    merges,
    render,
    navigateTo,
    state,
  };
}

/** A frame big enough on screen that its handles are shown. */
function bigActiveFrame(over: Partial<RenderableFrame> = {}): RenderableFrame {
  return makeFrame({ id: 'f1', active: true, wDeg: 3, hDeg: 3, ...over });
}

describe('FrameController', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
  });

  describe('handleMouseDown — guards', () => {
    it('does not consume the press when there are no frames', () => {
      const h = harness();
      expect(h.fc.handleMouseDown(500, 400)).toBe(false);
    });

    it('does not consume the press when interaction is disabled', () => {
      const h = harness({ interactionEnabled: false });
      h.fc.setFrames([bigActiveFrame()]);
      const geo = frameGeometry(h.fc.frames[0], h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(false);
    });

    it('does not consume the press in star-picking mode', () => {
      const h = harness({ pickingMode: true });
      h.fc.setFrames([bigActiveFrame()]);
      const geo = frameGeometry(h.fc.frames[0], h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(false);
    });

    it('falls through to a pan when the press lands on empty sky', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame()]);
      expect(h.fc.handleMouseDown(5, 5)).toBe(false);
      expect(h.fc.activeDrag).toBeNull();
    });
  });

  describe('handleMouseDown — priority order', () => {
    it('the rotate handle wins', () => {
      const h = harness();
      const f = bigActiveFrame({ pinnable: true, resizable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      const rh = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24);
      expect(h.fc.handleMouseDown(rh.x, rh.y)).toBe(true);
      expect(h.fc.activeDrag).toEqual({ id: 'f1', mode: 'rotate' });
    });

    it('the pin glyph toggles the pin rather than starting a drag', () => {
      const h = harness();
      const f = bigActiveFrame({ pinnable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      const pin = framePinGlyphPos(geo.corners[1], geo.rotDeg);
      expect(h.fc.handleMouseDown(pin.x, pin.y)).toBe(true);
      expect(h.fc.activeDrag).toBeNull();
      // Sky-anchored → the pin toggle emits a screen anchor.
      expect(h.changes).toHaveLength(1);
      expect(h.changes[0].change.anchor?.kind).toBe('screen');
    });

    it('the pin glyph is ignored on a frame that is not pinnable', () => {
      const h = harness();
      const f = bigActiveFrame({ pinnable: false });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      const pin = framePinGlyphPos(geo.corners[1], geo.rotDeg);
      h.fc.handleMouseDown(pin.x, pin.y);
      expect(h.changes).toHaveLength(0);
    });

    it('a corner resize handle beats the centre move dot and the border', () => {
      const h = harness();
      const f = bigActiveFrame({ resizable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      for (let i = 0; i < geo.corners.length; i++) {
        h.fc.clearInteraction();
        expect(h.fc.handleMouseDown(geo.corners[i].x, geo.corners[i].y)).toBe(true);
        expect(h.fc.activeDrag).toEqual({ id: 'f1', mode: 'resize', corner: i });
      }
    });

    it('a corner is not a resize handle when the frame is not resizable', () => {
      const h = harness();
      const f = bigActiveFrame({ resizable: false });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.corners[0].x, geo.corners[0].y);
      // The corner still sits on the border, so it becomes a move — not a resize.
      expect(h.fc.activeDrag?.mode).toBe('move');
    });

    it('the centre dot starts a move', () => {
      const h = harness();
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(true);
      expect(h.fc.activeDrag).toEqual({ id: 'f1', mode: 'move' });
    });

    it('the border starts a move even when the frame is too small for handles', () => {
      const h = harness();
      // Tiny on screen → frameHandlesVisible is false, so no centre dot…
      const f = makeFrame({ id: 'f1', active: true, wDeg: 0.02, hDeg: 0.02 });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      expect(h.fc.frameHandlesVisible(geo.halfW, geo.halfH)).toBe(false);
      // …but the border is still grabbable.
      expect(h.fc.handleMouseDown(geo.corners[0].x, geo.corners[0].y)).toBe(true);
      expect(h.fc.activeDrag?.mode).toBe('move');
    });

    it('an immovable frame is not moved by its centre or its border', () => {
      const h = harness();
      const f = bigActiveFrame({ movable: false });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(false);
      expect(h.fc.handleMouseDown(geo.corners[0].x, geo.corners[0].y)).toBe(false);
      expect(h.fc.activeDrag).toBeNull();
    });
  });

  describe('handleMouseDown — selection', () => {
    it('selects an inactive frame clicked anywhere inside it', () => {
      const h = harness();
      const other = makeFrame({ id: 'other', wDeg: 3, hDeg: 3 });
      h.fc.setFrames([other]);
      const geo = frameGeometry(other, h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(true);
      expect(h.selects).toEqual(['other']);
    });

    it('selects the topmost of two overlapping frames', () => {
      const h = harness();
      const under = makeFrame({ id: 'under', wDeg: 3, hDeg: 3 });
      const over = makeFrame({ id: 'over', wDeg: 3, hDeg: 3 });
      h.fc.setFrames([under, over]); // later entries are on top
      const geo = frameGeometry(over, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      expect(h.selects).toEqual(['over']);
    });

    it('never selects a hidden frame', () => {
      const h = harness();
      const hidden = makeFrame({ id: 'hidden', wDeg: 3, hDeg: 3, visible: false });
      h.fc.setFrames([hidden]);
      const geo = frameGeometry(hidden, h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(false);
      expect(h.selects).toEqual([]);
    });

    it('never selects a mosaic tile — the outline frame is selectable instead', () => {
      const h = harness();
      const tile = makeFrame({ id: 'tile', wDeg: 3, hDeg: 3, mosaicId: 'm1' });
      h.fc.setFrames([tile]);
      const geo = frameGeometry(tile, h.state.v);
      expect(h.fc.handleMouseDown(geo.cx, geo.cy)).toBe(false);
      expect(h.selects).toEqual([]);
    });
  });

  describe('handleDragMove', () => {
    it('is a no-op with no drag in progress', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame()]);
      h.fc.handleDragMove(100, 100);
      expect(h.changes).toEqual([]);
    });

    it('clears the drag when the dragged frame disappears', () => {
      const h = harness();
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.setFrames([]); // e.g. the plan was deleted mid-drag
      h.fc.handleDragMove(200, 200);
      expect(h.fc.activeDrag).toBeNull();
    });

    it('a sky-anchored move emits an updated sky anchor', () => {
      const h = harness();
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 30, geo.cy + 30);
      expect(h.changes).toHaveLength(1);
      expect(h.changes[0].change.anchor?.kind).toBe('sky');
      expect(typeof h.changes[0].change.paDeg).toBe('number');
    });

    it('a floating move emits normalised screen coordinates', () => {
      const h = harness();
      const f = bigActiveFrame({ anchorKind: 'screen', nx: 0.5, ny: 0.5 });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(250, 200);
      const anchor = h.changes[0].change.anchor;
      expect(anchor).toEqual({ kind: 'screen', nx: 0.25, ny: 0.25 });
    });

    it('records a snap candidate while a DSO is in range, and binds it as the target', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M81', ra: 1, dec: 85 });
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 10, geo.cy);
      expect(h.fc.snapCandidate?.id).toBe('M81');
      // The pending target stays bound while the elastic shows, so a mosaic's
      // identity (and its name) does not flicker mid-drag.
      const anchor = h.changes[0].change.anchor;
      expect(anchor && 'dsoId' in anchor && anchor.dsoId).toBe('M81');
    });

    it('clears the snap candidate once the DSO is out of range', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M81' });
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 10, geo.cy);
      expect(h.fc.snapCandidate).not.toBeNull();
      h.state.nearDso = null;
      h.fc.handleDragMove(geo.cx + 300, geo.cy);
      expect(h.fc.snapCandidate).toBeNull();
    });

    it('never snaps a frame whose anchor toggle is off', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M81' });
      const f = bigActiveFrame({ anchorSnap: false });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 10, geo.cy);
      expect(h.fc.snapCandidate).toBeNull();
    });

    it('re-derives a plan frame target from the DSOs inside it when out of snap range', () => {
      const h = harness();
      h.state.nearDso = null;
      h.state.framedDsos = [makeDSO({ id: 'NGC1' }), makeDSO({ id: 'NGC2' })];
      const f = bigActiveFrame({ derivesTargetFromContent: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 40, geo.cy);
      const anchor = h.changes[0].change.anchor;
      expect(anchor && 'dsoId' in anchor && anchor.dsoId).toBe('NGC1');
    });

    it('a rotate drag on a sky frame emits a position angle', () => {
      const h = harness();
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      const rh = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24);
      h.fc.handleMouseDown(rh.x, rh.y);
      h.fc.handleDragMove(geo.cx + 60, geo.cy);
      expect(h.changes).toHaveLength(1);
      expect(typeof h.changes[0].change.paDeg).toBe('number');
      expect(h.changes[0].change.screenRotationDeg).toBeUndefined();
    });

    it('a rotate drag on a floating frame emits a screen rotation in (−180, 180]', () => {
      const h = harness();
      const f = bigActiveFrame({ anchorKind: 'screen', nx: 0.5, ny: 0.5 });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      const rh = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24);
      h.fc.handleMouseDown(rh.x, rh.y);
      h.fc.handleDragMove(geo.cx - 60, geo.cy);
      const rot = h.changes[0].change.screenRotationDeg!;
      expect(rot).toBeGreaterThan(-180);
      expect(rot).toBeLessThanOrEqual(180);
    });
  });

  describe('resize drag', () => {
    it('builds a rubber-band draft without emitting a change', () => {
      const h = harness();
      const f = bigActiveFrame({ resizable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.corners[2].x, geo.corners[2].y);
      h.fc.handleDragMove(geo.corners[2].x + 60, geo.corners[2].y + 60);
      expect(h.fc.resizeDraft).not.toBeNull();
      expect(h.changes).toEqual([]); // nothing committed until mouseup
    });

    it('clamps a smart-scope frame to its mosaic envelope', () => {
      const h = harness();
      const f = bigActiveFrame({
        resizable: true,
        smartMosaic: {
          nativeWDeg: 3,
          nativeHDeg: 3,
          // Envelope allows at most a 2x enlargement on either axis.
          env: { maxWDeg: 6, maxHDeg: 6, maxAreaDeg2: 36 } as never,
        },
      });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.corners[2].x, geo.corners[2].y);
      // Drag far past the envelope.
      h.fc.handleDragMove(geo.corners[2].x + 2000, geo.corners[2].y + 2000);
      const draft = h.fc.resizeDraft!;
      // Clamped to 2x the native half-extent, not the 2000 px the cursor asked for.
      expect(draft.halfW).toBeLessThanOrEqual(geo.halfW * 2 + 1);
      expect(draft.halfH).toBeLessThanOrEqual(geo.halfH * 2 + 1);
    });

    it('commits the region on mouseup and clears the draft', () => {
      const h = harness();
      const f = bigActiveFrame({ resizable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.corners[2].x, geo.corners[2].y);
      h.fc.handleDragMove(geo.corners[2].x + 60, geo.corners[2].y + 60);
      h.fc.handleMouseUp();
      expect(h.resizes).toHaveLength(1);
      expect(h.resizes[0].id).toBe('f1');
      expect(h.fc.resizeDraft).toBeNull();
      expect(h.fc.activeDrag).toBeNull();
    });

    it('commits nothing when the mouse is released without any move', () => {
      const h = harness();
      const f = bigActiveFrame({ resizable: true });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.corners[2].x, geo.corners[2].y);
      h.fc.handleMouseUp();
      expect(h.resizes).toEqual([]);
      expect(h.render).toHaveBeenCalled();
    });
  });

  describe('merge on drop', () => {
    it('attempts a merge only for a plan frame', () => {
      const h = harness();
      const f = makeFrame({ id: 'plan:1:2', active: true, wDeg: 3, hDeg: 3 });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleMouseUp();
      // No overlapping target here, so no merge is emitted — but the path ran.
      expect(h.merges).toEqual([]);
    });

    it('does not attempt a merge for a non-plan frame id', () => {
      const h = harness();
      const f = bigActiveFrame({ id: 'adhoc:1' });
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleMouseUp();
      expect(h.merges).toEqual([]);
    });

    it('emits a merge when a plan frame is dropped onto another of the same plan', () => {
      const h = harness();
      const moved = makeFrame({ id: 'plan:1:a', active: true, wDeg: 3, hDeg: 3 });
      const target = makeFrame({ id: 'plan:1:b', wDeg: 3, hDeg: 3 });
      h.fc.setFrames([moved, target]);
      const geo = frameGeometry(moved, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleMouseUp();
      expect(h.merges).toEqual([{ movedId: 'plan:1:a', targetId: 'plan:1:b' }]);
    });
  });

  describe('pin / anchor', () => {
    it('pinning a floating frame with the anchor on snaps it to the nearest DSO', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M31', ra: 10, dec: 41 });
      const f = bigActiveFrame({ anchorKind: 'screen', nx: 0.5, ny: 0.5, pinnable: true });
      h.fc.setFrames([f]);
      h.fc.toggleFramePinById('f1');
      const anchor = h.changes[0].change.anchor!;
      expect(anchor).toMatchObject({ kind: 'sky', ra: 10, dec: 41, dsoId: 'M31' });
    });

    it('pinning with the anchor off pins exactly where the frame sits', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M31', ra: 10, dec: 41 });
      const f = bigActiveFrame({
        anchorKind: 'screen',
        nx: 0.5,
        ny: 0.5,
        pinnable: true,
        anchorSnap: false,
      });
      h.fc.setFrames([f]);
      h.fc.toggleFramePinById('f1');
      const anchor = h.changes[0].change.anchor!;
      expect(anchor.kind).toBe('sky');
      expect('dsoId' in anchor && anchor.dsoId).toBeNull();
    });

    it('ignores a pin toggle on a frame that is not pinnable', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame({ pinnable: false })]);
      h.fc.toggleFramePinById('f1');
      expect(h.changes).toEqual([]);
    });

    it('pinAllFloatingFrames pins every floating frame without snapping', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M31' });
      h.fc.setFrames([
        makeFrame({ id: 'a', anchorKind: 'screen', nx: 0.3, ny: 0.3, pinnable: true }),
        makeFrame({ id: 'b', anchorKind: 'screen', nx: 0.7, ny: 0.7, pinnable: true }),
        makeFrame({ id: 'c', anchorKind: 'sky', pinnable: true }), // already pinned
      ]);
      h.fc.pinAllFloatingFrames();
      expect(h.changes.map((c) => c.id)).toEqual(['a', 'b']);
      for (const c of h.changes) {
        const a = c.change.anchor!;
        expect('dsoId' in a && a.dsoId).toBeNull(); // no snap
      }
    });

    it('selectFrame auto-pins the previously-active floating frame', () => {
      const h = harness();
      h.state.nearDso = null;
      h.fc.setFrames([
        makeFrame({
          id: 'a',
          active: true,
          anchorKind: 'screen',
          nx: 0.5,
          ny: 0.5,
          pinnable: true,
        }),
      ]);
      h.fc.selectFrame('b');
      expect(h.changes.map((c) => c.id)).toEqual(['a']); // 'a' got pinned
      expect(h.selects).toEqual(['b']);
    });

    it('resnapFrame re-anchors a pinned frame onto the nearest DSO', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M42', ra: 83, dec: -5 });
      h.fc.setFrames([bigActiveFrame({ pinnable: true })]);
      h.fc.resnapFrame('f1');
      expect(h.changes[0].change.anchor).toMatchObject({ kind: 'sky', dsoId: 'M42' });
    });

    it('resnapFrame is a no-op when no DSO is close enough', () => {
      const h = harness();
      h.state.nearDso = null;
      h.fc.setFrames([bigActiveFrame({ pinnable: true })]);
      h.fc.resnapFrame('f1');
      expect(h.changes).toEqual([]);
    });

    it('resnapFrame is a no-op on a floating frame', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M42' });
      h.fc.setFrames([bigActiveFrame({ pinnable: true, anchorKind: 'screen', nx: 0.5, ny: 0.5 })]);
      h.fc.resnapFrame('f1');
      expect(h.changes).toEqual([]);
    });
  });

  describe('centerFrameInView', () => {
    it('pans the view to a pinned frame', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame({ ra: 120, dec: 30 })]);
      h.fc.centerFrameInView('f1');
      expect(h.navigateTo).toHaveBeenCalledTimes(1);
      expect(h.navigateTo.mock.calls[0][0]).toBe(120);
      expect(h.navigateTo.mock.calls[0][1]).toBe(30);
    });

    it('recentres a floating frame instead of moving the view', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame({ anchorKind: 'screen', nx: 0.1, ny: 0.9 })]);
      h.fc.centerFrameInView('f1');
      expect(h.navigateTo).not.toHaveBeenCalled();
      expect(h.changes[0].change.anchor).toEqual({ kind: 'screen', nx: 0.5, ny: 0.5 });
    });

    it('is a no-op for an unknown id', () => {
      const h = harness();
      h.fc.setFrames([bigActiveFrame()]);
      h.fc.centerFrameInView('nope');
      expect(h.navigateTo).not.toHaveBeenCalled();
      expect(h.changes).toEqual([]);
    });
  });

  describe('clearInteraction', () => {
    it('drops the drag and the pending snap together', () => {
      const h = harness();
      h.state.nearDso = makeDSO({ id: 'M81' });
      const f = bigActiveFrame();
      h.fc.setFrames([f]);
      const geo = frameGeometry(f, h.state.v);
      h.fc.handleMouseDown(geo.cx, geo.cy);
      h.fc.handleDragMove(geo.cx + 10, geo.cy);
      expect(h.fc.activeDrag).not.toBeNull();
      expect(h.fc.snapCandidate).not.toBeNull();

      h.fc.clearInteraction();
      expect(h.fc.activeDrag).toBeNull();
      expect(h.fc.snapCandidate).toBeNull();
    });
  });

  describe('hasActiveFrame', () => {
    it('reports whether any frame is selected', () => {
      const h = harness();
      h.fc.setFrames([makeFrame({ id: 'a' })]);
      expect(h.fc.hasActiveFrame()).toBe(false);
      h.fc.setFrames([makeFrame({ id: 'a', active: true })]);
      expect(h.fc.hasActiveFrame()).toBe(true);
    });
  });

  describe('mosaic tile edit buttons', () => {
    // Tiles offset in declination from the outline centre. If a tile sat exactly on
    // the outline's centre, the outline's own move dot — hit-tested first — would
    // swallow the tile's trash button (correct priority, but not what this tests).
    const mosaic = () => [
      makeFrame({ id: 'mosaic:p1:m1', active: true, isMosaicOutline: true, wDeg: 6, hDeg: 6 }),
      makeFrame({ id: 't1', mosaicId: 'm1', mosaicIsBorderTile: true, wDeg: 3, hDeg: 3, dec: 83 }),
      makeFrame({ id: 't2', mosaicId: 'm1', mosaicIsBorderTile: true, wDeg: 3, hDeg: 3, dec: 87 }),
    ];

    it('clicking a border tile emits its removal', () => {
      const h = harness();
      const frames = mosaic();
      h.fc.setFrames(frames);
      const tileGeo = frameGeometry(frames[1], h.state.v);
      expect(h.fc.handleMouseDown(tileGeo.cx, tileGeo.cy)).toBe(true);
      expect(h.tileRemoves).toEqual(['t1']);
    });

    it('clicking an add candidate emits its sky position', () => {
      const h = harness();
      const frames = mosaic();
      h.fc.setFrames(frames);
      h.fc.setMosaicAddCandidates([{ ra: 3, dec: 84 }]);
      const pt = h.fc.candidateCanvasPoint({ ra: 3, dec: 84 }, h.fc.activeOutlineRotateAvoid());
      expect(h.fc.handleMouseDown(pt.x, pt.y)).toBe(true);
      expect(h.tileAdds).toEqual([{ ra: 3, dec: 84 }]);
    });

    it('hides the edit buttons when the tiles are too small', () => {
      const h = harness();
      h.fc.setFrames([
        makeFrame({ id: 'mosaic:p1:m1', active: true, isMosaicOutline: true, wDeg: 6, hDeg: 6 }),
        makeFrame({ id: 't1', mosaicId: 'm1', mosaicIsBorderTile: true, wDeg: 0.02, hDeg: 0.02 }),
      ]);
      expect(h.fc.mosaicEditButtonsVisible('m1')).toBe(false);
    });

    it('reports no edit buttons for a mosaic with no tiles', () => {
      const h = harness();
      h.fc.setFrames([
        makeFrame({ id: 'mosaic:p1:m1', active: true, isMosaicOutline: true, wDeg: 6, hDeg: 6 }),
      ]);
      expect(h.fc.mosaicEditButtonsVisible('m1')).toBe(false);
    });
  });
});
