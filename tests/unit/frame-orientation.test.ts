import { describe, it, expect, afterEach } from 'vitest';
import {
  paToCanvasRotationDeg,
  canvasRotationToPaDeg,
  formatPaDeg,
} from '../../src/frame-orientation';
import { setCenterMode, setProjectionObserver, setProjectionMode } from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';

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
const DEC = 20;
const LST_H = 5;
const LAT_DEG = 40;

const v = (rotationDeg: number) => ({ rotationDeg });

afterEach(() => {
  setCenterMode('pole');
  setProjectionMode('stereo');
});

describe('frame orientation (PA ↔ canvas rotation)', () => {
  it('PA → canvas rotation → PA round-trips at the same position', () => {
    for (const ra of RAS) {
      for (const vr of VIEW_ROTS) {
        for (const pa of PAS) {
          const rot = paToCanvasRotationDeg(pa, ra, DEC, v(vr));
          expect(angDiff(canvasRotationToPaDeg(rot, ra, DEC, v(vr)), pa)).toBeCloseTo(0, 6);
        }
      }
    }
  });

  it('preserves the on-screen orientation when a frame is moved to a new RA', () => {
    // This is the move algorithm: capture the canvas rotation at the old position,
    // recompute the PA at the new one, and the displayed rotation must be unchanged.
    for (const oldRa of RAS) {
      for (const newRa of RAS) {
        for (const vr of VIEW_ROTS) {
          for (const pa1 of PAS) {
            const rot1 = paToCanvasRotationDeg(pa1, oldRa, DEC, v(vr));
            const pa2 = canvasRotationToPaDeg(rot1, newRa, DEC, v(vr));
            const rot2 = paToCanvasRotationDeg(pa2, newRa, DEC, v(vr));
            expect(angDiff(rot2, rot1)).toBeCloseTo(0, 6);
          }
        }
      }
    }
  });

  it('moving without changing position leaves the PA unchanged', () => {
    for (const ra of RAS) {
      const rot = paToCanvasRotationDeg(142, ra, DEC, v(0));
      expect(angDiff(canvasRotationToPaDeg(rot, ra, DEC, v(0)), 142)).toBeCloseTo(0, 6);
    }
  });

  it('the recomputed PA actually changes across RA (the frame is not just kept at a fixed PA)', () => {
    // Holding screen orientation across a large RA move requires a different PA —
    // this is exactly the "frame no longer spins to stay north-aligned" behaviour.
    const rot1 = paToCanvasRotationDeg(0, 0, DEC, v(0));
    const pa2 = canvasRotationToPaDeg(rot1, 90, DEC, v(0));
    expect(Math.abs(angDiff(pa2, 0))).toBeGreaterThan(1);
  });

  it('matches the legacy pole-centred mapping (regression guard for the default view)', () => {
    // Legacy: atan2(cos ra, −sin ra) − pa, then +90 for the frame's top edge.
    for (const ra of RAS) {
      for (const pa of PAS) {
        const raRad = (ra * Math.PI) / 180;
        const legacy =
          ((Math.atan2(Math.cos(raRad), -Math.sin(raRad)) - (pa * Math.PI) / 180) * 180) / Math.PI +
          90;
        expect(angDiff(paToCanvasRotationDeg(pa, ra, DEC, v(0)), legacy)).toBeCloseTo(0, 4);
      }
    }
  });
});

describe('frame orientation in the Local Sky (zenith) view', () => {
  const enterZenith = () => {
    setCenterMode('zenith');
    setProjectionObserver(LST_H, LAT_DEG);
  };

  it('round-trips PA → canvas rotation → PA on the dome', () => {
    enterZenith();
    for (const [alt, az] of [
      [70, 15],
      [45, 130],
      [20, 265],
    ] as [number, number][]) {
      const { raDeg, decDeg } = raDecFromAltAz(alt, az, LST_H, LAT_DEG);
      for (const vr of VIEW_ROTS) {
        for (const pa of PAS) {
          const rot = paToCanvasRotationDeg(pa, raDeg, decDeg, v(vr));
          expect(angDiff(canvasRotationToPaDeg(rot, raDeg, decDeg, v(vr)), pa)).toBeCloseTo(0, 6);
        }
      }
    }
  });

  it('gives a different canvas rotation than the pole-centred view — the reported bug', () => {
    const { raDeg, decDeg } = raDecFromAltAz(40, 120, LST_H, LAT_DEG);
    const poleRot = paToCanvasRotationDeg(0, raDeg, decDeg, v(0));
    enterZenith();
    const zenithRot = paToCanvasRotationDeg(0, raDeg, decDeg, v(0));
    expect(Math.abs(angDiff(zenithRot, poleRot))).toBeGreaterThan(5);
  });

  it('preserves on-screen orientation across a move on the dome', () => {
    enterZenith();
    const a = raDecFromAltAz(60, 40, LST_H, LAT_DEG);
    const b = raDecFromAltAz(25, 250, LST_H, LAT_DEG);
    const rot1 = paToCanvasRotationDeg(75, a.raDeg, a.decDeg, v(0));
    const pa2 = canvasRotationToPaDeg(rot1, b.raDeg, b.decDeg, v(0));
    const rot2 = paToCanvasRotationDeg(pa2, b.raDeg, b.decDeg, v(0));
    expect(angDiff(rot2, rot1)).toBeCloseTo(0, 6);
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
