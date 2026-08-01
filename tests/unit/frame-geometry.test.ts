import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
import { setHemisphere, setCenterMode, setProjectionObserver } from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';
import type { RenderableFrame } from '../../src/sky-map-types';
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
      dec = 12,
      pa = 33;
    const rot = paToCanvasRotDeg(pa, ra, dec, view);
    const back = canvasRotDegToPa(rot, ra, dec, view);
    // canvasRotDegToPa normalises into [0,360); 33° round-trips to itself.
    expect(back).toBeCloseTo(33, 4);
  });
});

describe('frameGeometry in the Local Sky (zenith) view', () => {
  const LST_H = 5;
  const LAT_DEG = 40;

  afterEach(() => setCenterMode('pole'));

  /** Sky-anchored frame at a given RA/Dec. */
  const skyFrame = (ra: number, dec: number, over: Partial<RenderableFrame> = {}) =>
    ({
      id: 'f2',
      name: 'Vespera',
      label: 'Vespera 2',
      wDeg: 2.5,
      hDeg: 1.4,
      active: true,
      movable: true,
      anchorKind: 'sky',
      ra,
      dec,
      paDeg: 0,
      ...over,
    }) as RenderableFrame;

  it('sizes by altitude, not declination — the reported "frame too big" bug', () => {
    // M14, where the user placed a Vespera 2 frame over an existing photo.
    const { raDeg, decDeg } = raDecFromAltAz(35, 150, LST_H, LAT_DEG);
    const f = skyFrame(raDeg, decDeg);
    const poleHalfW = frameGeometry(f, view).halfW;

    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const zenithHalfW = frameGeometry(f, view).halfW;

    // At 35° altitude the projection's scale is well below the dec-based one, which is
    // exactly why the frame drew too large before.
    expect(zenithHalfW).toBeLessThan(poleHalfW);
    // And it tracks the altitude-based stereographic factor.
    const expected =
      ((2.5 / 2) * (Math.PI / 180) * view.scale) / (2 * Math.cos(((90 - 35) * Math.PI) / 360) ** 2);
    expect(zenithHalfW).toBeCloseTo(expected, 2);
  });

  it('keeps the width/height ratio (a conformal projection scales both axes alike)', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(55, 20, LST_H, LAT_DEG);
    const g = frameGeometry(skyFrame(raDeg, decDeg), view);
    expect(g.halfW / g.halfH).toBeCloseTo(2.5 / 1.4, 6);
  });

  it('collapses a frame below the horizon instead of drawing it off-canvas', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(-20, 200, LST_H, LAT_DEG);
    const g = frameGeometry(skyFrame(raDeg, decDeg), view);
    expect(g.halfW).toBe(0);
    expect(g.halfH).toBe(0);
  });

  it('is unchanged in the pole-centred view (regression guard)', () => {
    // The measured scale is the exact derivative of the old closed form, so switching to
    // it must not move anything in the default projection.
    const f = skyFrame(200, -15);
    const g = frameGeometry(f, view);
    const legacy =
      ((1.4 / 2) * (Math.PI / 180) * view.scale) / (2 * Math.cos((105 * Math.PI) / 360) ** 2);
    expect(g.halfH).toBeCloseTo(legacy, 4);
  });
});
