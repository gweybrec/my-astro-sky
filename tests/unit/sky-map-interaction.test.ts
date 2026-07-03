import { describe, expect, it } from 'vitest';
import { InteractionLod } from '../../src/interaction-lod';
import { DSO_DENSITY_MAX } from '../../src/density-slider';

/**
 * Interaction LOD: while panning/zooming the renderer caps the star/DSO density budget
 * so motion stays smooth, then fills in the rest after a settle delay. The cap is not a
 * fixed number — `interactionQuality` (0..1) adapts to the machine from measured frame
 * time. These drive the controller and the budget interpolation directly — no canvas,
 * no render stub, no private-field pokes (the logic now lives in its own module).
 */
describe('InteractionLod', () => {
  describe('adaptInteractionQuality', () => {
    it('ramps quality up to 1 on a run of fast (under-target) frames', () => {
      const lod = new InteractionLod();
      lod.interactionQuality = 0;
      for (let i = 0; i < 30; i++) lod.adaptInteractionQuality(2); // well under the 10ms target
      expect(lod.interactionQuality).toBe(1);
    });

    it('drops quality to 0 on a run of slow (over-target) frames', () => {
      const lod = new InteractionLod();
      lod.interactionQuality = 1;
      for (let i = 0; i < 30; i++) lod.adaptInteractionQuality(25); // well over budget
      expect(lod.interactionQuality).toBe(0);
    });

    it('holds steady inside the hysteresis band (frames near target)', () => {
      const lod = new InteractionLod();
      lod.interactionQuality = 0.6;
      for (let i = 0; i < 30; i++) lod.adaptInteractionQuality(10); // exactly the target
      expect(lod.interactionQuality).toBe(0.6);
    });

    it('backs off faster than it ramps up (asymmetric rates)', () => {
      const lod = new InteractionLod();
      lod.interactionQuality = 0.5;
      lod.adaptInteractionQuality(2); // fast → +0.05
      expect(lod.interactionQuality).toBeCloseTo(0.55, 5);
      lod.adaptInteractionQuality(25); // slow → -0.15
      expect(lod.interactionQuality).toBeCloseTo(0.4, 5);
    });
  });

  describe('effective budgets', () => {
    it('returns the full user budget when not interacting', () => {
      const lod = new InteractionLod();
      lod.interacting = false;
      expect(lod.effectiveStarBudget(5000)).toBe(5000);
      expect(lod.effectiveDSOBudget(4000)).toBe(4000);
    });

    it('interpolates floor→full by quality while interacting', () => {
      const lod = new InteractionLod();
      lod.interacting = true; // star floor = 300

      lod.interactionQuality = 0;
      expect(lod.effectiveStarBudget(5000)).toBe(300); // floor on a slow machine

      lod.interactionQuality = 1;
      expect(lod.effectiveStarBudget(5000)).toBe(5000); // full on a fast machine

      lod.interactionQuality = 0.5;
      expect(lod.effectiveStarBudget(5000)).toBe(Math.round(300 + (5000 - 300) * 0.5));
    });

    it('never throttles above the user budget when it is below the floor', () => {
      const lod = new InteractionLod();
      lod.interacting = true;
      lod.interactionQuality = 0; // floor = min(100, 80) = 80
      expect(lod.effectiveDSOBudget(80)).toBe(80);
      lod.interactionQuality = 1;
      expect(lod.effectiveDSOBudget(80)).toBe(80);
    });

    // The whole point of auto mode: the SAME budget renders while moving and at rest, so
    // nothing pops in/out. The motion LOD must NOT apply to an auto axis.
    it('auto star budget is fixed and not throttled during motion (no pop-in)', () => {
      const lod = new InteractionLod();
      lod.autoStarDensity = true;
      lod.interacting = true;
      lod.interactionQuality = 0; // would floor a manual budget
      expect(lod.effectiveStarBudget(250)).toBe(250);
    });

    it('auto DSO budget is used as-is during motion (no pop-in)', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      lod.interacting = true;
      lod.interactionQuality = 0;
      expect(lod.effectiveDSOBudget(1200)).toBe(1200);
    });

    it('disables star motion LOD while the DSO lever is active', () => {
      // DSO-auto absorbs the cost, so manual stars need no throttling either.
      const lod = new InteractionLod();
      lod.autoStarDensity = false;
      lod.autoDSODensity = true;
      lod.interacting = true;
      lod.interactionQuality = 0;
      expect(lod.effectiveStarBudget(5000)).toBe(5000);
    });

    // User toggle: turning motionLOD off keeps full detail while moving (no flicker).
    it('keeps full detail during motion when motionLOD is disabled', () => {
      const lod = new InteractionLod();
      lod.motionLOD = false;
      lod.autoStarDensity = false;
      lod.autoDSODensity = false;
      lod.interacting = true;
      lod.interactionQuality = 0; // would otherwise floor both budgets
      expect(lod.effectiveStarBudget(5000)).toBe(5000);
      expect(lod.effectiveDSOBudget(4000)).toBe(4000);
    });

    it('applies motion LOD when enabled (default) in manual mode', () => {
      const lod = new InteractionLod();
      lod.motionLOD = true;
      lod.autoStarDensity = false;
      lod.autoDSODensity = false;
      lod.interacting = true;
      lod.interactionQuality = 0; // floor = INTERACTION_STAR_FLOOR (300)
      expect(lod.effectiveStarBudget(5000)).toBe(300);
    });
  });

  describe('adaptAutoDensity (DSO performance lever)', () => {
    it('reduces the DSO budget on a slow (over-target) frame', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      const r = lod.adaptAutoDensity(40, 1000); // well over the target
      expect(r.changed).toBe(true);
      expect(r.next).toBeLessThan(1000);
    });

    it('raises the DSO budget on a fast (under-target) frame', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      const r = lod.adaptAutoDensity(3, 1000); // well under target
      expect(r.changed).toBe(true);
      expect(r.next).toBeGreaterThan(1000);
    });

    it('holds the DSO budget steady inside the hysteresis band', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      const r = lod.adaptAutoDensity(20, 1000); // at target (AUTO_TARGET_MS)
      expect(r).toEqual({ next: 1000, changed: false });
    });

    it('is a no-op when DSO-auto is disabled', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = false;
      const r = lod.adaptAutoDensity(40, 1000);
      expect(r).toEqual({ next: 1000, changed: false });
    });

    it('clamps the budget to AUTO_DSO_MIN and reports no change at the floor', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      const r = lod.adaptAutoDensity(40, InteractionLod.AUTO_DSO_MIN); // already at floor, wants lower
      expect(r).toEqual({ next: InteractionLod.AUTO_DSO_MIN, changed: false });
    });

    it('clamps the budget to DSO_DENSITY_MAX and reports no change at the ceiling', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      const r = lod.adaptAutoDensity(3, DSO_DENSITY_MAX); // already at ceiling, wants higher
      expect(r).toEqual({ next: DSO_DENSITY_MAX, changed: false });
    });

    it('ends the calibration burst once the budget converges (in-band frame)', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      lod.dsoCalibrating = true;
      lod.adaptAutoDensity(20, 1000); // at target → in band → converged
      expect(lod.dsoCalibrating).toBe(false);
    });

    it('keeps calibrating while the budget is still moving', () => {
      const lod = new InteractionLod();
      lod.autoDSODensity = true;
      lod.dsoCalibrating = true;
      const r = lod.adaptAutoDensity(40, 1000); // still adjusting
      expect(r.changed).toBe(true);
      expect(lod.dsoCalibrating).toBe(true);
    });
  });

  describe('interaction lifecycle', () => {
    it('begin/end toggle the interacting flag', () => {
      const lod = new InteractionLod();
      expect(lod.interacting).toBe(false);
      lod.beginInteraction();
      expect(lod.interacting).toBe(true);
      lod.endInteraction();
      expect(lod.interacting).toBe(false);
    });

    it('shouldMeasure is true only when interacting or calibrating and not offscreen', () => {
      const lod = new InteractionLod();
      expect(lod.shouldMeasure(false)).toBe(false);
      lod.interacting = true;
      expect(lod.shouldMeasure(false)).toBe(true);
      expect(lod.shouldMeasure(true)).toBe(false); // offscreen render never measures
      lod.interacting = false;
      lod.dsoCalibrating = true;
      expect(lod.shouldMeasure(false)).toBe(true);
    });
  });
});
