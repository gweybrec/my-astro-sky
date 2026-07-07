import { describe, it, expect } from 'vitest';
import {
  project,
  projectCached,
  getProjectionGeneration,
  invalidateProjections,
  unproject,
  toCanvas,
  fromCanvas,
  setHemisphere,
  getHemisphere,
  setProjectionMode,
  borderRadiusPU,
  isInsideBorderCircle,
  fitScaleForBorderCircle,
  getObsGeneration,
  bumpObsGeneration,
  isBelowHorizonCached,
} from '../../src/projection';
import { altAzFromRaDec } from '../../src/sky-geometry';

const EPSILON = 1e-9;

describe('project / unproject roundtrip', () => {
  const cases = [
    { ra: 0, dec: 0, label: 'vernal equinox' },
    { ra: 90, dec: 0, label: 'RA=90' },
    { ra: 180, dec: 0, label: 'RA=180' },
    { ra: 270, dec: 0, label: 'RA=270' },
    { ra: 0, dec: 45, label: 'Dec=45' },
    { ra: 0, dec: -45, label: 'Dec=-45' },
    { ra: 123.456, dec: 67.89, label: 'arbitrary' },
    { ra: 359.9, dec: -30, label: 'near anti-meridian' },
  ];

  for (const { ra, dec, label } of cases) {
    it(`roundtrip: ${label} (RA=${ra}, Dec=${dec})`, () => {
      const { x, y } = project(ra, dec);
      const result = unproject(x, y);
      expect(result.dec).toBeCloseTo(dec, 9);
      // RA comparison needs to handle 0/360 wrap
      const raDiff = Math.abs(result.ra - ra) % 360;
      expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(EPSILON);
    });
  }

  it('north celestial pole (Dec=90) projects to origin', () => {
    setHemisphere('north');
    const { x, y } = project(0, 90);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  it('supports south hemisphere projection and inverse', () => {
    setHemisphere('south');
    // In south mode, Dec=-90 is the projection origin
    const p = project(0, -90);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);

    const rt = unproject(...(Object.values(project(123.4, -45.6)) as [number, number]));
    expect(rt.dec).toBeCloseTo(-45.6, 9);
    const raDiff = Math.abs(rt.ra - 123.4) % 360;
    expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(EPSILON);

    // Keep global projection state deterministic for the rest of the suite
    setHemisphere('north');
  });

  it('normalizes negative RA from atan2 to [0, 360)', () => {
    setHemisphere('north');
    // atan2(x,y) with x<0,y>0 is negative and should be wrapped by +360.
    const { ra } = unproject(-1, 1);
    expect(ra).toBeGreaterThanOrEqual(0);
    expect(ra).toBeLessThan(360);
    expect(ra).toBeCloseTo(315, 9);
  });
});

describe('hemisphere state', () => {
  it('setHemisphere/getHemisphere roundtrip', () => {
    setHemisphere('south');
    expect(getHemisphere()).toBe('south');
    setHemisphere('north');
    expect(getHemisphere()).toBe('north');
  });
});

describe('RA increases counter-clockwise (sky chart convention)', () => {
  it('higher RA projects to the LEFT of lower RA at same Dec', () => {
    const p1 = project(350, 45); // high RA
    const p2 = project(10, 45); // low RA
    // In projection space, sin(RA) component: sin(350°) ≈ -0.17, sin(10°) ≈ 0.17
    // RA increasing → x decreasing (CCW on sky = CW in standard math coords)
    // Just verify they are different and the convention holds:
    // project.x = r * sin(RA) → sin(350°) < sin(10°) so p1.x < p2.x
    expect(p1.x).toBeLessThan(p2.x);
  });
});

describe('toCanvas / fromCanvas roundtrip', () => {
  const view = { centerX: 0.5, centerY: 0.3, scale: 200, rotationDeg: 0, width: 1000, height: 800 };

  it('roundtrip for arbitrary projection point', () => {
    const px = 0.2;
    const py = -0.1;
    const canvas = toCanvas(px, py, view);
    const back = fromCanvas(canvas.x, canvas.y, view);
    expect(back.x).toBeCloseTo(px, 10);
    expect(back.y).toBeCloseTo(py, 10);
  });

  it('projection center maps to canvas center', () => {
    const canvas = toCanvas(view.centerX, view.centerY, view);
    expect(canvas.x).toBeCloseTo(view.width / 2, 10);
    expect(canvas.y).toBeCloseTo(view.height / 2, 10);
  });

  it('doubling scale doubles pixel distance from center', () => {
    const view1 = { ...view, scale: 100 };
    const view2 = { ...view, scale: 200 };
    const p = { x: view.centerX + 0.1, y: view.centerY };
    const c1 = toCanvas(p.x, p.y, view1);
    const c2 = toCanvas(p.x, p.y, view2);
    const dist1 = Math.abs(c1.x - view1.width / 2);
    const dist2 = Math.abs(c2.x - view2.width / 2);
    expect(dist2).toBeCloseTo(dist1 * 2, 10);
  });

  it('Y axis is inverted: higher projection Y → lower canvas Y', () => {
    const above = toCanvas(0, 1, view);
    const below = toCanvas(0, 0, view);
    expect(above.y).toBeLessThan(below.y);
  });

  it('roundtrip remains stable with non-zero rotation', () => {
    const rotatedView = { ...view, rotationDeg: 37 };
    const px = -0.35;
    const py = 0.72;
    const canvas = toCanvas(px, py, rotatedView);
    const back = fromCanvas(canvas.x, canvas.y, rotatedView);
    expect(back.x).toBeCloseTo(px, 10);
    expect(back.y).toBeCloseTo(py, 10);
  });

  it('positive rotation rotates sky counter-clockwise on screen', () => {
    const baseline = { ...view, centerX: 0, centerY: 0, rotationDeg: 0 };
    const rotated = { ...baseline, rotationDeg: 90 };

    // Point to the right of center should move upward with +90° rotation.
    const p = { x: 1, y: 0 };
    const c0 = toCanvas(p.x, p.y, baseline);
    const c1 = toCanvas(p.x, p.y, rotated);

    expect(c1.x).toBeCloseTo(baseline.width / 2, 10);
    expect(c1.y).toBeLessThan(c0.y);
  });
});

describe('isInsideBorderCircle', () => {
  // View centred on the projection origin, so the pole (0,0) maps to the canvas
  // centre (500, 500) — the centre of the border circle.
  const view = { centerX: 0, centerY: 0, scale: 100, rotationDeg: 0, width: 1000, height: 1000 };

  it('stereo: distinguishes inside, on-rim, and outside the circle', () => {
    setHemisphere('north');
    setProjectionMode('stereo');
    const r = borderRadiusPU(45) * view.scale; // tan(67.5°) * 100 ≈ 241.4 px

    expect(isInsideBorderCircle(500, 500, view, 45)).toBe(true); // centre
    expect(isInsideBorderCircle(500 + r * 0.5, 500, view, 45)).toBe(true); // well inside
    expect(isInsideBorderCircle(500, 500 - (r - 1), view, 45)).toBe(true); // just inside rim
    expect(isInsideBorderCircle(500 + r + 1, 500, view, 45)).toBe(false); // just outside rim
    expect(isInsideBorderCircle(1000, 1000, view, 45)).toBe(false); // canvas corner
  });

  it('fisheye: border is the r=1 horizon circle regardless of borderLatDeg', () => {
    setProjectionMode('fisheye');
    const r = borderRadiusPU(45) * view.scale; // 1.0 * 100 = 100 px
    expect(r).toBeCloseTo(100, 6);
    expect(isInsideBorderCircle(500 + 90, 500, view, 45)).toBe(true);
    expect(isInsideBorderCircle(500 + 110, 500, view, 45)).toBe(false);
    setProjectionMode('stereo'); // restore global state for the rest of the suite
  });
});

describe('borderRadiusPU / fitScaleForBorderCircle', () => {
  it('border radius uses r = tan((90 + lat) / 2)', () => {
    expect(borderRadiusPU(45)).toBeCloseTo(Math.tan((((90 + 45) / 2) * Math.PI) / 180), 12);
    // lat = 0 ⇒ tan(45°) = 1 (the celestial equator circle)
    expect(borderRadiusPU(0)).toBeCloseTo(1, 12);
  });

  it('fit scale frames the whole border circle within the smaller dimension', () => {
    const cssW = 1200,
      cssH = 800,
      lat = 45,
      margin = 0.96;
    const scale = fitScaleForBorderCircle(cssW, cssH, lat, margin);
    // The border circle diameter in canvas px must fit the smaller dimension (× margin).
    const diameterPx = 2 * borderRadiusPU(lat) * scale;
    expect(diameterPx).toBeCloseTo(Math.min(cssW, cssH) * margin, 9);
  });

  it('is driven by the smaller dimension (portrait vs landscape)', () => {
    const lat = 45;
    expect(fitScaleForBorderCircle(800, 1200, lat)).toBeCloseTo(
      fitScaleForBorderCircle(1200, 800, lat),
      12,
    );
  });
});

describe('projectCached / projection generation', () => {
  it('writes cached projection matching project()', () => {
    setHemisphere('north');
    setProjectionMode('stereo');
    const o: { ra: number; dec: number; _px?: number; _py?: number; _pg?: number } = {
      ra: 123.456,
      dec: 67.89,
    };
    projectCached(o);
    const p = project(123.456, 67.89);
    expect(o._px).toBeCloseTo(p.x, 12);
    expect(o._py).toBeCloseTo(p.y, 12);
    expect(o._pg).toBe(getProjectionGeneration());
  });

  it('does not re-project until the generation moves', () => {
    setHemisphere('north');
    const o: { ra: number; dec: number; _px?: number; _py?: number; _pg?: number } = {
      ra: 10,
      dec: 20,
    };
    projectCached(o);
    // Tamper with the cache: a no-op call must leave the stale value untouched.
    o._px = 999;
    projectCached(o);
    expect(o._px).toBe(999);
  });

  it('invalidates the cache when the hemisphere changes', () => {
    setHemisphere('north');
    const o: { ra: number; dec: number; _px?: number; _py?: number; _pg?: number } = {
      ra: 10,
      dec: 20,
    };
    projectCached(o);
    const gen = getProjectionGeneration();
    setHemisphere('south');
    expect(getProjectionGeneration()).toBe(gen + 1);
    projectCached(o);
    const south = project(10, 20);
    expect(o._px).toBeCloseTo(south.x, 12);
    expect(o._py).toBeCloseTo(south.y, 12);
    setHemisphere('north');
  });

  it('invalidateProjections bumps the generation and forces a recompute', () => {
    setHemisphere('north');
    const o: { ra: number; dec: number; _px?: number; _py?: number; _pg?: number } = {
      ra: 10,
      dec: 20,
    };
    projectCached(o);
    const gen = getProjectionGeneration();
    o._px = 999; // simulate a stale cached value
    invalidateProjections(); // e.g. the object's ra/dec changed
    expect(getProjectionGeneration()).toBe(gen + 1);
    projectCached(o);
    expect(o._px).toBeCloseTo(project(10, 20).x, 12);
  });

  it('bumps the generation on a real projection-mode change but not on a no-op set', () => {
    setProjectionMode('stereo');
    const gen = getProjectionGeneration();
    setProjectionMode('stereo'); // no-op
    expect(getProjectionGeneration()).toBe(gen);
    setProjectionMode('fisheye'); // real change
    expect(getProjectionGeneration()).toBe(gen + 1);
    setProjectionMode('stereo'); // restore for other tests
  });
});

describe('isBelowHorizonCached / observer generation', () => {
  it('matches altAzFromRaDec and stamps the current observer generation', () => {
    bumpObsGeneration();
    const lstH = 5;
    const latDeg = 40;
    const o = { ra: 30, dec: 60, _altDeg: undefined, _belowHorizon: undefined, _ag: undefined };
    const below = isBelowHorizonCached(o, lstH, latDeg);
    const expected = altAzFromRaDec(o.ra, o.dec, lstH, latDeg).altDeg < 0;
    expect(below).toBe(expected);
    expect(o._ag).toBe(getObsGeneration());
  });

  it('does not recompute until the observer generation moves', () => {
    bumpObsGeneration();
    const o = { ra: 10, dec: -80, _altDeg: undefined, _belowHorizon: undefined, _ag: undefined };
    isBelowHorizonCached(o, 5, 40);
    // Tamper with the cache: a no-op call must leave the stale value untouched.
    o._belowHorizon = !o._belowHorizon;
    const tampered = o._belowHorizon;
    const result = isBelowHorizonCached(o, 5, 40);
    expect(result).toBe(tampered);
  });

  it('recomputes once the observer generation bumps again', () => {
    bumpObsGeneration();
    const o = { ra: 200, dec: 10, _altDeg: undefined, _belowHorizon: undefined, _ag: undefined };
    isBelowHorizonCached(o, 5, 40);
    const gen = getObsGeneration();
    bumpObsGeneration();
    expect(getObsGeneration()).toBe(gen + 1);
    const expected = altAzFromRaDec(o.ra, o.dec, 12, -20).altDeg < 0;
    const result = isBelowHorizonCached(o, 12, -20);
    expect(result).toBe(expected);
    expect(o._ag).toBe(getObsGeneration());
  });
});
