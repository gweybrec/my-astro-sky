import { describe, expect, it } from 'vitest';
import {
  distToSegment,
  minDistToPolygonEdges,
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
  resizeFromCorner,
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

  describe('resizeFromCorner (centre-fixed)', () => {
    it('keeps the centre fixed and is a no-op when the corner is undragged', () => {
      // Drag bottom-right (idx 2) back to where it already is.
      const r = resizeFromCorner(square, 2, 150, 150, 0);
      expect(r.cx).toBeCloseTo(100);
      expect(r.cy).toBeCloseTo(100);
      expect(r.halfW).toBeCloseTo(50);
      expect(r.halfH).toBeCloseTo(50);
    });

    it('grows symmetrically about the fixed centre when a corner is pulled out', () => {
      // Drag BR from (150,150) to (250,250): centre stays (100,100); the frame
      // extends in all directions (the opposite corner moves too).
      const r = resizeFromCorner(square, 2, 250, 250, 0);
      expect(r.cx).toBeCloseTo(100);
      expect(r.cy).toBeCloseTo(100);
      expect(r.halfW).toBeCloseTo(150); // |250-100|
      expect(r.halfH).toBeCloseTo(150);
    });

    it('extending one axis only leaves the other axis unchanged', () => {
      // Drag BR right (x 150→250), y unchanged.
      const r = resizeFromCorner(square, 2, 250, 150, 0);
      expect(r.cx).toBeCloseTo(100);
      expect(r.cy).toBeCloseTo(100);
      expect(r.halfW).toBeCloseTo(150); // |250-100|
      expect(r.halfH).toBeCloseTo(50);  // |150-100|
    });

    it('any corner gives the same centre and extents (symmetry)', () => {
      // Dragging the top-left corner to (0,0) mirrors dragging BR to (200,200).
      const r = resizeFromCorner(square, 0, 0, 0, 0);
      expect(r.cx).toBeCloseTo(100);
      expect(r.cy).toBeCloseTo(100);
      expect(r.halfW).toBeCloseTo(100); // |0-100|
      expect(r.halfH).toBeCloseTo(100);
    });

    it('projects the drag onto the frame axes for a rotated frame', () => {
      // 90°-rotated square: local right = (0,1), local down = (-1,0). Centre (100,100).
      const rotated = [
        { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 50 },
      ];
      const r = resizeFromCorner(rotated, 1, 150, 250, 90);
      expect(r.cx).toBeCloseTo(100);
      expect(r.cy).toBeCloseTo(100);
      expect(r.halfW).toBeCloseTo(150); // along local-x (screen y): |250-100|
      expect(r.halfH).toBeCloseTo(50);  // along local-y (screen x): |150-100|
    });
  });
});
