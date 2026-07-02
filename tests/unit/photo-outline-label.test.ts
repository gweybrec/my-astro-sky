import { describe, expect, it } from 'vitest';

import { photoLabelEdgeIndex, photoLabelTransform } from '../../src/photo-outline';
import type { Point } from '../../src/types';

const DEG = Math.PI / 180;

/** Axis-aligned rectangle corners in clockwise order. */
function axisRect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** Rotate a set of corners around (0, 0) by angleDeg. */
function rotateCorners(corners: Point[], angleDeg: number): Point[] {
  const r = angleDeg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return corners.map(({ x, y }) => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }));
}

describe('photoLabelEdgeIndex', () => {
  it('returns 0 for a landscape rectangle (wide side is edge 0)', () => {
    // 100×20 rectangle: edge0 = 100, edge1 = 20
    expect(photoLabelEdgeIndex(axisRect(0, 0, 100, 20))).toBe(0);
  });

  it('returns 1 for a portrait rectangle (tall side is edge 1)', () => {
    // 20×100 rectangle: edge0 = 20, edge1 = 100
    expect(photoLabelEdgeIndex(axisRect(0, 0, 20, 100))).toBe(1);
  });

  it('returns 0 for a square (tie goes to edge 0)', () => {
    expect(photoLabelEdgeIndex(axisRect(0, 0, 50, 50))).toBe(0);
  });

  it('returns the correct edge for a rotated landscape rectangle', () => {
    // Rotate a 100×20 rect by 30°: edge 0 remains the longer side
    const corners = rotateCorners(axisRect(0, 0, 100, 20), 30);
    expect(photoLabelEdgeIndex(corners)).toBe(0);
  });

  it('returns the correct edge for a rotated portrait rectangle', () => {
    // Rotate a 20×100 rect by 45°: edge 1 remains the longer side
    const corners = rotateCorners(axisRect(0, 0, 20, 100), 45);
    expect(photoLabelEdgeIndex(corners)).toBe(1);
  });
});

describe('photoLabelTransform', () => {
  it('anchors at p0 with angle 0 for a rightward edge', () => {
    const corners = axisRect(10, 20, 110, 40); // top edge goes right
    const result = photoLabelTransform(corners, 0);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
    expect(result.angle).toBeCloseTo(0);
  });

  it('anchors at p0 for a downward-right diagonal (angle < 90°)', () => {
    // Edge from (0,0) to (100,50): angle ≈ 26.6° — readable as-is
    const corners: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 90, y: 70 }, { x: -10, y: 20 }];
    const result = photoLabelTransform(corners, 0);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.angle).toBeCloseTo(Math.atan2(50, 100));
  });

  it('flips anchor to p1 when edge points left (angle = π → normalized to 0)', () => {
    // Edge from (100,0) to (0,0): angle = π → flip → π+π = 2π → normalized to 0
    const corners: Point[] = [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }];
    const result = photoLabelTransform(corners, 0);
    expect(result.x).toBeCloseTo(0);   // p1
    expect(result.y).toBeCloseTo(0);
    expect(result.angle).toBeCloseTo(0); // normalized: 2π - 2π = 0
  });

  it('flips anchor to p1 when edge goes up-left (angle < -π/2)', () => {
    // Edge from (100,50) to (0,0): atan2(-50,-100) ≈ -2.678 rad (< -π/2) → flip
    const corners: Point[] = [{ x: 100, y: 50 }, { x: 0, y: 0 }, { x: -10, y: 20 }, { x: 90, y: 70 }];
    const result = photoLabelTransform(corners, 0);
    const rawAngle = Math.atan2(0 - 50, 0 - 100); // ≈ -2.678 rad
    expect(result.x).toBeCloseTo(0);   // p1
    expect(result.y).toBeCloseTo(0);
    expect(result.angle).toBeCloseTo(rawAngle + Math.PI); // ≈ 0.464 rad — already in range
  });

  it('flips anchor to p1 when edge goes down-left (angle > π/2 → normalized)', () => {
    // Edge from (0,0) to (-100, 10): atan2(10,-100) ≈ 3.042 rad > π/2 → flip → normalize
    const corners: Point[] = [{ x: 0, y: 0 }, { x: -100, y: 10 }, { x: -100, y: 30 }, { x: 0, y: 20 }];
    const result = photoLabelTransform(corners, 0);
    const rawAngle = Math.atan2(10, -100); // ≈ 3.042 rad
    const expected = rawAngle + Math.PI - 2 * Math.PI; // normalize: ≈ -0.1 rad
    expect(result.x).toBeCloseTo(-100); // p1
    expect(result.y).toBeCloseTo(10);
    expect(result.angle).toBeCloseTo(expected);
    expect(result.angle).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(result.angle).toBeLessThanOrEqual(Math.PI / 2);
  });

  it('result angle is always in [-π/2, π/2] for an axis-aligned landscape rect', () => {
    // All four starting edges of a 100×20 rect — only edges 0 and 2 are chosen
    // but we test the transform contract
    const corners = axisRect(0, 0, 100, 20);
    for (const edgeIdx of [0, 1] as const) {
      const { angle } = photoLabelTransform(corners, edgeIdx);
      expect(angle).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(angle).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it('result angle is always in [-π/2, π/2] for a rotated rect at various angles', () => {
    for (const deg of [0, 30, 45, 90, 135, 150, 180, 225, 270, 315]) {
      const corners = rotateCorners(axisRect(0, 0, 100, 20), deg);
      const edgeIdx = photoLabelEdgeIndex(corners);
      const { angle } = photoLabelTransform(corners, edgeIdx);
      expect(angle, `deg=${deg}`).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9);
      expect(angle, `deg=${deg}`).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});
