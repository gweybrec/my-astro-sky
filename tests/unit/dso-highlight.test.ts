import { describe, expect, it, afterEach } from 'vitest';
import {
  MIN_HIGHLIGHT_AXIS_PX,
  angularSizeToCanvasPxForDSO,
  computeDSOHighlightShape,
} from '../../src/dso-highlight';
import { setCenterMode, setProjectionObserver } from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';

describe('dso highlight geometry', () => {
  afterEach(() => setCenterMode('pole'));

  it('orients the ellipse to celestial north at PA 0 in the pole-centred map', () => {
    const at = (pa: number, rotationDeg = 0) =>
      computeDSOHighlightShape(
        { ra: 0, dec: 0, pa, majAxis: 90, minAxis: 30 },
        { scale: 2000, rotationDeg },
      ).angle;

    expect(at(0)).toBeCloseTo(Math.PI / 2, 4); // atan2(cos 0, −sin 0)
    expect(at(30)).toBeCloseTo(at(0) - (30 * Math.PI) / 180, 4); // east is clockwise here
    // The map rotation SUBTRACTS (see sky-axes.ts / dso-render-math.test.ts) — the old
    // helper added it, mis-orienting the ring by 2θ on a rotated map.
    expect(at(30, 15)).toBeCloseTo(at(30) - (15 * Math.PI) / 180, 4);
  });

  it('reorients in the Local Sky dome (mirrored, parallactic-rotated north)', () => {
    const dso = (() => {
      const { raDeg, decDeg } = raDecFromAltAz(45, 120, 5, 40);
      return { ra: raDeg, dec: decDeg, pa: 0, majAxis: 90, minAxis: 30 };
    })();
    const view = { scale: 2000, rotationDeg: 0 };
    const poleAngle = computeDSOHighlightShape(dso, view).angle;
    setCenterMode('zenith');
    setProjectionObserver(5, 40);
    const zenithAngle = computeDSOHighlightShape(dso, view).angle;
    expect(Math.abs(zenithAngle - poleAngle)).toBeGreaterThan(5 * (Math.PI / 180));
  });

  it('sizes by altitude, not declination, in the Local Sky dome', () => {
    const { raDeg, decDeg } = raDecFromAltAz(25, 100, 5, 40);
    const dso = { ra: raDeg, dec: decDeg, pa: 0, majAxis: 600, minAxis: 600 };
    const view = { scale: 2000, rotationDeg: 0 };
    const poleRx = computeDSOHighlightShape(dso, view).rx;
    setCenterMode('zenith');
    setProjectionObserver(5, 40);
    const zenithRx = computeDSOHighlightShape(dso, view).rx;
    // alt 25° is far from the zenith, so the zenith-mode scale is much smaller than the
    // dec-based one would have been at this declination.
    expect(zenithRx).toBeLessThan(poleRx);
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
