import { describe, it, expect, vi } from 'vitest';
import {
  computeAffineTransform,
  computeSimilarityTransform,
  computeAffineLSQ,
  affineToCSS,
} from '../../src/affine';

// Mock i18n so affine.ts can be imported in Node/happy-dom without localStorage issues
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

function applyAffine(
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number,
) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

describe('computeAffineTransform (3-point exact)', () => {
  it('identity mapping returns identity matrix', () => {
    const pts: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const m = computeAffineTransform(pts, pts);
    expect(m.a).toBeCloseTo(1);
    expect(m.d).toBeCloseTo(1);
    expect(m.b).toBeCloseTo(0);
    expect(m.c).toBeCloseTo(0);
    expect(m.e).toBeCloseTo(0);
    expect(m.f).toBeCloseTo(0);
  });

  it('maps 3 input points to 3 output points exactly (roundtrip)', () => {
    const photo: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 200 },
      { x: 800, y: 150 },
      { x: 400, y: 900 },
    ];
    const canvas: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 300, y: 400 },
      { x: 700, y: 350 },
      { x: 500, y: 800 },
    ];
    const m = computeAffineTransform(photo, canvas);
    for (let i = 0; i < 3; i++) {
      const result = applyAffine(m, photo[i].x, photo[i].y);
      expect(result.x).toBeCloseTo(canvas[i].x, 6);
      expect(result.y).toBeCloseTo(canvas[i].y, 6);
    }
  });

  it('handles pure translation', () => {
    const shift = { dx: 150, dy: -80 };
    const photo: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const canvas: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: shift.dx, y: shift.dy },
      { x: 100 + shift.dx, y: shift.dy },
      { x: shift.dx, y: 100 + shift.dy },
    ];
    const m = computeAffineTransform(photo, canvas);
    expect(m.a).toBeCloseTo(1);
    expect(m.d).toBeCloseTo(1);
    expect(m.e).toBeCloseTo(shift.dx);
    expect(m.f).toBeCloseTo(shift.dy);
  });

  it('handles uniform scaling', () => {
    const scale = 2.5;
    const photo: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const canvas: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: scale * 100, y: 0 },
      { x: 0, y: scale * 100 },
    ];
    const m = computeAffineTransform(photo, canvas);
    expect(m.a).toBeCloseTo(scale);
    expect(m.d).toBeCloseTo(scale);
  });

  it('throws on collinear points', () => {
    const collinear: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(() => computeAffineTransform(collinear, collinear)).toThrow();
  });
});

describe('computeSimilarityTransform (2-point)', () => {
  it('maps 2 points exactly', () => {
    const photo: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const canvas: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 200, y: 300 },
      { x: 300, y: 300 },
    ];
    const m = computeSimilarityTransform(photo, canvas);
    const r0 = applyAffine(m, 0, 0);
    const r1 = applyAffine(m, 100, 0);
    expect(r0.x).toBeCloseTo(200);
    expect(r0.y).toBeCloseTo(300);
    expect(r1.x).toBeCloseTo(300);
    expect(r1.y).toBeCloseTo(300);
  });

  it('produces a similarity matrix: c = -b, d = a', () => {
    const photo: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const canvas: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 }, // 90° CCW rotation
    ];
    const m = computeSimilarityTransform(photo, canvas);
    expect(m.c).toBeCloseTo(-m.b);
    expect(m.d).toBeCloseTo(m.a);
  });

  it('throws when photo points are coincident', () => {
    const pts: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(() => computeSimilarityTransform(pts, pts)).toThrow();
  });
});

describe('computeAffineLSQ (N-point least squares)', () => {
  it('exact result for N=3 (same as 3-point solver)', () => {
    const photo = [
      { x: 100, y: 200 },
      { x: 800, y: 150 },
      { x: 400, y: 900 },
    ];
    const canvas = [
      { x: 300, y: 400 },
      { x: 700, y: 350 },
      { x: 500, y: 800 },
    ];
    const m = computeAffineLSQ(photo, canvas);
    for (let i = 0; i < 3; i++) {
      const result = applyAffine(m, photo[i].x, photo[i].y);
      expect(result.x).toBeCloseTo(canvas[i].x, 4);
      expect(result.y).toBeCloseTo(canvas[i].y, 4);
    }
  });

  it('low residuals for N=5 near-perfect correspondences (small noise)', () => {
    // Perfect correspondences with tiny noise
    const photo = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 50, y: 50 },
    ];
    // Perfect scale-2 + translate(10,20)
    const canvas = photo.map((p) => ({ x: p.x * 2 + 10, y: p.y * 2 + 20 }));
    const m = computeAffineLSQ(photo, canvas);
    expect(m.a).toBeCloseTo(2, 4);
    expect(m.d).toBeCloseTo(2, 4);
    expect(m.e).toBeCloseTo(10, 4);
    expect(m.f).toBeCloseTo(20, 4);
  });

  it('throws for fewer than 2 points', () => {
    expect(() => computeAffineLSQ([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toThrow();
  });

  it('falls back to similarity when photo points are collinear (N=4)', () => {
    // All photo points on y = x line → normal matrix is singular
    const photo = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    // Perfect scale-2 + translate(10, 20) applied to each
    const canvas = photo.map((p) => ({ x: p.x * 2 + 10, y: p.y * 2 + 20 }));
    // Should not throw — falls back to similarity from most-separated pair (indices 0 and 3)
    const m = computeAffineLSQ(photo, canvas);
    // The similarity fit on [p0,p3]→[c0,c3] should still map those two points correctly
    const r0 = applyAffine(m, photo[0].x, photo[0].y);
    const r3 = applyAffine(m, photo[3].x, photo[3].y);
    expect(r0.x).toBeCloseTo(canvas[0].x, 4);
    expect(r0.y).toBeCloseTo(canvas[0].y, 4);
    expect(r3.x).toBeCloseTo(canvas[3].x, 4);
    expect(r3.y).toBeCloseTo(canvas[3].y, 4);
  });

  it('throws when all points are coincident', () => {
    const pts = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(() => computeAffineLSQ(pts, pts)).toThrow();
  });
});

describe('affineToCSS', () => {
  it('formats as matrix(a,b,c,d,e,f)', () => {
    const css = affineToCSS({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 200 });
    expect(css).toBe('matrix(1, 0, 0, 1, 100, 200)');
  });

  it('identity matrix formats correctly', () => {
    expect(affineToCSS({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });
});
