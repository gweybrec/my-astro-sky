import { describe, it, expect, afterEach } from 'vitest';
import {
  project,
  unproject,
  borderRadiusPU,
  setProjectionMode,
  setHemisphere,
  setCenterMode,
  getCenterMode,
  setProjectionObserver,
  getProjectionGeneration,
  zenithHorizonCrossing,
} from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';

const DEG2RAD = Math.PI / 180;
const LST_H = 5;
const LAT_DEG = 40;

afterEach(() => {
  setCenterMode('pole');
  setProjectionMode('stereo');
  setHemisphere('north');
});

// ── Zenith centering ─────────────────────────────────────────────────────────

describe('zenith mode: zenith at origin', () => {
  // Precision 5 (not the usual 6-9): raDecFromAltAz → project()'s internal
  // altAzFromRaDec is a forward+inverse round trip through several trig calls,
  // which accumulates more floating-point noise than a direct formula check.
  it('the point at alt=90 projects to the origin (stereo)', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(90, 0, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('the point at alt=90 projects to the origin (fisheye)', () => {
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(90, 0, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });
});

describe('zenith mode: horizon radius', () => {
  it('an object at alt=0 has r=1.0 (stereo)', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    // A hair above exactly 0: like the fisheye case below, both radial forms now clip
    // alt<0 off-canvas, and the round trip through raDecFromAltAz → project()'s internal
    // altAzFromRaDec can otherwise land a fraction on the negative side of an exact horizon.
    // 4-digit tolerance (not 6): stereo's r = tan((90-alt)/2) is steeper near the
    // horizon than fisheye's cos(alt), so the tiny 0.001° nudge moves r by ~1.7e-5.
    const { raDeg, decDeg } = raDecFromAltAz(0.001, 120, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(1.0, 4);
  });

  it('an object at alt=0 has r=1.0 (fisheye)', () => {
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    // A hair above exactly 0: fisheye clips alt<0 off-canvas, and the round trip
    // through raDecFromAltAz → project()'s internal altAzFromRaDec can otherwise
    // land a fraction of a degree on the negative side of an exact horizon.
    const { raDeg, decDeg } = raDecFromAltAz(0.001, 200, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(1.0, 6);
  });

  it('r = tan((90-alt)/2) at alt=45 (stereo)', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(45, 80, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(Math.tan((45 / 2) * DEG2RAD), 6);
  });

  it('r = cos(alt) at alt=30 (fisheye)', () => {
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(30, 80, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(Math.cos(30 * DEG2RAD), 6);
  });
});

describe('zenith mode: below-horizon clipping', () => {
  it('fisheye clips alt<0 off-canvas', () => {
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(-10, 50, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    expect(p.x).toBe(1e6);
    expect(p.y).toBe(1e6);
  });

  it('stereo also clips alt<0 off-canvas (the horizon is a real edge in zenith mode)', () => {
    // Unlike pole-centred stereo (where the far hemisphere is a valid part of the
    // map), zenith mode's horizon is a hard boundary: below-horizon points must clip
    // to the same 1e6 sentinel as fisheye so the pen-lift logic in drawConstellationLines
    // and the grid strokers lifts the pen instead of streaking a chord between two
    // below-horizon stars across the visible sky.
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(-10, 50, LST_H, LAT_DEG);
    const p = project(raDeg, decDeg);
    expect(p.x).toBe(1e6);
    expect(p.y).toBe(1e6);
  });
});

describe('zenith mode: horizon crossing (edge clipping for constellation lines)', () => {
  it('returns null when both points are above the horizon', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const a = raDecFromAltAz(30, 100, LST_H, LAT_DEG);
    const b = raDecFromAltAz(50, 140, LST_H, LAT_DEG);
    expect(zenithHorizonCrossing(a.raDeg, a.decDeg, b.raDeg, b.decDeg)).toBeNull();
  });

  it('returns null when both points are below the horizon', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const a = raDecFromAltAz(-30, 100, LST_H, LAT_DEG);
    const b = raDecFromAltAz(-10, 140, LST_H, LAT_DEG);
    expect(zenithHorizonCrossing(a.raDeg, a.decDeg, b.raDeg, b.decDeg)).toBeNull();
  });

  it('returns a point on the rim (r=1) when the edge straddles the horizon', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const above = raDecFromAltAz(20, 120, LST_H, LAT_DEG);
    const below = raDecFromAltAz(-20, 120, LST_H, LAT_DEG);
    const edge = zenithHorizonCrossing(above.raDeg, above.decDeg, below.raDeg, below.decDeg)!;
    expect(edge).not.toBeNull();
    const r = Math.sqrt(edge.x * edge.x + edge.y * edge.y);
    expect(r).toBeCloseTo(1.0, 6);
  });

  it('the crossing matches project() at the exact alt=0 point along a constant-azimuth edge', () => {
    // Two points at the same azimuth straddling the horizon: the crossing must land at
    // alt=0 for that azimuth, i.e. exactly where project() maps an alt≈0 point.
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const az = 200;
    const above = raDecFromAltAz(15, az, LST_H, LAT_DEG);
    const below = raDecFromAltAz(-15, az, LST_H, LAT_DEG);
    const edge = zenithHorizonCrossing(above.raDeg, above.decDeg, below.raDeg, below.decDeg)!;
    const onHorizon = raDecFromAltAz(0.0001, az, LST_H, LAT_DEG);
    const expected = project(onHorizon.raDeg, onHorizon.decDeg);
    expect(edge.x).toBeCloseTo(expected.x, 3);
    expect(edge.y).toBeCloseTo(expected.y, 3);
  });

  it('is symmetric in argument order', () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const above = raDecFromAltAz(25, 300, LST_H, LAT_DEG);
    const below = raDecFromAltAz(-25, 300, LST_H, LAT_DEG);
    const ab = zenithHorizonCrossing(above.raDeg, above.decDeg, below.raDeg, below.decDeg)!;
    const ba = zenithHorizonCrossing(below.raDeg, below.decDeg, above.raDeg, above.decDeg)!;
    expect(ba.x).toBeCloseTo(ab.x, 9);
    expect(ba.y).toBeCloseTo(ab.y, 9);
  });
});

describe('zenith mode: hemisphere is irrelevant', () => {
  it('project() gives identical output regardless of setHemisphere', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
    const { raDeg, decDeg } = raDecFromAltAz(35, 210, LST_H, LAT_DEG);
    setHemisphere('north');
    const pNorth = project(raDeg, decDeg);
    setHemisphere('south');
    const pSouth = project(raDeg, decDeg);
    expect(pSouth.x).toBeCloseTo(pNorth.x, 12);
    expect(pSouth.y).toBeCloseTo(pNorth.y, 12);
  });
});

// ── East/West handedness ─────────────────────────────────────────────────────
// A looking-up dome with North at top must read East on the left (x<0) and West on
// the right (x>0) — the mirror of a ground map. Azimuth is standard clockwise-from-
// north (E=90°, W=270°), so project()'s zenith branch negates its x component. These
// assertions pin that orientation; the pre-fix (un-negated) code had East on the right.

describe('zenith mode: east-west handedness', () => {
  for (const mode of ['stereo', 'fisheye'] as const) {
    it(`North up, East left, South down, West right (${mode})`, () => {
      setProjectionMode(mode);
      setCenterMode('zenith');
      setProjectionObserver(LST_H, LAT_DEG);

      const proj = (alt: number, az: number) => {
        const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
        return project(raDeg, decDeg);
      };

      // North (az=0): top — x≈0, y>0
      const n = proj(45, 0);
      expect(n.x).toBeCloseTo(0, 4);
      expect(n.y).toBeGreaterThan(0);

      // South (az=180): bottom — x≈0, y<0
      const s = proj(45, 180);
      expect(s.x).toBeCloseTo(0, 4);
      expect(s.y).toBeLessThan(0);

      // East (az=90): screen-left — x<0
      expect(proj(45, 90).x).toBeLessThan(0);

      // West (az=270): screen-right — x>0
      expect(proj(45, 270).x).toBeGreaterThan(0);
    });
  }
});

// ── Roundtrip ────────────────────────────────────────────────────────────────

describe('zenith mode: roundtrip project → unproject', () => {
  const cases: Array<{ alt: number; az: number; label: string }> = [
    { alt: 60, az: 10, label: 'high altitude' },
    { alt: 20, az: 250, label: 'low altitude' },
    { alt: 5, az: 359, label: 'near-horizon, near-north' },
  ];

  for (const { alt, az, label } of cases) {
    it(`roundtrip (stereo) for ${label} (alt=${alt}, az=${az})`, () => {
      setProjectionMode('stereo');
      setCenterMode('zenith');
      setProjectionObserver(LST_H, LAT_DEG);
      const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
      const p = project(raDeg, decDeg);
      const back = unproject(p.x, p.y);
      expect(back.dec).toBeCloseTo(decDeg, 4);
      const raDiff = Math.abs(back.ra - raDeg) % 360;
      expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(1e-3);
    });

    it(`roundtrip (fisheye) for ${label} (alt=${alt}, az=${az})`, () => {
      setProjectionMode('fisheye');
      setCenterMode('zenith');
      setProjectionObserver(LST_H, LAT_DEG);
      const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
      const p = project(raDeg, decDeg);
      if (p.x > 1e5) return; // clipped below horizon
      const back = unproject(p.x, p.y);
      expect(back.dec).toBeCloseTo(decDeg, 4);
      const raDiff = Math.abs(back.ra - raDeg) % 360;
      expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(1e-3);
    });
  }
});

// ── borderRadiusPU in zenith mode ───────────────────────────────────────────

describe('zenith mode: borderRadiusPU', () => {
  it('returns 1.0 regardless of the borderLatDeg arg, for stereo radial style', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    expect(borderRadiusPU(0)).toBe(1.0);
    expect(borderRadiusPU(45)).toBe(1.0);
    expect(borderRadiusPU(90)).toBe(1.0);
  });

  it('returns 1.0 regardless of the borderLatDeg arg, for fisheye radial style', () => {
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    expect(borderRadiusPU(0)).toBe(1.0);
    expect(borderRadiusPU(45)).toBe(1.0);
  });

  /**
   * Why SkyMap does NOT draw the horizon line in Local Sky mode: here the border ring
   * already *is* the horizon, so a second stroke only repaints the rim in the accent
   * colour. Worse, alt 0 sits exactly on the projection's visibility boundary, so
   * rounding sends roughly half the azimuths off-projection and the redundant stroke
   * lands as a partial orange arc over one side of the ring.
   *
   * If the zenith projection ever stops putting the horizon on the border, this fails
   * and the gate in SkyMap.renderScene() should be revisited.
   */
  it('places the alt=0 circle exactly on the border ring, so the horizon needs no stroke', () => {
    setProjectionMode('stereo');
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);

    let onProjection = 0;
    let offProjection = 0;
    for (let az = 0; az < 360; az += 15) {
      const { raDeg, decDeg } = raDecFromAltAz(0, az, LST_H, LAT_DEG);
      const p = project(raDeg, decDeg);
      if (p.x >= 1e5) {
        offProjection++;
        continue;
      }
      onProjection++;
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(borderRadiusPU(45), 6);
    }

    // Both counts are non-zero: the circle coincides with the ring, and the boundary
    // rounding really does drop a large share of it — the partial-arc artefact.
    expect(onProjection).toBeGreaterThan(0);
    expect(offProjection).toBeGreaterThan(0);
  });
});

// ── Center mode state / generation ──────────────────────────────────────────

describe('center mode state', () => {
  it('defaults to pole', () => {
    expect(getCenterMode()).toBe('pole');
  });

  it('setCenterMode bumps the generation on a real change but not on a no-op set', () => {
    setCenterMode('pole');
    const gen = getProjectionGeneration();
    setCenterMode('pole'); // no-op
    expect(getProjectionGeneration()).toBe(gen);
    setCenterMode('zenith'); // real change
    expect(getProjectionGeneration()).toBe(gen + 1);
    setCenterMode('pole');
  });

  it('setProjectionObserver bumps the generation only while zenith mode is active', () => {
    setCenterMode('pole');
    const gen = getProjectionGeneration();
    setProjectionObserver(1, 10);
    expect(getProjectionGeneration()).toBe(gen); // pole mode: no-op cost

    setCenterMode('zenith');
    const gen2 = getProjectionGeneration();
    setProjectionObserver(2, 20);
    expect(getProjectionGeneration()).toBe(gen2 + 1);
    setCenterMode('pole');
  });
});
