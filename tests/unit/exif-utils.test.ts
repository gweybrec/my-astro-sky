import { describe, it, expect } from 'vitest';
import { rawToBrowserCoords } from '../../server/exif-utils';

describe('rawToBrowserCoords', () => {
  // Use a non-square image so W and H errors are distinguishable
  const W = 4000;
  const H = 3000;

  describe('orientation 1 (identity)', () => {
    it('returns pixel unchanged', () => {
      expect(rawToBrowserCoords(100, 200, W, H, 1)).toEqual({ x: 100, y: 200 });
    });
    it('top-left corner stays top-left', () => {
      expect(rawToBrowserCoords(0, 0, W, H, 1)).toEqual({ x: 0, y: 0 });
    });
    it('bottom-right corner stays bottom-right', () => {
      expect(rawToBrowserCoords(W - 1, H - 1, W, H, 1)).toEqual({ x: W - 1, y: H - 1 });
    });
  });

  describe('orientation 2 (horizontal mirror)', () => {
    it('mirrors X, keeps Y', () => {
      expect(rawToBrowserCoords(0, 0, W, H, 2)).toEqual({ x: W - 1, y: 0 });
      expect(rawToBrowserCoords(W - 1, 0, W, H, 2)).toEqual({ x: 0, y: 0 });
    });
    it('top-right corner maps to top-left', () => {
      expect(rawToBrowserCoords(W - 1, 0, W, H, 2)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('orientation 3 (180° rotation)', () => {
    it('top-left maps to bottom-right', () => {
      expect(rawToBrowserCoords(0, 0, W, H, 3)).toEqual({ x: W - 1, y: H - 1 });
    });
    it('bottom-right maps to top-left', () => {
      expect(rawToBrowserCoords(W - 1, H - 1, W, H, 3)).toEqual({ x: 0, y: 0 });
    });
    it('center maps to center', () => {
      const cx = Math.floor((W - 1) / 2);
      const cy = Math.floor((H - 1) / 2);
      const r = rawToBrowserCoords(cx, cy, W, H, 3);
      expect(r.x).toBeCloseTo(W - 1 - cx, 5);
      expect(r.y).toBeCloseTo(H - 1 - cy, 5);
    });
  });

  describe('orientation 4 (vertical mirror)', () => {
    it('mirrors Y, keeps X', () => {
      expect(rawToBrowserCoords(0, 0, W, H, 4)).toEqual({ x: 0, y: H - 1 });
      expect(rawToBrowserCoords(0, H - 1, W, H, 4)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('orientation 5 (transpose: 90° CCW + horizontal flip)', () => {
    it('swaps X and Y', () => {
      expect(rawToBrowserCoords(10, 20, W, H, 5)).toEqual({ x: 20, y: 10 });
    });
  });

  describe('orientation 6 (90° CW) — regression: must NOT equal orientation 8', () => {
    it('top-left (0,0) maps to bottom-left of rotated image (0, 0) → (H-1, 0)', () => {
      // 90° CW: new_x = H-1-rawY, new_y = rawX
      expect(rawToBrowserCoords(0, 0, W, H, 6)).toEqual({ x: H - 1, y: 0 });
    });
    it('regression (bug May 2026): orientation 6 must NOT produce the orientation-8 result (0, W-1) for (0,0)', () => {
      // The bug swapped cases 6 and 8. With the bug, (0,0) under orientation 6
      // returned { x: 0, y: W-1 } (the CCW formula) instead of { x: H-1, y: 0 }.
      expect(rawToBrowserCoords(0, 0, W, H, 6)).not.toEqual({ x: 0, y: W - 1 });
    });
    it('top-right (W-1, 0) maps to top-left of rotated image → (H-1, W-1)', () => {
      expect(rawToBrowserCoords(W - 1, 0, W, H, 6)).toEqual({ x: H - 1, y: W - 1 });
    });
    it('bottom-left (0, H-1) maps to (0, 0) in rotated image', () => {
      expect(rawToBrowserCoords(0, H - 1, W, H, 6)).toEqual({ x: 0, y: 0 });
    });
    it('produces DIFFERENT result from orientation 8 for same input', () => {
      const r6 = rawToBrowserCoords(100, 200, W, H, 6);
      const r8 = rawToBrowserCoords(100, 200, W, H, 8);
      expect(r6).not.toEqual(r8);
    });
  });

  describe('orientation 7 (anti-transpose: 90° CW + horizontal flip)', () => {
    it('top-left (0,0) maps to bottom-right of rotated image → (H-1, W-1)', () => {
      // formula: new_x = H-1-rawY, new_y = W-1-rawX
      expect(rawToBrowserCoords(0, 0, W, H, 7)).toEqual({ x: H - 1, y: W - 1 });
    });
    it('top-right (W-1, 0) maps to top-right → (H-1, 0)', () => {
      expect(rawToBrowserCoords(W - 1, 0, W, H, 7)).toEqual({ x: H - 1, y: 0 });
    });
    it('produces DIFFERENT result from orientation 5 for same input', () => {
      const r5 = rawToBrowserCoords(10, 20, W, H, 5);
      const r7 = rawToBrowserCoords(10, 20, W, H, 7);
      expect(r5).not.toEqual(r7);
    });
  });

  describe('orientation 8 (90° CCW) — regression: must NOT equal orientation 6', () => {
    it('top-left (0,0) maps to top-right of rotated image → (0, W-1)', () => {
      // 90° CCW: new_x = rawY, new_y = W-1-rawX
      expect(rawToBrowserCoords(0, 0, W, H, 8)).toEqual({ x: 0, y: W - 1 });
    });
    it('regression (bug May 2026): orientation 8 must NOT produce the orientation-6 result (H-1, 0) for (0,0)', () => {
      // The bug swapped cases 6 and 8. With the bug, (0,0) under orientation 8
      // returned { x: H-1, y: 0 } (the CW formula) instead of { x: 0, y: W-1 }.
      expect(rawToBrowserCoords(0, 0, W, H, 8)).not.toEqual({ x: H - 1, y: 0 });
    });
    it('bottom-right (W-1, H-1) maps to bottom-left → (H-1, 0)', () => {
      expect(rawToBrowserCoords(W - 1, H - 1, W, H, 8)).toEqual({ x: H - 1, y: 0 });
    });
    it('produces DIFFERENT result from orientation 6 for same input', () => {
      const r6 = rawToBrowserCoords(0, 0, W, H, 6);
      const r8 = rawToBrowserCoords(0, 0, W, H, 8);
      expect(r6).not.toEqual(r8);
    });
  });

  describe('unknown orientation falls back to identity', () => {
    it('orientation 0 is identity', () => {
      expect(rawToBrowserCoords(50, 100, W, H, 0)).toEqual({ x: 50, y: 100 });
    });
    it('orientation 99 is identity', () => {
      expect(rawToBrowserCoords(50, 100, W, H, 99)).toEqual({ x: 50, y: 100 });
    });
  });
});
