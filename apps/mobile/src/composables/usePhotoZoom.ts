import { computed, onBeforeUnmount, ref, type Ref } from 'vue';

/** A photo's zoom in its viewer: `scale` 1 shows it whole, `tx`/`ty` move it from the centre (CSS px). */
export interface PhotoZoom {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The furthest zoom, as in the desktop's photo viewer. */
export const MAX_ZOOM = 16;
/** What a double tap on a whole photo zooms to. */
export const DOUBLE_TAP_ZOOM = 3;
const DOUBLE_TAP_MS = 300;
/** How far a finger may move (px) and still be a tap. */
const TAP_SLOP = 12;

export const WHOLE: PhotoZoom = { scale: 1, tx: 0, ty: 0 };

/** The size the whole photo takes in the viewer (it is fitted inside, never cropped). */
export function fittedSize(photo: Size, viewer: Size): Size {
  if (photo.width <= 0 || photo.height <= 0) return { width: 0, height: 0 };
  const fit = Math.min(viewer.width / photo.width, viewer.height / photo.height);
  return { width: photo.width * fit, height: photo.height * fit };
}

/** Keeps the photo over the viewer: it moves only as far as it is larger than the viewer. */
export function clampZoom(zoom: PhotoZoom, fitted: Size, viewer: Size): PhotoZoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
  const maxX = Math.max(0, (fitted.width * scale - viewer.width) / 2);
  const maxY = Math.max(0, (fitted.height * scale - viewer.height) / 2);
  return {
    scale,
    // "+ 0": a photo that cannot move is at 0, never at -0.
    tx: Math.min(maxX, Math.max(-maxX, zoom.tx)) + 0,
    ty: Math.min(maxY, Math.max(-maxY, zoom.ty)) + 0,
  };
}

/** Zooms by `factor` keeping the point under the fingers in place (`x`, `y` from the viewer's centre). */
export function zoomToward(zoom: PhotoZoom, point: { x: number; y: number }, factor: number) {
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale * factor));
  const ratio = scale / zoom.scale;
  return {
    scale,
    tx: point.x - (point.x - zoom.tx) * ratio,
    ty: point.y - (point.y - zoom.ty) * ratio,
  };
}

/**
 * Zoom of the photo viewer (boards "Photo, détail" and "Photo, zoom"): two fingers zoom around their middle, one finger
 * moves a zoomed photo, a double tap zooms in on the spot and, on a zoomed photo, shows it whole again.
 * With `onTap` (board "Identifier les étoiles"), a tap is given to it at once instead, and a double tap does not zoom.
 */
export function usePhotoZoom(
  viewer: Ref<HTMLElement | null>,
  photo: () => Size,
  options: { onTap?: (x: number, y: number) => void } = {},
) {
  const zoom = ref<PhotoZoom>(WHOLE);
  const zoomed = computed(() => zoom.value.scale > 1);
  const transform = computed(
    () => `translate(${zoom.value.tx}px, ${zoom.value.ty}px) scale(${zoom.value.scale})`,
  );

  const fingers = new Map<number, { x: number; y: number }>();
  let moved = false;
  let lastTap: { at: number; x: number; y: number } | null = null;

  function box() {
    const rect = viewer.value?.getBoundingClientRect();
    return rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : { left: 0, top: 0, width: 0, height: 0 };
  }
  function apply(next: PhotoZoom) {
    const size = box();
    zoom.value = clampZoom(next, fittedSize(photo(), size), size);
  }
  const fromCentre = (x: number, y: number) => {
    const b = box();
    return { x: x - b.left - b.width / 2, y: y - b.top - b.height / 2 };
  };
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  function onPointerDown(event: PointerEvent) {
    if (fingers.size === 0) moved = false;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const before = fingers.get(event.pointerId);
    if (!before) return;
    if (fingers.size === 1) {
      const dx = event.clientX - before.x;
      const dy = event.clientY - before.y;
      if (!moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      moved = true;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (zoomed.value) apply({ ...zoom.value, tx: zoom.value.tx + dx, ty: zoom.value.ty + dy });
      return;
    }
    if (fingers.size !== 2) return;
    moved = true;
    const was = spread();
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = spread();
    if (was.distance <= 0) return;
    // The photo follows the middle of the two fingers, then zooms around it.
    const slid = {
      ...zoom.value,
      tx: zoom.value.tx + now.x - was.x,
      ty: zoom.value.ty + now.y - was.y,
    };
    apply(zoomToward(slid, fromCentre(now.x, now.y), now.distance / was.distance));
  }

  function onPointerUp(event: PointerEvent) {
    if (!fingers.delete(event.pointerId)) return;
    if (fingers.size > 0 || moved) {
      lastTap = null;
      return;
    }
    if (options.onTap) {
      options.onTap(event.clientX, event.clientY);
      return;
    }
    const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    const double =
      lastTap !== null &&
      tap.at - lastTap.at < DOUBLE_TAP_MS &&
      Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < TAP_SLOP * 2;
    lastTap = double ? null : tap;
    if (!double) return;
    if (zoomed.value) reset();
    else apply(zoomToward(zoom.value, fromCentre(tap.x, tap.y), DOUBLE_TAP_ZOOM));
  }

  function onPointerCancel(event: PointerEvent) {
    fingers.delete(event.pointerId);
    lastTap = null;
  }

  function reset() {
    zoom.value = WHOLE;
  }

  // Turning the phone changes the viewer's size: the photo stays over it.
  const onResize = () => apply(zoom.value);
  window.addEventListener('resize', onResize);
  onBeforeUnmount(() => window.removeEventListener('resize', onResize));

  return {
    zoom,
    zoomed,
    transform,
    reset,
    handlers: {
      // The viewer handles its touches itself. Left to the browser, a finger lifted while moving starts a fling, and
      // the browser then swallows the next tap: the button that shows the photo whole did nothing after a drag.
      touchstart: (event: TouchEvent) => event.preventDefault(),
      pointerdown: onPointerDown,
      pointermove: onPointerMove,
      pointerup: onPointerUp,
      pointercancel: onPointerCancel,
    },
  };
}
