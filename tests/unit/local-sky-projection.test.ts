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
