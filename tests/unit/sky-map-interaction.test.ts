import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/star-catalog', () => ({
  getStars: () => [],
  getConstellationLines: () => [],
  getConstellationInfos: () => [],
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => [],
  getDSOCatalog: () => null,
}));

import { SkyMap } from '../../src/sky-map';

/**
 * Interaction LOD: while panning/zooming the renderer caps the star/DSO density budget
 * so motion stays smooth, then fills in the rest after a settle delay. The cap is not a
 * fixed number — `interactionQuality` (0..1) adapts to the machine from measured frame
 * time. These tests drive the controller and the budget interpolation directly.
 */
describe('SkyMap interaction LOD', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let skyMap: SkyMap | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D));
    vi.spyOn(SkyMap.prototype, 'render').mockImplementation(() => {});
  });

  afterEach(() => {
    skyMap?.destroy();
    skyMap = null;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  function makeMap(): SkyMap {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const map = new SkyMap(canvas);
    skyMap = map;
    return map;
  }

  // Reach the private members under test without widening the public API.
  type Internals = {
    interactionQuality: number;
    interacting: boolean;
    maxStarCount: number;
    maxDSOCount: number;
    autoStarDensity: boolean;
    autoDSODensity: boolean;
    motionLOD: boolean;
    dsoCalibrating: boolean;
    onAutoDensityChange: ((dso: number) => void) | null;
    adaptInteractionQuality(frameMs: number): void;
    adaptAutoDensity(frameMs: number): void;
    setAutoDSODensity(v: boolean): void;
    effectiveStarBudget(): number;
    effectiveDSOBudget(): number;
  };
  const peek = (m: SkyMap) => m as unknown as Internals;

  describe('adaptInteractionQuality', () => {
    it('ramps quality up to 1 on a run of fast (under-target) frames', () => {
      const m = peek(makeMap());
      m.interactionQuality = 0;
      for (let i = 0; i < 30; i++) m.adaptInteractionQuality(2); // well under the 10ms target
      expect(m.interactionQuality).toBe(1);
    });

    it('drops quality to 0 on a run of slow (over-target) frames', () => {
      const m = peek(makeMap());
      m.interactionQuality = 1;
      for (let i = 0; i < 30; i++) m.adaptInteractionQuality(25); // well over budget
      expect(m.interactionQuality).toBe(0);
    });

    it('holds steady inside the hysteresis band (frames near target)', () => {
      const m = peek(makeMap());
      m.interactionQuality = 0.6;
      for (let i = 0; i < 30; i++) m.adaptInteractionQuality(10); // exactly the target
      expect(m.interactionQuality).toBe(0.6);
    });

    it('backs off faster than it ramps up (asymmetric rates)', () => {
      const m = peek(makeMap());
      m.interactionQuality = 0.5;
      m.adaptInteractionQuality(2);   // fast → +0.05
      expect(m.interactionQuality).toBeCloseTo(0.55, 5);
      m.adaptInteractionQuality(25);  // slow → -0.15
      expect(m.interactionQuality).toBeCloseTo(0.40, 5);
    });
  });

  describe('effective budgets', () => {
    it('returns the full user budget when not interacting', () => {
      const m = peek(makeMap());
      m.maxStarCount = 5000;
      m.maxDSOCount = 4000;
      m.interacting = false;
      expect(m.effectiveStarBudget()).toBe(5000);
      expect(m.effectiveDSOBudget()).toBe(4000);
    });

    it('interpolates floor→full by quality while interacting', () => {
      const m = peek(makeMap());
      m.maxStarCount = 5000; // star floor = 300
      m.interacting = true;

      m.interactionQuality = 0;
      expect(m.effectiveStarBudget()).toBe(300); // floor on a slow machine

      m.interactionQuality = 1;
      expect(m.effectiveStarBudget()).toBe(5000); // full on a fast machine

      m.interactionQuality = 0.5;
      expect(m.effectiveStarBudget()).toBe(Math.round(300 + (5000 - 300) * 0.5));
    });

    it('never throttles above the user budget when it is below the floor', () => {
      const m = peek(makeMap());
      m.maxDSOCount = 80; // below the DSO floor of 100
      m.interacting = true;
      m.interactionQuality = 0; // floor = min(100, 80) = 80
      expect(m.effectiveDSOBudget()).toBe(80);
      m.interactionQuality = 1;
      expect(m.effectiveDSOBudget()).toBe(80);
    });

    // The whole point of auto mode: the SAME budget renders while moving and at rest, so
    // nothing pops in/out. The motion LOD must NOT apply to an auto axis.
    it('auto star budget is fixed and not throttled during motion (no pop-in)', () => {
      const m = peek(makeMap());
      m.autoStarDensity = true;
      m.maxStarCount = 250;
      m.interacting = true;
      m.interactionQuality = 0; // would floor a manual budget
      expect(m.effectiveStarBudget()).toBe(250);
    });

    it('auto DSO budget is used as-is during motion (no pop-in)', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxDSOCount = 1200;
      m.interacting = true;
      m.interactionQuality = 0;
      expect(m.effectiveDSOBudget()).toBe(1200);
    });

    it('disables star motion LOD while the DSO lever is active', () => {
      // DSO-auto absorbs the cost, so manual stars need no throttling either.
      const m = peek(makeMap());
      m.autoStarDensity = false;
      m.autoDSODensity = true;
      m.maxStarCount = 5000;
      m.interacting = true;
      m.interactionQuality = 0;
      expect(m.effectiveStarBudget()).toBe(5000);
    });

    // User toggle: turning motionLOD off keeps full detail while moving (no flicker).
    it('keeps full detail during motion when motionLOD is disabled', () => {
      const m = peek(makeMap());
      m.motionLOD = false;
      m.autoStarDensity = false;
      m.autoDSODensity = false;
      m.maxStarCount = 5000;
      m.maxDSOCount = 4000;
      m.interacting = true;
      m.interactionQuality = 0; // would otherwise floor both budgets
      expect(m.effectiveStarBudget()).toBe(5000);
      expect(m.effectiveDSOBudget()).toBe(4000);
    });

    it('applies motion LOD when enabled (default) in manual mode', () => {
      const m = peek(makeMap());
      m.motionLOD = true;
      m.autoStarDensity = false;
      m.autoDSODensity = false;
      m.maxStarCount = 5000;
      m.interacting = true;
      m.interactionQuality = 0; // floor = INTERACTION_STAR_FLOOR (300)
      expect(m.effectiveStarBudget()).toBe(300);
    });
  });

  describe('adaptAutoDensity (DSO performance lever)', () => {
    it('reduces the DSO budget on a slow (over-target) frame', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxDSOCount = 1000;
      m.adaptAutoDensity(40); // well over the ~11ms target
      expect(m.maxDSOCount).toBeLessThan(1000);
    });

    it('raises the DSO budget on a fast (under-target) frame', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxDSOCount = 1000;
      m.adaptAutoDensity(3); // well under target
      expect(m.maxDSOCount).toBeGreaterThan(1000);
    });

    it('holds the DSO budget steady inside the hysteresis band', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxDSOCount = 1000;
      m.adaptAutoDensity(20); // at target (AUTO_TARGET_MS)
      expect(m.maxDSOCount).toBe(1000);
    });

    it('never touches the star budget (stars are fixed in auto mode)', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxStarCount = 250;
      m.maxDSOCount = 1000;
      m.adaptAutoDensity(40);
      expect(m.maxStarCount).toBe(250);
    });

    it('is a no-op when DSO-auto is disabled', () => {
      const m = peek(makeMap());
      m.autoDSODensity = false;
      m.maxDSOCount = 1000;
      let called = false;
      m.onAutoDensityChange = () => { called = true; };
      m.adaptAutoDensity(40);
      expect(m.maxDSOCount).toBe(1000);
      expect(called).toBe(false);
    });

    it('notifies onAutoDensityChange with the new DSO budget when it changes', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.maxDSOCount = 1000;
      const calls: number[] = [];
      m.onAutoDensityChange = (dso) => calls.push(dso);
      m.adaptAutoDensity(40);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(m.maxDSOCount);
    });

    it('arms a one-shot calibration burst when DSO-auto is switched on', () => {
      const m = peek(makeMap());
      m.setAutoDSODensity(true);
      expect(m.dsoCalibrating).toBe(true);
    });

    it('ends the calibration burst once the budget converges (in-band frame)', () => {
      const m = peek(makeMap());
      m.autoDSODensity = true;
      m.dsoCalibrating = true;
      m.adaptAutoDensity(16); // at target → in band → converged
      expect(m.dsoCalibrating).toBe(false);
    });
  });
});
