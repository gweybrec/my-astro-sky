/**
 * Freehand sky-region drawing gesture, extracted from `sky-map.ts`.
 *
 * The user traces a closed region on the local sky; the captured polygon is stored in
 * **Alt/Az**, a time-invariant frame matching "what I can see from a fixed location".
 * That is why the gesture forces Local Sky (zenith) mode on for its duration and
 * restores the previous mode when it ends.
 *
 * `regionDrawActive` spans the whole gesture (enter → finish); `regionDrawing` is true
 * only while the mouse button is held, so a `move` before the first `press` is never
 * captured as a point.
 *
 * The Alt/Az conversion is injected (`toAltAz`) so the gesture carries no projection or
 * observer state of its own.
 */
import type { AltAzPoint } from './sky-map-types';

/** Minimum captured points for a region to be considered drawn rather than cancelled. */
export const REGION_MIN_POINTS = 3;

/**
 * Consecutive points closer than this (in degrees, on either axis) are dropped, so the
 * saved polygon stays lean instead of recording one point per mousemove.
 */
export const REGION_DEDUPE_DEG = 0.3;

export interface RegionDrawCallbacks {
  onComplete: (points: AltAzPoint[]) => void;
  onCancel: () => void;
}

export class RegionDrawGesture {
  private activeFlag = false;
  private drawing = false;
  private points: AltAzPoint[] = [];
  private callbacks: RegionDrawCallbacks | null = null;
  /** Local Sky mode as it was before the gesture, restored when it ends. */
  private prevLocalSkyMode = false;

  /** True for the whole gesture (enter → finish), not just while the button is held. */
  get active(): boolean {
    return this.activeFlag;
  }

  /** True only while the mouse button is held and points are being captured. */
  get capturing(): boolean {
    return this.drawing;
  }

  /** Points captured so far, in Alt/Az degrees. */
  get capturedPoints(): readonly AltAzPoint[] {
    return this.points;
  }

  /**
   * Begin a gesture. `prevLocalSkyMode` is the caller's current Local Sky state, handed
   * back by {@link finish} so the caller can restore it.
   */
  enter(callbacks: RegionDrawCallbacks, prevLocalSkyMode: boolean): void {
    this.prevLocalSkyMode = prevLocalSkyMode;
    this.activeFlag = true;
    this.drawing = false;
    this.points = [];
    this.callbacks = callbacks;
  }

  /** Mouse pressed: start capturing, discarding anything from a previous stroke. */
  press(): void {
    this.drawing = true;
    this.points = [];
  }

  /**
   * Capture a point if the button is held. `pt` is null when the caller cannot resolve
   * Alt/Az (no observer), in which case nothing is captured.
   */
  move(pt: AltAzPoint | null): void {
    if (!this.drawing || !pt) return;
    const last = this.points[this.points.length - 1];
    // Dedupe near-identical consecutive points so the saved polygon stays lean.
    if (
      last &&
      Math.abs(pt.azDeg - last.azDeg) < REGION_DEDUPE_DEG &&
      Math.abs(pt.altDeg - last.altDeg) < REGION_DEDUPE_DEG
    ) {
      return;
    }
    this.points.push(pt);
  }

  /**
   * End the gesture, firing `onComplete` with the polygon or `onCancel` (when cancelled,
   * or when too few points were captured to form a region).
   *
   * Returns whether the caller should restore Local Sky mode to *off* — i.e. the gesture
   * turned it on and the user did not have it on before.
   */
  finish(cancelled: boolean): { restoreLocalSkyOff: boolean } {
    const points = this.points;
    const cb = this.callbacks;
    const restoreLocalSkyOff = !this.prevLocalSkyMode;
    this.activeFlag = false;
    this.drawing = false;
    this.points = [];
    this.callbacks = null;
    if (cancelled || points.length < REGION_MIN_POINTS) cb?.onCancel();
    else cb?.onComplete(points);
    return { restoreLocalSkyOff };
  }
}
