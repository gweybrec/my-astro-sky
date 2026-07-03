import { describe, expect, it } from 'vitest';
import {
  MIN_HIGHLIGHT_AXIS_PX,
  angularSizeToCanvasPxForDSO,
  computeDSOHighlightShape,
  dsoCanvasAngleForHighlight,
  canvasAngleToPADeg,
} from '../../src/dso-highlight';

describe('dso highlight geometry', () => {
  it('matches expected PA-to-canvas angle behavior', () => {
    const base = dsoCanvasAngleForHighlight(0, 0, 0);
    expect(base).toBeCloseTo(Math.PI / 2, 12);

    const withPa = dsoCanvasAngleForHighlight(30, 0, 0);
    expect(withPa).toBeCloseTo(base - (30 * Math.PI) / 180, 12);

    const withRotation = dsoCanvasAngleForHighlight(30, 0, 15);
    expect(withRotation).toBeCloseTo(withPa + (15 * Math.PI) / 180, 12);
  });

  it('round-trips canvasAngleToPADeg against dsoCanvasAngleForHighlight', () => {
    for (const ra of [0, 45, 123, 270, 359]) {
      for (const rot of [-30, 0, 17, 90]) {
        for (const pa of [0, 30, 142, 200, 359]) {
          const canvasAngle = dsoCanvasAngleForHighlight(pa, ra, rot);
          expect(canvasAngleToPADeg(canvasAngle, ra, rot)).toBeCloseTo(pa, 9);
        }
      }
    }
  });

  it('normalises recovered position angle to [0, 360)', () => {
    // An angle that maps back to a negative raw value must wrap into range.
    const canvasAngle = dsoCanvasAngleForHighlight(-40, 80, 25);
    const pa = canvasAngleToPADeg(canvasAngle, 80, 25);
    expect(pa).toBeGreaterThanOrEqual(0);
    expect(pa).toBeLessThan(360);
    expect(pa).toBeCloseTo(320, 9); // -40 ≡ 320
  });

  it('preserves elongated shape at high zoom when both axes are above floor', () => {
    const shape = computeDSOHighlightShape(
      { ra: 85, dec: -2.45, pa: 0, majAxis: 90, minAxis: 30 },
      { scale: 2000, rotationDeg: 0 },
    );

    expect(shape.rx).toBeGreaterThan(MIN_HIGHLIGHT_AXIS_PX);
    expect(shape.ry).toBeGreaterThan(MIN_HIGHLIGHT_AXIS_PX);
    expect(shape.rx / shape.ry).toBeCloseTo(3, 1);
  });

  it('clamps only one axis first, then both axes at lower zoom', () => {
    const high = computeDSOHighlightShape(
      { ra: 85, dec: -2.45, pa: 0, majAxis: 90, minAxis: 30 },
      { scale: 1000, rotationDeg: 0 },
    );
    const low = computeDSOHighlightShape(
      { ra: 85, dec: -2.45, pa: 0, majAxis: 90, minAxis: 30 },
      { scale: 400, rotationDeg: 0 },
    );

    // At this scale, major is still above floor but minor is floored.
    expect(high.rx).toBeGreaterThan(MIN_HIGHLIGHT_AXIS_PX);
    expect(high.ry).toBe(MIN_HIGHLIGHT_AXIS_PX);

    // Zooming out further eventually floors both axes (small circle).
    expect(low.rx).toBe(MIN_HIGHLIGHT_AXIS_PX);
    expect(low.ry).toBe(MIN_HIGHLIGHT_AXIS_PX);
  });

  it('uses same angular-size conversion as sky map helper formula', () => {
    const arcmin = 45;
    const dec = 10;
    const scale = 1200;

    const theta = ((90 - dec) * Math.PI) / 180;
    const cos2 = Math.cos(theta / 2) ** 2;
    const rad = ((arcmin / 60) * Math.PI) / 180;
    const expected = (rad / (2 * cos2)) * scale;

    expect(angularSizeToCanvasPxForDSO(arcmin, dec, scale)).toBeCloseTo(expected, 12);
  });
});
