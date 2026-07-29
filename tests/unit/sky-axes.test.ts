import { describe, it, expect, afterEach } from 'vitest';
import {
  project,
  toCanvas,
  setProjectionMode,
  setHemisphere,
  setCenterMode,
  setProjectionObserver,
} from '../../src/projection';
import { altAzFromRaDec, raDecFromAltAz } from '../../src/sky-geometry';
import { angularSizeToCanvasPx } from '../../src/dso-render-math';
import {
  projUnitsPerDeg,
  canvasPxPerDeg,
  skyAxesProj,
  canvasSkyAxes,
  paToCanvasAngle,
  canvasAngleToPa,
  isSkyPointVisible,
} from '../../src/sky-axes';
import type { ViewState } from '../../src/types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const LST_H = 5;
const LAT_DEG = 40;

const view = (rotationDeg = 0, scale = 400): ViewState => ({
  centerX: 0,
  centerY: 0,
  scale,
  rotationDeg,
  width: 1000,
  height: 800,
});

/** A panned/zoomed/rotated view, to prove angles ignore everything but the rotation. */
const offsetView = (rotationDeg = 0): ViewState => ({
  centerX: 0.37,
  centerY: -0.21,
  scale: 913,
  rotationDeg,
  width: 1200,
  height: 640,
});

const enterZenith = (mode: 'stereo' | 'fisheye' = 'stereo') => {
  setProjectionMode(mode);
  setCenterMode('zenith');
  setProjectionObserver(LST_H, LAT_DEG);
};

afterEach(() => {
  setCenterMode('pole');
  setProjectionMode('stereo');
  setHemisphere('north');
});

/**
 * Independent measurement of the on-screen north direction: straight through
 * project() + toCanvas(), the exact path the renderer uses. This is the ground truth the
 * closed forms are checked against.
 */
/** Signed difference between two angles, wrapped into (−π, π] — atan2 output wraps at ±π. */
function angDiffRad(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function measuredCanvasNorthAngle(raDeg: number, decDeg: number, v: ViewState): number {
  const step = decDeg > 0 ? -0.001 : 0.001;
  const sgn = step > 0 ? 1 : -1;
  const pc = project(raDeg, decDeg);
  const pn = project(raDeg, decDeg + step);
  const c = toCanvas(pc.x, pc.y, v);
  const n = toCanvas(pn.x, pn.y, v);
  return Math.atan2(sgn * (n.y - c.y), sgn * (n.x - c.x));
}

// ── Scale ─────────────────────────────────────────────────────────────────────

describe('canvasPxPerDeg: pole/stereo reproduces the legacy closed form', () => {
  // angularSizeToCanvasPx maps an angular extent straight to px (it does not halve), so 60
  // arcmin = 1° is exactly canvasPxPerDeg. Its factor 1/(2cos²((90−dec)/2)) IS d/dθ of
  // r = tan(θ/2), so the central difference must land on it — that is what makes the switch
  // a no-op for the default pole-centred view.
  for (const dec of [-60, -20, 0, 17.5, 45, 80, 90]) {
    it(`matches at dec=${dec}`, () => {
      const v = view();
      const legacy = angularSizeToCanvasPx(60, dec, v.scale);
      expect(canvasPxPerDeg(123.4, dec, v) / legacy).toBeCloseTo(1, 7);
    });
  }

  it('is non-zero exactly at the pole (a floating frame sits there in the default view)', () => {
    expect(canvasPxPerDeg(0, 90, view())).toBeGreaterThan(0);
  });

  it('scales linearly with view.scale and ignores pan', () => {
    expect(canvasPxPerDeg(90, 30, view(0, 800))).toBeCloseTo(
      canvasPxPerDeg(90, 30, view(0, 400)) * 2,
      6,
    );
    expect(canvasPxPerDeg(90, 30, offsetView())).toBeCloseTo(projUnitsPerDeg(90, 30) * 913, 6);
  });

  it('ignores map rotation (a rotation is not a scale change)', () => {
    expect(canvasPxPerDeg(90, 30, view(0))).toBeCloseTo(canvasPxPerDeg(90, 30, view(137)), 6);
  });
});

describe('canvasPxPerDeg: zenith mode keys on altitude, not declination', () => {
  it('matches the altitude-based stereographic factor', () => {
    enterZenith();
    // Same declination, two very different altitudes: the dec-based formula cannot tell
    // them apart, which is exactly the bug — the frame was sized by dec.
    for (const [alt, az] of [
      [70, 10],
      [40, 100],
      [12, 250],
    ] as [number, number][]) {
      const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
      const expected =
        ((1 * DEG2RAD) / (2 * Math.cos(((90 - alt) * DEG2RAD) / 2) ** 2)) * view().scale;
      expect(canvasPxPerDeg(raDeg, decDeg, view()) / expected).toBeCloseTo(1, 6);
    }
  });

  it('differs from the dec-based value — the reported "frame too big" bug', () => {
    // M14: RA 264.4°, Dec −3.24°. At LST 17.6h it is near the meridian, so it is well up
    // for a mid-northern observer — the situation the user reported.
    const ra = 264.4;
    const dec = -3.24;
    const lstH = 17.6;
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(lstH, LAT_DEG);

    const v = view();
    const { altDeg } = altAzFromRaDec(ra, dec, lstH, LAT_DEG);
    expect(altDeg).toBeGreaterThan(0); // sanity: above the horizon for this observer

    const decBased = angularSizeToCanvasPx(60, dec, v.scale);
    const correct = canvasPxPerDeg(ra, dec, v);
    // The old value oversizes the frame. Assert the direction and a meaningful magnitude
    // rather than an exact ratio (which depends on the test observer).
    expect(decBased / correct).toBeGreaterThan(1.2);
  });

  it('returns 0 below the horizon', () => {
    enterZenith();
    const { raDeg, decDeg } = raDecFromAltAz(-25, 200, LST_H, LAT_DEG);
    expect(isSkyPointVisible(raDeg, decDeg)).toBe(false);
    expect(canvasPxPerDeg(raDeg, decDeg, view())).toBe(0);
  });
});

// ── Axes ──────────────────────────────────────────────────────────────────────

describe('canvasSkyAxes: agrees with a direct project() + toCanvas() measurement', () => {
  const cases: Array<[string, () => void]> = [
    ['pole/stereo north', () => setHemisphere('north')],
    [
      'pole/stereo south',
      () => {
        setHemisphere('south');
      },
    ],
    ['pole/fisheye', () => setProjectionMode('fisheye')],
    ['zenith/stereo', () => enterZenith()],
  ];

  for (const [label, setup] of cases) {
    for (const rot of [0, 30, -75]) {
      it(`${label}, map rotation ${rot}°`, () => {
        setup();
        const v = view(rot);
        // A point comfortably inside every projection (above the horizon at LST 5/lat 40).
        const { raDeg, decDeg } = raDecFromAltAz(55, 120, LST_H, LAT_DEG);
        // Compared modulo 2π (atan2 wraps at ±π), at precision 3 (≈0.06°): the reference
        // uses a one-sided difference, whose own error grows with the projection's curvature.
        expect(
          angDiffRad(
            canvasSkyAxes(raDeg, decDeg, v).northAngle,
            measuredCanvasNorthAngle(raDeg, decDeg, v),
          ),
        ).toBeCloseTo(0, 3);
      });
    }
  }
});

describe('canvasSkyAxes: handedness', () => {
  it('a position angle lowers the canvas angle in the pole-centred map (eastSign = −1)', () => {
    expect(skyAxesProj(45, 20).eastSign).toBe(-1);
    expect(skyAxesProj(200, -40).eastSign).toBe(-1);
  });

  it('the zenith dome keeps the same handedness — it is not mirrored', () => {
    // project()'s zenith branch negates x precisely so the dome reads as "looking up, North
    // top, East left", matching the celestial map. So a PA runs the same way round in both,
    // and the Local Sky orientation bug is the parallactic rotation of north alone.
    enterZenith();
    for (const [alt, az] of [
      [60, 45],
      [30, 190],
      [15, 300],
    ] as [number, number][]) {
      const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
      expect(skyAxesProj(raDeg, decDeg).eastSign).toBe(-1);
    }
  });
});

describe('canvasSkyAxes: pole mode matches the legacy north-angle formula', () => {
  // atan2(cos ra, −sin ra) is the direction of celestial north in the pole-centred
  // stereographic map. It must survive the switch untouched at rotation 0.
  for (const ra of [0, 37, 145.5, 270, 359]) {
    it(`ra=${ra}`, () => {
      const expected = Math.atan2(Math.cos(ra * DEG2RAD), -Math.sin(ra * DEG2RAD));
      expect(skyAxesProj(ra, 10).northAngle).toBeCloseTo(expected, 4);
    });
  }

  it('the map rotation SUBTRACTS from the canvas angle', () => {
    // toCanvas maps (dx, dy) → (dx·cos+dy·sin, −dx·sin+dy·cos), which lowers an atan2
    // angle by θ. The legacy helpers added it instead, so a rotated map mis-oriented
    // every PA-driven shape by 2θ; this pins the correct sign.
    const v = view(30);
    const measured = measuredCanvasNorthAngle(0, 0, v);
    expect(measured * RAD2DEG).toBeCloseTo(90 - 30, 3);
    expect(canvasSkyAxes(0, 0, v).northAngle * RAD2DEG).toBeCloseTo(90 - 30, 3);
  });

  it('is unaffected by pan and zoom', () => {
    expect(skyAxesProj(210, -15).northAngle).toBeCloseTo(
      canvasSkyAxes(210, -15, offsetView(0)).northAngle,
      9,
    );
  });
});

describe('canvasSkyAxes: off-projection points get a neutral result', () => {
  it('below the horizon in zenith mode', () => {
    enterZenith();
    const { raDeg, decDeg } = raDecFromAltAz(-10, 20, LST_H, LAT_DEG);
    const a = skyAxesProj(raDeg, decDeg);
    expect(Number.isFinite(a.northAngle)).toBe(true);
    expect(a.eastSign).toBe(-1);
  });

  it('far hemisphere in pole-centred fisheye', () => {
    setProjectionMode('fisheye');
    const a = skyAxesProj(100, -40); // dec < 0 is folded away in north fisheye
    expect(Number.isFinite(a.northAngle)).toBe(true);
    expect(projUnitsPerDeg(100, -40)).toBe(0);
  });
});

// ── PA ↔ canvas angle ─────────────────────────────────────────────────────────

describe('paToCanvasAngle / canvasAngleToPa', () => {
  it('pole mode reproduces the legacy northAngle − pa mapping', () => {
    const v = view(0);
    for (const [ra, pa] of [
      [0, 0],
      [90, 45],
      [200, 137],
    ] as [number, number][]) {
      const legacy = Math.atan2(Math.cos(ra * DEG2RAD), -Math.sin(ra * DEG2RAD)) - pa * DEG2RAD;
      expect(paToCanvasAngle(pa, ra, 12, v)).toBeCloseTo(legacy, 4);
    }
  });

  it('round-trips in pole mode', () => {
    const v = view(23);
    for (const pa of [0, 17, 90, 233, 359]) {
      expect(canvasAngleToPa(paToCanvasAngle(pa, 143, -8, v), 143, -8, v)).toBeCloseTo(pa, 4);
    }
  });

  it('round-trips in zenith mode', () => {
    enterZenith();
    const v = view(0);
    const { raDeg, decDeg } = raDecFromAltAz(48, 215, LST_H, LAT_DEG);
    for (const pa of [0, 17, 90, 233, 359]) {
      expect(canvasAngleToPa(paToCanvasAngle(pa, raDeg, decDeg, v), raDeg, decDeg, v)).toBeCloseTo(
        pa,
        4,
      );
    }
  });

  it('a PA maps to a different screen angle in zenith mode than in pole mode', () => {
    // The whole point of the fix: the same stored PA points elsewhere on the dome.
    const { raDeg, decDeg } = raDecFromAltAz(35, 95, LST_H, LAT_DEG);
    const v = view(0);
    const poleAngle = paToCanvasAngle(0, raDeg, decDeg, v);
    enterZenith();
    const zenithAngle = paToCanvasAngle(0, raDeg, decDeg, v);
    expect(Math.abs(zenithAngle - poleAngle)).toBeGreaterThan(5 * DEG2RAD);
  });

  it('PA measured east of north actually runs toward east on screen', () => {
    // PA 90° must point along +RA. Verified against a real projected offset rather than
    // the formula, in both centre modes (opposite screen handedness).
    for (const setup of [() => {}, () => enterZenith()]) {
      setup();
      const v = view(0);
      const { raDeg, decDeg } = raDecFromAltAz(50, 130, LST_H, LAT_DEG);
      const angle = paToCanvasAngle(90, raDeg, decDeg, v);
      const pc = project(raDeg, decDeg);
      const pe = project(raDeg + 0.01 / Math.cos(decDeg * DEG2RAD), decDeg);
      const c = toCanvas(pc.x, pc.y, v);
      const e = toCanvas(pe.x, pe.y, v);
      const eastAngle = Math.atan2(e.y - c.y, e.x - c.x);
      expect(Math.cos(angle - eastAngle)).toBeGreaterThan(0.999);
      setCenterMode('pole');
    }
  });
});
