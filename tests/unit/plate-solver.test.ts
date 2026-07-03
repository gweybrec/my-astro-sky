import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DetectedSpot, Star } from '../../src/types';

vi.mock('../../src/star-catalog', () => ({
  getStars: vi.fn(),
}));

vi.mock('../../src/projection', () => ({
  project: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  t: vi.fn((k: string) => k),
}));

import { getStars } from '../../src/star-catalog';
import { project } from '../../src/projection';
import { solvePlate } from '../../src/plate-solver';

const mockGetStars = vi.mocked(getStars);
const mockProject = vi.mocked(project);

function angularDistanceRad(a: Star, b: Star): number {
  const d2r = Math.PI / 180;
  const ra1 = a.ra * d2r;
  const dec1 = a.dec * d2r;
  const ra2 = b.ra * d2r;
  const dec2 = b.dec * d2r;

  const x1 = Math.cos(dec1) * Math.cos(ra1);
  const y1 = Math.cos(dec1) * Math.sin(ra1);
  const z1 = Math.sin(dec1);

  const x2 = Math.cos(dec2) * Math.cos(ra2);
  const y2 = Math.cos(dec2) * Math.sin(ra2);
  const z2 = Math.sin(dec2);

  const dot = x1 * x2 + y1 * y2 + z1 * z2;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function makeSuccessFixture() {
  // Small constellation-like patch (<15 deg separation) to ensure index triangles exist.
  const stars: Star[] = [
    { hip: 1001, ra: 10.0, dec: 10.0, mag: 2.0, bv: 0.5, name: 'A' },
    { hip: 1002, ra: 14.0, dec: 10.2, mag: 2.3, bv: 0.5, name: 'B' },
    { hip: 1003, ra: 10.3, dec: 13.1, mag: 2.6, bv: 0.5, name: 'C' },
    { hip: 1004, ra: 11.8, dec: 11.1, mag: 3.1, bv: 0.5, name: 'D' },
    { hip: 1005, ra: 12.9, dec: 12.3, mag: 3.4, bv: 0.5, name: 'E' },
    { hip: 1006, ra: 11.1, dec: 9.7, mag: 3.8, bv: 0.5, name: 'F' },
  ];

  const s1 = stars[0];
  const s2 = stars[1];
  const s3 = stars[2];

  // Build a pixel triangle with side-length ratios matching angular-distance ratios.
  const d12 = angularDistanceRad(s1, s2);
  const d13 = angularDistanceRad(s1, s3);
  const d23 = angularDistanceRad(s2, s3);

  const k = 220; // keeps largest side >10 px for candidate acceptance
  const D12 = d12 * k;
  const D13 = d13 * k;
  const D23 = d23 * k;

  const p1 = { x: 120, y: 120 };
  const p2 = { x: 120 + D12, y: 120 };
  const x3rel = (D13 * D13 + D12 * D12 - D23 * D23) / (2 * D12);
  const y3rel = Math.sqrt(Math.max(1e-9, D13 * D13 - x3rel * x3rel));
  const p3 = { x: 120 + x3rel, y: 120 + y3rel };

  const p4 = { x: (p1.x + p2.x) / 2 + 4, y: (p1.y + p2.y) / 2 + 7 };
  const p5 = { x: (p2.x + p3.x) / 2 - 6, y: (p2.y + p3.y) / 2 + 3 };
  const p6 = { x: (p1.x + p3.x) / 2 + 5, y: (p1.y + p3.y) / 2 - 6 };

  const byHip = new Map<number, { x: number; y: number }>([
    [1001, p1],
    [1002, p2],
    [1003, p3],
    [1004, p4],
    [1005, p5],
    [1006, p6],
  ]);

  const a = 1.0e-5;
  const c = 2.0e-5;
  const e = 1.0e-3;
  const b = -1.5e-5;
  const d = 1.2e-5;
  const f = -5.0e-4;

  const projectionLookup = new Map<string, { x: number; y: number }>();
  for (const star of stars) {
    const p = byHip.get(star.hip)!;
    projectionLookup.set(`${star.ra},${star.dec}`, {
      x: a * p.x + c * p.y + e,
      y: b * p.x + d * p.y + f,
    });
  }

  const spots: DetectedSpot[] = [
    { x: p1.x, y: p1.y, brightness: 1000, size: 5 },
    { x: p2.x, y: p2.y, brightness: 900, size: 5 },
    { x: p3.x, y: p3.y, brightness: 800, size: 5 },
    { x: p4.x, y: p4.y, brightness: 700, size: 5 },
    { x: p5.x, y: p5.y, brightness: 600, size: 5 },
    { x: p6.x, y: p6.y, brightness: 500, size: 5 },
  ];

  return { stars, spots, projectionLookup };
}

describe('solvePlate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('solves a deterministic synthetic field and returns 3 correspondences', async () => {
    const fx = makeSuccessFixture();

    mockGetStars.mockReturnValue(fx.stars);
    mockProject.mockImplementation((ra: number, dec: number) => {
      const hit = fx.projectionLookup.get(`${ra},${dec}`);
      if (hit) return hit;
      // Fallback path should not be used in this fixture, but keep deterministic.
      return { x: ra * 1e-4, y: dec * 1e-4 };
    });

    const result = await solvePlate(fx.spots, 1920, 1080);

    expect(result.success).toBe(true);
    expect(result.correspondences).toBeDefined();
    expect(result.correspondences).toHaveLength(3);

    const pointIndices = result.correspondences!.map((c) => c.pointIndex).sort((a, b) => a - b);
    expect(pointIndices).toEqual([0, 1, 2]);

    for (const c of result.correspondences!) {
      expect(c.starHip).toBeGreaterThan(0);
      expect(c.photoX).toBeGreaterThan(0);
      expect(c.photoY).toBeGreaterThan(0);
    }
  });

  it('returns noSolution when candidate geometry is too small', async () => {
    mockGetStars.mockReturnValue([
      { hip: 1, ra: 10, dec: 10, mag: 2, bv: 0.5 },
      { hip: 2, ra: 11, dec: 10, mag: 2, bv: 0.5 },
      { hip: 3, ra: 10, dec: 11, mag: 2, bv: 0.5 },
    ]);
    mockProject.mockImplementation((ra: number, dec: number) => ({ x: ra * 1e-4, y: dec * 1e-4 }));

    // dMax < 10 px causes all candidate triangles to be skipped.
    const tinySpots: DetectedSpot[] = [
      { x: 10, y: 10, brightness: 50, size: 3 },
      { x: 15, y: 10, brightness: 40, size: 3 },
      { x: 10, y: 15, brightness: 30, size: 3 },
    ];

    const result = await solvePlate(tinySpots, 1000, 800);
    expect(result.success).toBe(false);
    expect(result.error).toBe('errors.noSolution');
  });

  it('returns notEnoughStars when fewer than 3 spots are provided', async () => {
    mockGetStars.mockReturnValue([]);

    const result = await solvePlate(
      [
        { x: 1, y: 1, brightness: 10, size: 2 },
        { x: 2, y: 2, brightness: 9, size: 2 },
      ],
      1000,
      800,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('errors.notEnoughStars');
  });
});
