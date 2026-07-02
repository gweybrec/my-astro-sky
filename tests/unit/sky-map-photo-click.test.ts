import { describe, expect, it } from 'vitest';

import { findTopPhotoOutlineAtPoint, pointInConvexPolygon } from '../../src/photo-outline';
import type { Point } from '../../src/types';

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

describe('pointInConvexPolygon', () => {
  const square = rect(0, 0, 100, 100);

  it('returns true for an interior point', () => {
    expect(pointInConvexPolygon(50, 50, square)).toBe(true);
  });

  it('returns false for an exterior point', () => {
    expect(pointInConvexPolygon(150, 50, square)).toBe(false);
  });

  it('is winding-order independent (counter-clockwise polygon)', () => {
    const ccw = [...square].reverse();
    expect(pointInConvexPolygon(50, 50, ccw)).toBe(true);
    expect(pointInConvexPolygon(-1, 50, ccw)).toBe(false);
  });

  it('detects a point inside a rotated (non-axis-aligned) quad', () => {
    // Diamond centred at origin, corners on the axes at distance 10.
    const diamond: Point[] = [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }];
    expect(pointInConvexPolygon(0, 0, diamond)).toBe(true);
    expect(pointInConvexPolygon(8, 8, diamond)).toBe(false); // outside the edges
  });
});

describe('findTopPhotoOutlineAtPoint', () => {
  it('returns the top photo when outlines overlap', () => {
    const outlines = [
      { name: 'bottom', corners: rect(10, 10, 110, 110) },
      { name: 'top', corners: rect(30, 30, 90, 90) },
    ];

    expect(findTopPhotoOutlineAtPoint(50, 50, outlines)).toBe('top');
  });

  it('returns the only matching photo when point is outside top overlap', () => {
    const outlines = [
      { name: 'bottom', corners: rect(10, 10, 110, 110) },
      { name: 'top', corners: rect(30, 30, 90, 90) },
    ];

    expect(findTopPhotoOutlineAtPoint(20, 20, outlines)).toBe('bottom');
  });

  it('returns null when no photo contains the point', () => {
    const outlines = [
      { name: 'photo', corners: rect(10, 10, 110, 110) },
    ];

    expect(findTopPhotoOutlineAtPoint(200, 200, outlines)).toBeNull();
  });
});
