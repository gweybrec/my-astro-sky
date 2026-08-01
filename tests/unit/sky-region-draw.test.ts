import { describe, expect, it, vi } from 'vitest';

import { RegionDrawGesture, REGION_DEDUPE_DEG, REGION_MIN_POINTS } from '../../src/sky-region-draw';
import type { AltAzPoint } from '../../src/sky-map-types';

/**
 * The freehand sky-region gesture. Points are captured in Alt/Az (time-invariant, so a
 * saved region means "this patch of my local sky" regardless of when it is reopened),
 * which is why the gesture forces Local Sky mode on and restores the previous mode when
 * it ends.
 */

function setup(prevLocalSky = false) {
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const g = new RegionDrawGesture();
  g.enter({ onComplete, onCancel }, prevLocalSky);
  return { g, onComplete, onCancel };
}

const pt = (azDeg: number, altDeg: number): AltAzPoint => ({ azDeg, altDeg });

/** Points far enough apart to survive the dedupe. */
function drawSquare(g: RegionDrawGesture): void {
  g.press();
  g.move(pt(0, 10));
  g.move(pt(10, 10));
  g.move(pt(10, 20));
  g.move(pt(0, 20));
}

describe('RegionDrawGesture', () => {
  describe('lifecycle', () => {
    it('is inactive before enter()', () => {
      const g = new RegionDrawGesture();
      expect(g.active).toBe(false);
      expect(g.capturing).toBe(false);
    });

    it('is active but not capturing after enter()', () => {
      const { g } = setup();
      expect(g.active).toBe(true);
      expect(g.capturing).toBe(false);
    });

    it('captures only once the button is pressed', () => {
      const { g } = setup();
      g.move(pt(0, 10)); // stray move before any press
      expect(g.capturedPoints).toHaveLength(0);
      g.press();
      g.move(pt(0, 10));
      expect(g.capturedPoints).toHaveLength(1);
    });

    it('discards a previous stroke when a new press starts', () => {
      const { g } = setup();
      drawSquare(g);
      expect(g.capturedPoints.length).toBeGreaterThan(0);
      g.press();
      expect(g.capturedPoints).toHaveLength(0);
    });

    it('goes inactive after finish()', () => {
      const { g } = setup();
      drawSquare(g);
      g.finish(false);
      expect(g.active).toBe(false);
      expect(g.capturing).toBe(false);
      expect(g.capturedPoints).toHaveLength(0);
    });

    it('ignores moves after finish()', () => {
      const { g } = setup();
      drawSquare(g);
      g.finish(false);
      g.move(pt(50, 50));
      expect(g.capturedPoints).toHaveLength(0);
    });
  });

  describe('point capture', () => {
    it('drops a consecutive point inside the dedupe threshold on both axes', () => {
      const { g } = setup();
      g.press();
      g.move(pt(0, 10));
      g.move(pt(REGION_DEDUPE_DEG / 2, 10 + REGION_DEDUPE_DEG / 2));
      expect(g.capturedPoints).toHaveLength(1);
    });

    it('keeps a point that clears the threshold on either axis alone', () => {
      const { g } = setup();
      g.press();
      g.move(pt(0, 10));
      g.move(pt(REGION_DEDUPE_DEG * 2, 10)); // azimuth moved enough
      g.move(pt(REGION_DEDUPE_DEG * 2, 10 + REGION_DEDUPE_DEG * 2)); // altitude moved enough
      expect(g.capturedPoints).toHaveLength(3);
    });

    it('compares against the last kept point, not the last seen one', () => {
      const { g } = setup();
      g.press();
      g.move(pt(0, 10));
      // Half-threshold steps: each is too small on its own, but they accumulate.
      // Comparing against the last *kept* point keeps every other one (the dedupe is
      // a strict `<`, so an exactly-threshold gap is kept); comparing against the last
      // *seen* point would drop them all and leave only the first.
      for (let i = 1; i <= 4; i++) g.move(pt(i * (REGION_DEDUPE_DEG / 2), 10));
      expect(g.capturedPoints.map((p) => p.azDeg)).toEqual([0, 0.3, 0.6]);
    });

    it('ignores a null point (no observer location resolved)', () => {
      const { g } = setup();
      g.press();
      g.move(null);
      expect(g.capturedPoints).toHaveLength(0);
    });
  });

  describe('completion', () => {
    it('completes with the captured polygon', () => {
      const { g, onComplete, onCancel } = setup();
      drawSquare(g);
      g.finish(false);
      expect(onCancel).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0]).toHaveLength(4);
    });

    it('cancels when explicitly cancelled, even with enough points', () => {
      const { g, onComplete, onCancel } = setup();
      drawSquare(g);
      g.finish(true);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it(`cancels when fewer than ${REGION_MIN_POINTS} points were captured`, () => {
      const { g, onComplete, onCancel } = setup();
      g.press();
      g.move(pt(0, 10));
      g.move(pt(10, 10));
      g.finish(false);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancels when the button was never pressed', () => {
      const { g, onComplete, onCancel } = setup();
      g.finish(false);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('fires its callback exactly once even if finish() is called twice', () => {
      const { g, onComplete, onCancel } = setup();
      drawSquare(g);
      g.finish(false);
      g.finish(false);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('Local Sky mode restore', () => {
    it('asks the caller to turn Local Sky back off when it was off before', () => {
      const { g } = setup(false);
      drawSquare(g);
      expect(g.finish(false).restoreLocalSkyOff).toBe(true);
    });

    it('leaves Local Sky on when the user already had it on', () => {
      const { g } = setup(true);
      drawSquare(g);
      expect(g.finish(false).restoreLocalSkyOff).toBe(false);
    });

    it('restores the same way on a cancel', () => {
      expect(setup(false).g.finish(true).restoreLocalSkyOff).toBe(true);
      expect(setup(true).g.finish(true).restoreLocalSkyOff).toBe(false);
    });
  });
});
