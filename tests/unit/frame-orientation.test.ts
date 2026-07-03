import { describe, it, expect } from 'vitest';
import {
  paToCanvasRotationDeg,
  canvasRotationToPaDeg,
  formatPaDeg,
} from '../../src/frame-orientation';

/** Smallest signed difference between two angles, in (-180, 180]. */
function angDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

const RAS = [0, 45, 90, 123, 180, 270, 359];
const VIEW_ROTS = [-30, 0, 17, 90];
const PAS = [0, 30, 90, 142, 200, 359];

describe('frame orientation (PA ↔ canvas rotation)', () => {
  it('PA → canvas rotation → PA round-trips at the same RA', () => {
    for (const ra of RAS) {
      for (const vr of VIEW_ROTS) {
        for (const pa of PAS) {
          const rot = paToCanvasRotationDeg(pa, ra, vr);
          expect(angDiff(canvasRotationToPaDeg(rot, ra, vr), pa)).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it('preserves the on-screen orientation when a frame is moved to a new RA', () => {
    // This is the move algorithm: capture the canvas rotation at the old RA,
    // recompute the PA at the new RA, and the displayed rotation must be unchanged.
    for (const oldRa of RAS) {
      for (const newRa of RAS) {
        for (const vr of VIEW_ROTS) {
          for (const pa1 of PAS) {
            const rot1 = paToCanvasRotationDeg(pa1, oldRa, vr);
            const pa2 = canvasRotationToPaDeg(rot1, newRa, vr);
            const rot2 = paToCanvasRotationDeg(pa2, newRa, vr);
            expect(angDiff(rot2, rot1)).toBeCloseTo(0, 9);
          }
        }
      }
    }
  });

  it('moving without changing RA leaves the PA unchanged', () => {
    for (const ra of RAS) {
      const rot = paToCanvasRotationDeg(142, ra, 0);
      expect(angDiff(canvasRotationToPaDeg(rot, ra, 0), 142)).toBeCloseTo(0, 9);
    }
  });

  it('the recomputed PA actually changes across RA (the frame is not just kept at a fixed PA)', () => {
    // Holding screen orientation across a large RA move requires a different PA —
    // this is exactly the "frame no longer spins to stay north-aligned" behaviour.
    const rot1 = paToCanvasRotationDeg(0, 0, 0);
    const pa2 = canvasRotationToPaDeg(rot1, 90, 0);
    expect(Math.abs(angDiff(pa2, 0))).toBeGreaterThan(1);
  });
});

describe('formatPaDeg', () => {
  it('wraps a value that rounds up to 360° back to 0°', () => {
    expect(formatPaDeg(359.6)).toBe('0°');
    expect(formatPaDeg(360)).toBe('0°');
  });

  it('rounds to whole degrees within range', () => {
    expect(formatPaDeg(0)).toBe('0°');
    expect(formatPaDeg(142.4)).toBe('142°');
    expect(formatPaDeg(359.4)).toBe('359°');
  });

  it('normalises negative angles into [0, 360)', () => {
    expect(formatPaDeg(-1)).toBe('359°');
    expect(formatPaDeg(-0.4)).toBe('0°');
  });
});
