import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeFovFrameCorners,
  frameAnchorCanvas,
  frameCanvasRotationDeg,
  frameGeometry,
  frameHandlesVisible,
  framePinGlyphPos,
  paToCanvasRotDeg,
  canvasRotDegToPa,
} from '../../src/frame-geometry';
import { setHemisphere } from '../../src/projection';
import type { RenderableFrame } from '../../src/sky-map';
import type { ViewState } from '../../src/types';

const view: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 600,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

/** Screen-anchored frame — deterministic without a projection round-trip. */
function screenFrame(over: Partial<RenderableFrame> = {}): RenderableFrame {
  return {
    id: 'f1',
    name: 'Rig',
    label: 'Rig 1°×0.5°',
    wDeg: 1,
    hDeg: 0.5,
    active: true,
    movable: true,
    anchorKind: 'screen',
    nx: 0.5,
    ny: 0.5,
    screenRotationDeg: 0,
    ...over,
  };
}

describe('computeFovFrameCorners', () => {
  it('returns 4 corners centred at (cx, cy) with no rotation', () => {
    const c = computeFovFrameCorners(10, 5, 100, 200, 0);
    expect(c).toHaveLength(4);
    expect(c[0]).toEqual({ x: 90, y: 195 }); // top-left
    expect(c[2]).toEqual({ x: 110, y: 205 }); // bottom-right
  });

  it('rotates the rectangle by 90° (width/height swap around the centre)', () => {
    const c = computeFovFrameCorners(10, 5, 0, 0, 90);
    // Corner (-10,-5) rotates to (5,-10).
    expect(c[0].x).toBeCloseTo(5, 6);
    expect(c[0].y).toBeCloseTo(-10, 6);
  });
});

describe('frameAnchorCanvas', () => {
  it('maps a screen anchor to nx*width, ny*height', () => {
    expect(frameAnchorCanvas(screenFrame({ nx: 0.25, ny: 0.5 }), view)).toEqual({
      cx: 200,
      cy: 300,
    });
  });
});

describe('frameCanvasRotationDeg', () => {
  it('returns the screen rotation for a floating frame', () => {
    expect(frameCanvasRotationDeg(screenFrame({ screenRotationDeg: 37 }), view)).toBe(37);
  });
});

describe('frameGeometry', () => {
  beforeEach(() => setHemisphere('north'));

  it('centres a screen frame at its anchor and produces 4 corners', () => {
    const g = frameGeometry(screenFrame(), view);
    expect(g.cx).toBeCloseTo(400, 6);
    expect(g.cy).toBeCloseTo(300, 6);
    expect(g.corners).toHaveLength(4);
    // 1°×0.5° at the pole (dec=90): halfH is half of halfW.
    expect(g.halfH).toBeCloseTo(g.halfW / 2, 6);
    expect(g.halfW).toBeGreaterThan(0);
  });
});

describe('frameHandlesVisible', () => {
  it('hides handles below the 12px minimum half-extent', () => {
    expect(frameHandlesVisible(11, 40)).toBe(false);
    expect(frameHandlesVisible(12, 12)).toBe(true);
    expect(frameHandlesVisible(40, 5)).toBe(false);
  });
});

describe('framePinGlyphPos', () => {
  it('lifts the glyph 14px straight up from the corner at rotation 0', () => {
    expect(framePinGlyphPos({ x: 100, y: 100 }, 0)).toEqual({ x: 100, y: 86 });
  });
});

describe('paToCanvasRotDeg / canvasRotDegToPa round-trip', () => {
  it('recovers the original position angle', () => {
    const ra = 80,
      pa = 33;
    const rot = paToCanvasRotDeg(pa, ra, view);
    const back = canvasRotDegToPa(rot, ra, view);
    // canvasRotDegToPa normalises into [0,360); 33° round-trips to itself.
    expect(back).toBeCloseTo(33, 4);
  });
});
