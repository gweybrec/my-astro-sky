import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { angularSizeToCanvasPx, dsoSizeCos2, dsoCanvasAngle } from '../../src/dso-render-math';
import {
  setHemisphere,
  getProjectionGeneration,
  setCenterMode,
  setProjectionObserver,
} from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';
import type { DSO } from '../../src/types';

const DEG2RAD = Math.PI / 180;

/** Minimal DSO for the cos² / sky-axes cache tests. */
function makeDso(dec: number, over: Partial<DSO> = {}): DSO {
  return {
    id: 'X',
    ra: 0,
    dec,
    mag: 8,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    type: 'Gx',
    ...over,
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

  describe('in zenith ("local sky") mode', () => {
    afterEach(() => setCenterMode('pole'));

    it('uses 90-altitude (not dec/hemisphere) when an altitude is supplied', () => {
      setCenterMode('zenith');
      const dso = makeDso(30); // dec is irrelevant here — only altDeg should matter
      const altDeg = 50;
      const expected = Math.cos(((90 - altDeg) * Math.PI) / 180 / 2) ** 2;
      expect(dsoSizeCos2(dso, altDeg)).toBeCloseTo(expected, 9);
    });

    it('falls back to the dec/hemisphere formula when no altitude is supplied', () => {
      setCenterMode('zenith');
      setHemisphere('north');
      const dso = makeDso(30);
      const expected = Math.cos(((90 - 30) * Math.PI) / 180 / 2) ** 2;
      expect(dsoSizeCos2(dso)).toBeCloseTo(expected, 9);
    });

    it('does not let an altitude-less call poison the altitude-based cache slot', () => {
      setCenterMode('zenith');
      const dso = makeDso(30);
      // Simulates ensureDsoAllIndex's bucketing call (no altitude on hand) running
      // in the same generation as the render path's altitude-aware call.
      dsoSizeCos2(dso);
      const altDeg = 70;
      const expected = Math.cos(((90 - altDeg) * Math.PI) / 180 / 2) ** 2;
      expect(dsoSizeCos2(dso, altDeg)).toBeCloseTo(expected, 9);
    });
  });
});

describe('dsoCanvasAngle', () => {
  // Earlier blocks leave the hemisphere/centre mode set; pin them for every case here.
  beforeEach(() => {
    setCenterMode('pole');
    setHemisphere('north');
  });
  afterEach(() => {
    setCenterMode('pole');
    setHemisphere('north');
  });

  it('points to celestial north at PA 0 in the pole-centred map', () => {
    const dso = makeDso(10, { ra: 0, pa: 0 });
    expect(dsoCanvasAngle(dso, 0)).toBeCloseTo(Math.PI / 2, 4); // atan2(cos 0, −sin 0)
  });

  it('subtracts the position angle (east is clockwise from north on the pole map)', () => {
    const a = dsoCanvasAngle(makeDso(10, { ra: 45, pa: 0 }), 0);
    const b = dsoCanvasAngle(makeDso(10, { ra: 45, pa: 30 }), 0);
    expect(a - b).toBeCloseTo((30 * Math.PI) / 180, 4);
  });

  it('SUBTRACTS the view rotation', () => {
    // toCanvas maps a delta (dx, dy) to (dx·cos+dy·sin, −dx·sin+dy·cos), which lowers an
    // atan2 angle by θ — so a rotated map must lower this angle too. The pre-fix code
    // added it, mis-orienting every elongated marker by 2θ whenever the map was rotated.
    const a = dsoCanvasAngle(makeDso(0, { ra: 0, pa: 0 }), 0);
    const b = dsoCanvasAngle(makeDso(0, { ra: 0, pa: 0 }), 90);
    expect(b - a).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('caches the measured axes per projection generation', () => {
    const dso = makeDso(30, { ra: 120, pa: 45 });
    dsoCanvasAngle(dso, 0);
    expect(dso._nazg).toBe(getProjectionGeneration());
    expect(dso._nazE).toBe(-1); // pole-centred handedness
  });

  it('re-measures after the projection generation moves', () => {
    const dso = makeDso(30, { ra: 120, pa: 0 });
    const north = dsoCanvasAngle(dso, 0);
    setHemisphere('south');
    expect(dsoCanvasAngle(dso, 0)).not.toBeCloseTo(north, 3);
  });

  it('reorients on the Local Sky dome without flipping the PA sense', () => {
    const { raDeg, decDeg } = raDecFromAltAz(50, 130, 5, 40);
    const poleAngle = dsoCanvasAngle(makeDso(decDeg, { ra: raDeg, pa: 0 }), 0);

    setCenterMode('zenith');
    setProjectionObserver(5, 40);
    const dso = makeDso(decDeg, { ra: raDeg, pa: 0 });
    const zenithAngle = dsoCanvasAngle(dso, 0);

    // North is rotated by the parallactic angle — that is the bug being fixed…
    expect(Math.abs(zenithAngle - poleAngle)).toBeGreaterThan(5 * DEG2RAD);
    // …but the dome is not mirrored, so a PA still runs the same way round (see sky-axes.ts).
    expect(dso._nazE).toBe(-1);
  });
});
