import { describe, it, expect, afterEach } from 'vitest';
import {
  project, unproject, borderRadiusPU,
  setProjectionMode, getProjectionMode, setHemisphere,
} from '../../src/projection';

const DEG2RAD = Math.PI / 180;

afterEach(() => {
  setProjectionMode('stereo');
  setHemisphere('north');
});

// ── Basic fisheye geometry (orthographic, pole-centred) ──────────────────────

describe('fisheye: pole', () => {
  it('the celestial pole (Dec=+90) projects to the origin (north)', () => {
    setProjectionMode('fisheye');
    setHemisphere('north');
    const p = project(123, 90);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('the south pole (Dec=−90) projects to the origin (south)', () => {
    setProjectionMode('fisheye');
    setHemisphere('south');
    const p = project(45, -90);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe('fisheye: equator', () => {
  it('an object on the equator has r = 1.0 (outer edge)', () => {
    setProjectionMode('fisheye');
    setHemisphere('north');
    const p = project(90, 0);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(1.0, 6);
  });

  it('r = cos(dec): Dec=60° maps to r = 0.5', () => {
    setProjectionMode('fisheye');
    setHemisphere('north');
    const p = project(0, 60);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(Math.cos(60 * DEG2RAD), 6);
  });
});

describe('fisheye: far hemisphere clipped', () => {
  it('a southern object is pushed off-canvas in north mode', () => {
    setProjectionMode('fisheye');
    setHemisphere('north');
    const p = project(180, -30);
    expect(p.x).toBe(1e6);
    expect(p.y).toBe(1e6);
  });

  it('a northern object is pushed off-canvas in south mode', () => {
    setProjectionMode('fisheye');
    setHemisphere('south');
    const p = project(180, 30);
    expect(p.x).toBe(1e6);
    expect(p.y).toBe(1e6);
  });
});

describe('fisheye: RA orientation matches stereo', () => {
  it('RA=0 at the meridian is straight up the +y axis (x ≈ 0, y > 0)', () => {
    setProjectionMode('fisheye');
    setHemisphere('north');
    const p = project(0, 45);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    expect(p.y).toBeGreaterThan(0);
  });
});

// ── Roundtrip ────────────────────────────────────────────────────────────────

describe('fisheye: roundtrip project → unproject', () => {
  const cases = [
    { ra: 0, dec: 45, label: 'North sky (Dec=+45)' },
    { ra: 30, dec: 20, label: 'RA=30 quadrant' },
    { ra: 330, dec: 70, label: 'near-pole' },
    { ra: 200, dec: 5, label: 'near-equator' },
  ];

  for (const { ra, dec, label } of cases) {
    it(`roundtrip (north) for ${label} (RA=${ra}, Dec=${dec})`, () => {
      setProjectionMode('fisheye');
      setHemisphere('north');
      const p = project(ra, dec);
      if (p.x > 1e5) return; // clipped far hemisphere
      const back = unproject(p.x, p.y);
      expect(back.dec).toBeCloseTo(dec, 4);
      const raDiff = Math.abs(back.ra - ra) % 360;
      expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(1e-3);
    });
  }

  it('roundtrip (south) for a southern object', () => {
    setProjectionMode('fisheye');
    setHemisphere('south');
    const p = project(120, -40);
    const back = unproject(p.x, p.y);
    expect(back.dec).toBeCloseTo(-40, 4);
    const raDiff = Math.abs(back.ra - 120) % 360;
    expect(Math.min(raDiff, 360 - raDiff)).toBeLessThan(1e-3);
  });
});

// ── borderRadiusPU in fisheye mode ──────────────────────────────────────────

describe('borderRadiusPU', () => {
  it('returns 1.0 in fisheye mode (equator circle), regardless of lat arg', () => {
    setProjectionMode('fisheye');
    expect(borderRadiusPU(0)).toBe(1.0);
    expect(borderRadiusPU(45)).toBe(1.0);
    expect(borderRadiusPU(90)).toBe(1.0);
  });

  it('returns stereo formula in stereo mode', () => {
    setProjectionMode('stereo');
    expect(borderRadiusPU(0)).toBeCloseTo(1.0, 12); // tan(45°) = 1
    expect(borderRadiusPU(45)).toBeCloseTo(Math.tan((90 + 45) / 2 * Math.PI / 180), 12);
  });
});

// ── Mode management ──────────────────────────────────────────────────────────

describe('projection mode state', () => {
  it('defaults to stereo', () => {
    expect(getProjectionMode()).toBe('stereo');
  });

  it('switches to fisheye and back', () => {
    setProjectionMode('fisheye');
    expect(getProjectionMode()).toBe('fisheye');
    setProjectionMode('stereo');
    expect(getProjectionMode()).toBe('stereo');
  });
});
