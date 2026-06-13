import { describe, expect, it } from 'vitest';

import { findTopPhotoOutlineAtPoint } from '../../src/sky-map';
import type { Point } from '../../src/types';

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

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
