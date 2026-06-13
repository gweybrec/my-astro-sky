import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/star-catalog', () => ({
  getStars: () => [],
  getConstellationLines: () => [],
  getConstellationInfos: () => [],
  loadConstellationStyle: () => {},
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => [],
  getDSOCatalog: () => null,
}));

import { computeFovFrameCorners } from '../../src/sky-map';

describe('computeFovFrameCorners', () => {
  const cx = 100;
  const cy = 100;
  const hw = 40;
  const hh = 20;

  it('at 0° returns axis-aligned rectangle', () => {
    const corners = computeFovFrameCorners(hw, hh, cx, cy, 0);
    expect(corners).toHaveLength(4);
    // Top-left, top-right, bottom-right, bottom-left
    expect(corners[0].x).toBeCloseTo(cx - hw);
    expect(corners[0].y).toBeCloseTo(cy - hh);
    expect(corners[1].x).toBeCloseTo(cx + hw);
    expect(corners[1].y).toBeCloseTo(cy - hh);
    expect(corners[2].x).toBeCloseTo(cx + hw);
    expect(corners[2].y).toBeCloseTo(cy + hh);
    expect(corners[3].x).toBeCloseTo(cx - hw);
    expect(corners[3].y).toBeCloseTo(cy + hh);
  });

  it('at 90° corners are rotated a quarter turn around the center', () => {
    const corners = computeFovFrameCorners(hw, hh, cx, cy, 90);
    // After 90° CW rotation: (-hw, -hh) → (-hh*(-1), -hw*(-1)) ... using rotation matrix
    // cos90=0, sin90=1: x' = cx + px*0 - py*1, y' = cy + px*1 + py*0
    // corner[0] raw (-hw,-hh): x' = cx - (-hh) = cx+hh, y' = cy + (-hw) = cy-hw
    expect(corners[0].x).toBeCloseTo(cx + hh);
    expect(corners[0].y).toBeCloseTo(cy - hw);
  });

  it('is symmetric: opposite corners are equidistant from center', () => {
    const corners = computeFovFrameCorners(hw, hh, cx, cy, 37);
    const dx02 = Math.hypot(corners[0].x - corners[2].x, corners[0].y - corners[2].y);
    const dx13 = Math.hypot(corners[1].x - corners[3].x, corners[1].y - corners[3].y);
    // Diagonals of a rectangle are equal
    expect(dx02).toBeCloseTo(dx13, 4);
    // Center of the diagonal should be the center
    const midX = (corners[0].x + corners[2].x) / 2;
    const midY = (corners[0].y + corners[2].y) / 2;
    expect(midX).toBeCloseTo(cx);
    expect(midY).toBeCloseTo(cy);
  });

  it('preserves aspect ratio after rotation', () => {
    const corners45 = computeFovFrameCorners(hw, hh, cx, cy, 45);
    // Edge lengths should still be 2*hw and 2*hh
    const edge0 = Math.hypot(corners45[1].x - corners45[0].x, corners45[1].y - corners45[0].y);
    const edge1 = Math.hypot(corners45[2].x - corners45[1].x, corners45[2].y - corners45[1].y);
    expect(edge0).toBeCloseTo(2 * hw, 4);
    expect(edge1).toBeCloseTo(2 * hh, 4);
  });

  it('all corners are equidistant from center (property of a rectangle)', () => {
    const corners = computeFovFrameCorners(hw, hh, cx, cy, 123);
    const dist0 = Math.hypot(corners[0].x - cx, corners[0].y - cy);
    for (const c of corners) {
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeCloseTo(dist0, 4);
    }
  });
});

