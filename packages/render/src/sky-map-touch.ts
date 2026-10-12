/**
 * Touch wiring for the sky map: one-finger drag, two-finger pinch (zoom and rotation about the
 * fingers, with pan), tap to select and long press. Attached next to the mouse
 * handlers of `sky-map-events.ts`, which it leaves untouched: it reacts to
 * `pointerType === 'touch'` only, and cancels the browser's follow-up mouse events
 * so a tap is never counted twice.
 *
 * A touch has no hover, so a tap asks the host to find what is under the finger
 * (`pickDSOAt`) instead of relying on a previous hover.
 *
 * Region drawing and frames take a finger first, as they take the mouse first: while one is
 * active, the other gestures (pan, pinch, tap, long press) are off so they cannot conflict.
 */
import type { Star, ViewState } from '@myastrosky/core/types';
import type { AltAzPoint } from '@myastrosky/core/sky-map-types';
import type { PhotoOutline } from '@myastrosky/core/photo-outline';
import { fromCanvas } from '@myastrosky/core/projection';
import { zoomAboutPoint } from '@myastrosky/core/sky-view-math';
import { normalizeRotationDeg } from '@myastrosky/core/display-settings';
import { findTopPhotoOutlineAtPoint } from '@myastrosky/core/photo-outline';
import type { EventBinding } from './sky-map-events';

/** A finger that moved no further than this since it landed is still a tap. */
export const TAP_SLOP_PX = 10;
/** A finger held still this long is a long press. */
export const LONG_PRESS_MS = 500;

/** Everything the touch handlers need from the sky map. */
export interface SkyTouchHost {
  readonly canvas: HTMLCanvasElement;
  /** Mutated in place by the drag and pinch handlers. */
  readonly view: ViewState;
  readonly interactionEnabled: boolean;
  readonly pickingMode: boolean;
  readonly photoOutlines: PhotoOutline[];

  // Region drawing and frames: the same members as the mouse handling.
  regionDrawActive(): boolean;
  regionDrawCapturing(): boolean;
  regionDrawPress(): void;
  regionDrawMove(pt: AltAzPoint | null): void;
  regionDrawFinish(cancelled: boolean): void;
  canvasToAltAz(mx: number, my: number): AltAzPoint | null;
  frameMouseDown(mx: number, my: number): boolean;
  frameDragActive(): boolean;
  frameDragMove(mx: number, my: number): void;
  frameMouseUp(): void;

  cancelAnimation(): void;
  dismissTooltip(): void;
  requestRenderInteractive(): void;
  viewChanged(): void;
  findClosestStar(mx: number, my: number): Star | null;

  /** The star under a finger (a finger is wider than a mouse pointer), when one is drawn there. */
  pickStarAt(mx: number, my: number): Star | null;
  /** Finds the deep-sky object under the point and makes it the one `emitDSOClick` reports. */
  pickDSOAt(mx: number, my: number): boolean;
  hasStarPickedHandler(): boolean;
  hasPhotoClickHandler(): boolean;
  emitStarPicked(star: Star): void;
  emitPhotoClick(photoName: string): void;
  emitDSOClick(): void;
  emitStarTap(star: Star): void;
  emitClearSelection(): void;
  /** Reports a long press at the canvas point, with the object under it when there is one. */
  emitLongPress(mx: number, my: number): void;
}

interface Finger {
  x: number;
  y: number;
}

export function attachSkyMapTouch(host: SkyTouchHost): EventBinding[] {
  const bindings: EventBinding[] = [];
  const add = (event: string, handler: EventListener) => {
    host.canvas.addEventListener(event, handler);
    bindings.push({ target: host.canvas, event, handler });
  };

  // The browser must not scroll or zoom the page under the map.
  host.canvas.style.touchAction = 'none';

  const fingers = new Map<number, Finger>();
  let startX = 0;
  let startY = 0;
  /** The gesture left "could still be a tap": moved, pinched or long-pressed. */
  let notATap = false;
  let anchorX = 0;
  let anchorY = 0;
  let prevDist = 0;
  let prevAngle = 0;
  /** What the first finger is doing: the map, a region being drawn or a frame being dragged. */
  let mode: 'view' | 'region' | 'frame' = 'view';
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  const local = (x: number, y: number) => {
    const rect = host.canvas.getBoundingClientRect();
    return { mx: x - rect.left, my: y - rect.top };
  };
  const clearTimer = () => {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  const midpoint = () => {
    const [a, b] = [...fingers.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };
  /** Pins the sky point under the given client position to the finger. */
  const anchorAt = (x: number, y: number) => {
    const { mx, my } = local(x, y);
    const p = fromCanvas(mx, my, host.view);
    anchorX = p.x;
    anchorY = p.y;
  };
  const dragTo = (x: number, y: number) => {
    const { mx, my } = local(x, y);
    const now = fromCanvas(mx, my, host.view);
    host.view.centerX += anchorX - now.x;
    host.view.centerY += anchorY - now.y;
  };

  add('pointerdown', ((e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    host.cancelAnimation();
    host.dismissTooltip();
    host.canvas.setPointerCapture?.(e.pointerId);
    // A region or frame gesture owns the touch: a second finger does nothing.
    if (mode !== 'view') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (fingers.size === 1) {
      const { mx, my } = local(e.clientX, e.clientY);
      if (host.regionDrawActive()) {
        mode = 'region';
        host.regionDrawPress();
        host.regionDrawMove(host.canvasToAltAz(mx, my));
        host.requestRenderInteractive();
        return;
      }
      if (host.frameMouseDown(mx, my)) {
        mode = 'frame';
        return;
      }
      startX = e.clientX;
      startY = e.clientY;
      notATap = false;
      anchorAt(e.clientX, e.clientY);
      clearTimer();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (fingers.size !== 1 || notATap) return;
        notATap = true;
        const { mx, my } = local(startX, startY);
        host.emitLongPress(mx, my);
      }, LONG_PRESS_MS);
    } else if (fingers.size === 2) {
      notATap = true;
      clearTimer();
      const m = midpoint();
      prevDist = m.dist;
      prevAngle = m.angle;
      anchorAt(m.x, m.y);
    }
  }) as EventListener);

  add('pointermove', ((e: PointerEvent) => {
    if (mode !== 'view') {
      if (!fingers.has(e.pointerId)) return;
      const { mx, my } = local(e.clientX, e.clientY);
      if (mode === 'region') {
        if (host.regionDrawCapturing()) {
          host.regionDrawMove(host.canvasToAltAz(mx, my));
          host.requestRenderInteractive();
        }
      } else if (host.frameDragActive()) {
        host.frameDragMove(mx, my);
      }
      return;
    }
    const finger = fingers.get(e.pointerId);
    if (!finger) return;
    finger.x = e.clientX;
    finger.y = e.clientY;

    if (fingers.size === 1) {
      if (!notATap && Math.hypot(e.clientX - startX, e.clientY - startY) <= TAP_SLOP_PX) return;
      notATap = true;
      clearTimer();
      dragTo(e.clientX, e.clientY);
    } else if (fingers.size === 2) {
      const m = midpoint();
      const { mx, my } = local(m.x, m.y);
      if (prevDist > 0 && m.dist > 0) {
        const z = zoomAboutPoint(host.view, mx, my, m.dist / prevDist, 50, 1000000);
        host.view.scale = z.scale;
        host.view.centerX = z.centerX;
        host.view.centerY = z.centerY;
      }
      prevDist = m.dist;
      // Turning the fingers turns the sky with them (the view's rotation is counter-clockwise-positive on screen).
      let turn = m.angle - prevAngle;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      prevAngle = m.angle;
      host.view.rotationDeg = normalizeRotationDeg(host.view.rotationDeg - (turn * 180) / Math.PI);
      // Zooming and turning pin the sky point under the midpoint; dragging the midpoint pans.
      dragTo(m.x, m.y);
    } else {
      return;
    }
    host.viewChanged();
    host.requestRenderInteractive();
  }) as EventListener);

  const lift = (e: PointerEvent, cancelled: boolean) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    clearTimer();

    if (mode !== 'view') {
      if (fingers.size > 0) return;
      const finished = mode;
      mode = 'view';
      if (finished === 'region') host.regionDrawFinish(cancelled || !host.regionDrawCapturing());
      else if (host.frameDragActive()) host.frameMouseUp();
      return;
    }

    if (fingers.size === 1) {
      // One finger of a pinch is still down: carry on dragging from where it is.
      const [rest] = [...fingers.values()];
      anchorAt(rest.x, rest.y);
      return;
    }
    if (fingers.size > 0) {
      const m = midpoint();
      prevDist = m.dist;
      prevAngle = m.angle;
      anchorAt(m.x, m.y);
      return;
    }
    if (cancelled || notATap) return;

    const { mx, my } = local(e.clientX, e.clientY);
    if (host.pickingMode) {
      if (host.hasStarPickedHandler()) {
        const star = host.findClosestStar(mx, my);
        if (star) host.emitStarPicked(star);
      }
      return;
    }
    // What is tapped, most specific first: a deep-sky object, a star, a photo; a tap on nothing clears the selection.
    // (A touch has no hover: a tap on a star is how its information is asked for.)
    if (host.interactionEnabled && host.pickDSOAt(mx, my)) {
      host.emitDSOClick();
    } else {
      const star = host.interactionEnabled ? host.pickStarAt(mx, my) : null;
      const photoName = host.hasPhotoClickHandler()
        ? findTopPhotoOutlineAtPoint(mx, my, host.photoOutlines)
        : null;
      if (star) host.emitStarTap(star);
      else if (photoName) host.emitPhotoClick(photoName);
      else host.emitClearSelection();
    }
    host.dismissTooltip();
  };
  add('pointerup', ((e: PointerEvent) => lift(e, false)) as EventListener);
  add('pointercancel', ((e: PointerEvent) => lift(e, true)) as EventListener);

  return bindings;
}
