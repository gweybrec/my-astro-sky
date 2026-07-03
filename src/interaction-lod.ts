/**
 * Adaptive level-of-detail (LOD) controller for the sky-map render loop, extracted
 * from `sky-map.ts` so the budget maths can be unit-tested without a canvas.
 *
 * Two independent philosophies live here (see the SkyMap render loop):
 *   • **Motion LOD** — while the user pans/zooms a *manual* density axis, the star/DSO
 *     budget is capped so each frame stays cheap, then filled back in after motion
 *     settles. The cap is not fixed: `interactionQuality` (0..1) is steered from
 *     measured frame time toward {@link INTERACTION_TARGET_MS}, so it self-calibrates
 *     to the machine.
 *   • **Auto DSO density** — sizes the DSO budget so *every* frame is smooth (nothing
 *     pops), nudging the budget multiplicatively toward {@link AUTO_TARGET_MS}.
 *
 * This class owns only the adaptive *state* and *decisions*. The owning SkyMap keeps
 * the concrete `maxStarCount`/`maxDSOCount` budgets, the settle timer, and the
 * render/callback side effects, passing budgets in and applying the returned values.
 */
import { DSO_DENSITY_MAX } from './density-slider';

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Result of an auto-density adaptation step. */
export interface AutoDensityResult {
  /** The DSO budget to use going forward (unchanged when `changed` is false). */
  next: number;
  /** True when the budget actually moved (caller should apply + re-render). */
  changed: boolean;
}

export class InteractionLod {
  /** Idle delay (ms) after the last interactive frame before the full-detail redraw. */
  static readonly SETTLE_MS = 180;
  static readonly INTERACTION_STAR_FLOOR = 300;
  static readonly INTERACTION_DSO_FLOOR = 100;
  /** Per-frame draw-time target (ms). ~10ms leaves headroom in a 16.7ms / 60fps frame. */
  static readonly INTERACTION_TARGET_MS = 10;
  /** Per-frame draw-time target for the DSO auto lever (favours a fuller map). */
  static readonly AUTO_TARGET_MS = 20;
  static readonly AUTO_DSO_MIN = 80;

  /** Learned motion-LOD quality (0..1); persists across gestures. */
  interactionQuality = 0.5;
  /** True while a pan/zoom/drag gesture is in progress. */
  interacting = false;
  /** One-shot burst so DSO-auto re-tunes immediately (at rest) when switched on. */
  dsoCalibrating = false;
  /** User toggle: false disables the motion LOD entirely (full detail while moving). */
  motionLOD = true;
  autoStarDensity = false;
  autoDSODensity = false;

  /** Mark the start of an interactive gesture. */
  beginInteraction(): void {
    this.interacting = true;
  }

  /** Mark the end of an interactive gesture (settle fired / animation cancelled). */
  endInteraction(): void {
    this.interacting = false;
  }

  /** Whether render() should time this frame to drive the adaptive budgets. */
  shouldMeasure(renderingOffscreen: boolean): boolean {
    return !renderingOffscreen && (this.interacting || this.dsoCalibrating);
  }

  /**
   * Effective star density budget. In auto mode it is the fixed pinned budget, rendered
   * the same whether moving or not (no pop). In manual mode the motion LOD applies — but
   * only when the DSO lever is NOT auto (when it is, the lever keeps frames smooth, so
   * stars need no throttling either).
   */
  effectiveStarBudget(maxStarCount: number): number {
    if (this.autoStarDensity) return maxStarCount;
    if (this.motionLOD && this.interacting && !this.autoDSODensity) {
      const floor = Math.min(InteractionLod.INTERACTION_STAR_FLOOR, maxStarCount);
      return Math.round(floor + (maxStarCount - floor) * this.interactionQuality);
    }
    return maxStarCount;
  }

  /**
   * Effective DSO density budget. When DSO-auto is on, maxDSOCount is the live performance
   * lever and is used as-is (no motion throttling → no pop). When manual, the motion LOD
   * interpolates floor→full during active interaction.
   */
  effectiveDSOBudget(maxDSOCount: number): number {
    if (this.motionLOD && !this.autoDSODensity && this.interacting) {
      const floor = Math.min(InteractionLod.INTERACTION_DSO_FLOOR, maxDSOCount);
      return Math.round(floor + (maxDSOCount - floor) * this.interactionQuality);
    }
    return maxDSOCount;
  }

  /**
   * Steer interactionQuality from a measured interactive frame draw time. Asymmetric with
   * a hysteresis band for stability: drop fast when over budget (keep motion smooth), creep
   * up slowly when there is clear headroom, and hold steady in between so it doesn't oscillate.
   */
  adaptInteractionQuality(frameMs: number): void {
    const target = InteractionLod.INTERACTION_TARGET_MS;
    if (frameMs > target * 1.25) {
      this.interactionQuality = Math.max(0, this.interactionQuality - 0.15);
    } else if (frameMs < target * 0.7) {
      this.interactionQuality = Math.min(1, this.interactionQuality + 0.05);
    }
  }

  /**
   * DSO performance lever: from a measured interactive frame time, nudge the DSO budget
   * multiplicatively toward AUTO_TARGET_MS. A hysteresis band keeps a converged budget
   * stable (factor 1 → no change); the burst (`dsoCalibrating`) ends once it converges or
   * hits a clamp bound. Returns the new budget and whether it changed — the caller applies
   * it (updates maxDSOCount, notifies the slider, re-renders).
   */
  adaptAutoDensity(frameMs: number, maxDSOCount: number): AutoDensityResult {
    if (!this.autoDSODensity) {
      this.dsoCalibrating = false;
      return { next: maxDSOCount, changed: false };
    }
    const target = InteractionLod.AUTO_TARGET_MS;
    const factor = frameMs > target * 1.3 ? 0.85 : frameMs < target * 0.6 ? 1.12 : 1;
    if (factor === 1) {
      this.dsoCalibrating = false;
      return { next: maxDSOCount, changed: false };
    } // converged
    const next = clamp(
      Math.round(maxDSOCount * factor),
      InteractionLod.AUTO_DSO_MIN,
      DSO_DENSITY_MAX,
    );
    if (next === maxDSOCount) {
      this.dsoCalibrating = false;
      return { next: maxDSOCount, changed: false };
    } // at a bound
    return { next, changed: true };
  }
}
