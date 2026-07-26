import { describe, expect, it } from 'vitest';
import { isAltAzInRegion, pointInPolygon, projectAzAlt } from '../../src/region-geometry';

/** A square-ish region centered on the north point at moderate altitude. */
function squareRegion(centerAzDeg: number, centerAltDeg: number, halfSizeDeg: number) {
  const corners = [
    { azDeg: centerAzDeg - halfSizeDeg, altDeg: centerAltDeg - halfSizeDeg },
    { azDeg: centerAzDeg + halfSizeDeg, altDeg: centerAltDeg - halfSizeDeg },
    { azDeg: centerAzDeg + halfSizeDeg, altDeg: centerAltDeg + halfSizeDeg },
    { azDeg: centerAzDeg - halfSizeDeg, altDeg: centerAltDeg + halfSizeDeg },
  ];
  return { points: corners };
}

describe('projectAzAlt', () => {
  it('maps the zenith to the origin', () => {
    const p = projectAzAlt(123, 90);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('maps the horizon to the unit circle regardless of azimuth', () => {
    for (const az of [0, 45, 90, 180, 270, 359]) {
      const p = projectAzAlt(az, 0);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 6);
    }
  });

  it('places north (az=0) on the +y axis and east (az=90) on the -x axis', () => {
    const north = projectAzAlt(0, 45);
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeGreaterThan(0);

    const east = projectAzAlt(90, 45);
    expect(east.x).toBeLessThan(0);
    expect(east.y).toBeCloseTo(0, 6);
  });
});

describe('pointInPolygon', () => {
  it('detects a point inside a simple square', () => {
    const poly = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    expect(pointInPolygon({ x: 0, y: 0 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(false);
  });
});

describe('isAltAzInRegion', () => {
  it('is true for a point clearly inside the region', () => {
    const region = squareRegion(45, 50, 20);
    expect(isAltAzInRegion(45, 50, region)).toBe(true);
  });

  it('is false for a point clearly outside the region', () => {
    const region = squareRegion(45, 50, 20);
    expect(isAltAzInRegion(200, 20, region)).toBe(false);
  });

  it('is false for any point below the horizon', () => {
    const region = squareRegion(45, 50, 89);
    expect(isAltAzInRegion(45, -5, region)).toBe(false);
  });

  it('handles a region containing the zenith (small square straddling alt=90)', () => {
    const region = squareRegion(0, 85, 10); // spans alt 75..95, clamps near zenith
    expect(isAltAzInRegion(0, 89, region)).toBe(true);
  });

  it('handles a point near the horizon edge inside a region reaching the horizon', () => {
    const region = squareRegion(90, 5, 10); // spans alt -5..15
    expect(isAltAzInRegion(90, 2, region)).toBe(true);
  });

  it('handles a region straddling the az=0/360 wraparound', () => {
    const region = {
      points: [
        { azDeg: 350, altDeg: 30 },
        { azDeg: 10, altDeg: 30 },
        { azDeg: 10, altDeg: 60 },
        { azDeg: 350, altDeg: 60 },
      ],
    };
    // az=0 lies "between" 350 and 10 going through the wraparound.
    expect(isAltAzInRegion(0, 45, region)).toBe(true);
    // Clearly outside on the other side of the sky.
    expect(isAltAzInRegion(180, 45, region)).toBe(false);
  });
});
