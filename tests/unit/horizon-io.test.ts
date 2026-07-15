import { describe, it, expect } from 'vitest';
import {
  horizonAltAt,
  densifyPoints,
  parseHorizonFile,
  wrapAz,
  HORIZON_ALT_FLOOR_DEG,
  type HorizonProfile,
} from '../../src/horizon-io';

describe('wrapAz', () => {
  it('normalises into [0,360)', () => {
    expect(wrapAz(0)).toBe(0);
    expect(wrapAz(360)).toBe(0);
    expect(wrapAz(370)).toBe(10);
    expect(wrapAz(-10)).toBe(350);
    expect(wrapAz(-370)).toBe(350);
  });
});

describe('horizonAltAt', () => {
  const flat: HorizonProfile = {
    lat: 0,
    lon: 0,
    obsHeightM: null,
    azStepDeg: 90,
    alts: [10, 20, 30, 40], // az 0,90,180,270
    source: 'manual',
  };

  it('returns exact sample values at sample azimuths', () => {
    expect(horizonAltAt(flat, 0)).toBeCloseTo(10);
    expect(horizonAltAt(flat, 90)).toBeCloseTo(20);
    expect(horizonAltAt(flat, 180)).toBeCloseTo(30);
    expect(horizonAltAt(flat, 270)).toBeCloseTo(40);
  });

  it('interpolates linearly between samples', () => {
    expect(horizonAltAt(flat, 45)).toBeCloseTo(15);
    expect(horizonAltAt(flat, 135)).toBeCloseTo(25);
  });

  it('interpolates across the 360→0 seam', () => {
    // between az 270 (40) and az 0/360 (10): midpoint 315 → 25
    expect(horizonAltAt(flat, 315)).toBeCloseTo(25);
  });

  it('wraps azimuths outside [0,360)', () => {
    expect(horizonAltAt(flat, 450)).toBeCloseTo(20); // 450 → 90
    expect(horizonAltAt(flat, -90)).toBeCloseTo(40); // -90 → 270
  });

  it('handles empty and single-sample profiles', () => {
    expect(horizonAltAt({ ...flat, alts: [] }, 12)).toBe(HORIZON_ALT_FLOOR_DEG);
    expect(horizonAltAt({ ...flat, alts: [7] }, 200)).toBe(7);
  });
});

describe('densifyPoints', () => {
  it('produces a full 360-sample dense array by default', () => {
    const p = densifyPoints([
      { azDeg: 0, altDeg: 10 },
      { azDeg: 180, altDeg: 30 },
    ]);
    expect(p.alts.length).toBe(360);
    expect(p.azStepDeg).toBe(1);
    expect(horizonAltAt(p, 0)).toBeCloseTo(10);
    expect(horizonAltAt(p, 180)).toBeCloseTo(30);
    expect(horizonAltAt(p, 90)).toBeCloseTo(20); // halfway up the ramp
  });

  it('fills the whole circle from a single point', () => {
    const p = densifyPoints([{ azDeg: 45, altDeg: 12 }]);
    expect(horizonAltAt(p, 0)).toBeCloseTo(12);
    expect(horizonAltAt(p, 300)).toBeCloseTo(12);
  });

  it('interpolates across the wrap seam between last and first points', () => {
    const p = densifyPoints([
      { azDeg: 350, altDeg: 20 },
      { azDeg: 10, altDeg: 40 },
    ]);
    // seam midpoint az 0 sits halfway between 350(20) and 10(40) → 30
    expect(horizonAltAt(p, 0)).toBeCloseTo(30, 1);
  });

  it('returns the floor everywhere for no points', () => {
    const p = densifyPoints([]);
    expect(p.alts.every((a) => a === HORIZON_ALT_FLOOR_DEG)).toBe(true);
  });
});

describe('parseHorizonFile', () => {
  it('parses a comma CSV with header and comments', () => {
    const csv = `# my site horizon\naz,alt\n0,5\n90,12\n180,3\n270,8\n`;
    const p = parseHorizonFile(csv);
    expect(horizonAltAt(p, 0)).toBeCloseTo(5);
    expect(horizonAltAt(p, 90)).toBeCloseTo(12);
  });

  it('parses whitespace-separated Stellarium polygonal format', () => {
    const hor = `0 5\n90 12\n180 3\n270 8\n`;
    const p = parseHorizonFile(hor);
    expect(horizonAltAt(p, 90)).toBeCloseTo(12);
    expect(horizonAltAt(p, 270)).toBeCloseTo(8);
  });

  it('ignores // comments and blank lines', () => {
    const txt = `// header\n\n0 5\n\n180 25 // south ridge\n`;
    const p = parseHorizonFile(txt);
    expect(horizonAltAt(p, 180)).toBeCloseTo(25);
  });

  it('throws when there are no numeric pairs', () => {
    expect(() => parseHorizonFile('# just a comment\nnot numbers here')).toThrow();
  });
});
