import { describe, expect, it } from 'vitest';
import {
  distToSegment,
  minDistToPolygonEdges,
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
} from '../../src/fov-frame-geometry';

// Axis-aligned square centred at (100,100), half-size 50 → corners.
const square = [
  { x: 50, y: 50 },
  { x: 150, y: 50 },
  { x: 150, y: 150 },
  { x: 50, y: 150 },
];

describe('fov frame geometry', () => {
  it('distToSegment handles endpoints and interior projection', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distToSegment(5, 4, a, b)).toBeCloseTo(4);   // perpendicular
    expect(distToSegment(-3, 0, a, b)).toBeCloseTo(3);  // beyond start
    expect(distToSegment(13, 0, a, b)).toBeCloseTo(3);  // beyond end
    expect(distToSegment(0, 0, a, a)).toBeCloseTo(0);   // degenerate segment
  });

  it('minDistToPolygonEdges finds nearest edge', () => {
    // Point just outside the right edge (x=150) at mid-height.
    expect(minDistToPolygonEdges(154, 100, square)).toBeCloseTo(4);
    // Point on an edge.
    expect(minDistToPolygonEdges(100, 50, square)).toBeCloseTo(0);
  });

  it('isNearPolygonBorder respects the threshold', () => {
    expect(isNearPolygonBorder(154, 100, square, 6)).toBe(true);
    expect(isNearPolygonBorder(160, 100, square, 6)).toBe(false);
    // Centre is far from every edge → not "near border".
    expect(isNearPolygonBorder(100, 100, square, 6)).toBe(false);
  });

  it('isNearHandle measures radial distance', () => {
    const h = { x: 100, y: 20 };
    expect(isNearHandle(103, 24, h, 6)).toBe(true);
    expect(isNearHandle(110, 30, h, 6)).toBe(false);
  });

  it('rotateHandlePos sits straight up at zero rotation', () => {
    const h = rotateHandlePos(100, 100, 50, 0, 24);
    expect(h.x).toBeCloseTo(100);
    expect(h.y).toBeCloseTo(100 - 74); // up = halfH + dist
  });

  it('rotateHandlePos and canvasRotationDegFromCursor round-trip', () => {
    for (const rot of [-150, -45, 0, 30, 90, 179]) {
      const h = rotateHandlePos(100, 100, 50, rot, 24);
      const recovered = canvasRotationDegFromCursor(100, 100, h.x, h.y);
      // Compare as normalised angles.
      const diff = ((recovered - rot + 540) % 360) - 180;
      expect(Math.abs(diff)).toBeLessThan(1e-9);
    }
  });
});
