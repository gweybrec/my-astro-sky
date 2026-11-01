/**
 * The interactive-frame overlay pass (`renderFovInstances`) must resolve frame geometry
 * against the scene's view: an export renders a different view than the live map, and
 * the frame has to sit on its object there.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderFovInstances } from '@myastrosky/render/sky-frame-render';
import { frameGeometry } from '@myastrosky/core/frame-geometry';
import type { SkyScene } from '@myastrosky/render/sky-scene';
import type { RenderableFrame, ViewState } from '@myastrosky/core/sky-map-types';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 6 })),
    globalAlpha: 1,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

const liveView: ViewState = {
  centerX: 0.3,
  centerY: -0.2,
  scale: 4000,
  rotationDeg: 0,
  width: 800,
  height: 600,
};
const exportView: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 300,
  rotationDeg: 0,
  width: 1000,
  height: 1000,
};

const pinned: RenderableFrame = {
  id: 'f1',
  name: 'Setup',
  label: 'Setup',
  wDeg: 2,
  hDeg: 1.5,
  active: true,
  movable: true,
  pinnable: false,
  resizable: true,
  anchorKind: 'sky',
  ra: 83.8,
  dec: 22,
  pa: 0,
};

function scene(ctx: ReturnType<typeof mockCtx>, offscreen: boolean): SkyScene {
  const frames = {
    frames: [pinned],
    touch: false,
    tileButtonRadius: 10,
    resizeDraft: null,
    snapCandidate: null,
    activeDrag: null,
    mosaicAddCandidates: [],
    frameHandlesVisible: vi.fn(() => true),
    framePinGlyphPos: vi.fn(() => ({ x: 0, y: 0 })),
    // The controller's own geometry reads the live view.
    frameGeometry: (f: RenderableFrame) => frameGeometry(f, liveView),
  };
  return {
    ctx,
    view: offscreen ? exportView : liveView,
    offscreen,
    frames,
    cssVar: (_: string, fallback: string) => fallback,
  } as unknown as SkyScene;
}

describe('renderFovInstances()', () => {
  it('draws a pinned frame where it sits in the export view, not the live view', () => {
    const ctx = mockCtx();
    renderFovInstances(scene(ctx, true));
    const expected = frameGeometry(pinned, exportView).corners[0];
    const [x, y] = ctx.moveTo.mock.calls[0];
    expect(x).toBeCloseTo(expected.x, 6);
    expect(y).toBeCloseTo(expected.y, 6);
  });

  it('leaves the edit handles out of an export', () => {
    const live = mockCtx();
    renderFovInstances(scene(live, false));
    const exported = mockCtx();
    renderFovInstances(scene(exported, true));
    expect(live.moveTo.mock.calls.length).toBeGreaterThan(exported.moveTo.mock.calls.length);
    expect(exported.arc).not.toHaveBeenCalled();
  });
});
