import { describe, expect, it, beforeEach } from 'vitest';
import { angularSizeToCanvasPx, dsoSizeCos2, dsoCanvasAngle } from '../../src/dso-render-math';
import { setHemisphere, getProjectionGeneration } from '../../src/projection';
import type { DSO } from '../../src/types';

/** Minimal DSO for the cos² cache test. */
function makeDso(dec: number): DSO {
  return {
    id: 'X',
    ra: 0,
    dec,
    mag: 8,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    type: 'Gx',
  } as unknown as DSO;
}

describe('angularSizeToCanvasPx', () => {
  beforeEach(() => setHemisphere('north'));

  it('scales linearly with the canvas scale factor', () => {
    const a = angularSizeToCanvasPx(60, 0, 1000);
    const b = angularSizeToCanvasPx(60, 0, 2000);
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('scales linearly with the angular size', () => {
    const one = angularSizeToCanvasPx(30, 45, 1000);
    const two = angularSizeToCanvasPx(60, 45, 1000);
    expect(two).toBeCloseTo(one * 2, 6);
  });

  it('uses a supplied cos2 verbatim (matches the internal formula)', () => {
    const colat = 90 - 30; // north, dec=30
    const cos2 = Math.cos((colat * Math.PI) / 180 / 2) ** 2;
    expect(angularSizeToCanvasPx(60, 30, 1000, cos2)).toBeCloseTo(
      angularSizeToCanvasPx(60, 30, 1000),
      6,
    );
  });

  it('depends on hemisphere for a non-pole declination', () => {
    setHemisphere('north');
    const north = angularSizeToCanvasPx(60, 30, 1000);
    setHemisphere('south');
    const south = angularSizeToCanvasPx(60, 30, 1000);
    expect(north).not.toBeCloseTo(south, 3);
  });
});

describe('dsoSizeCos2', () => {
  it('matches the direct cos² formula and caches by projection generation', () => {
    setHemisphere('north');
    const dso = makeDso(30);
    const colat = 90 - 30;
    const expected = Math.cos((colat * Math.PI) / 180 / 2) ** 2;
    expect(dsoSizeCos2(dso)).toBeCloseTo(expected, 9);
    // Cached: generation stamped.
    expect(dso._cos2g).toBe(getProjectionGeneration());
  });

  it('recomputes after a hemisphere change bumps the generation', () => {
    const dso = makeDso(30);
    setHemisphere('north');
    const north = dsoSizeCos2(dso);
    setHemisphere('south');
    const south = dsoSizeCos2(dso);
    expect(south).not.toBeCloseTo(north, 6);
  });
});

describe('dsoCanvasAngle', () => {
  it('rotates with the view rotation (adds viewRotationDeg in radians)', () => {
    const a = dsoCanvasAngle(0, 0, 0);
    const b = dsoCanvasAngle(0, 0, 90);
    expect(b - a).toBeCloseTo(Math.PI / 2, 6);
  });

  it('subtracts the position angle', () => {
    const a = dsoCanvasAngle(0, 45, 0);
    const b = dsoCanvasAngle(30, 45, 0);
    expect(a - b).toBeCloseTo((30 * Math.PI) / 180, 6);
  });
});
