import { ref } from 'vue';

/** How far a finger must travel up or down from a sheet's handle or header to move it. */
export const DRAG_CLOSE_PX = 48;
/** How far the pointer moves before the drag holds it: a tap stays a click on the handle button. */
const DRAG_START_PX = 4;

/**
 * Dragging a panel drawn in the page by its handle (the hand placement's panel; the sheets are Ionic's modals, which
 * Ionic's gesture drags): `down` for a drag down (fold it, or take it back to a third), `up` for a drag up (open it, or
 * take it to two thirds). The three pointer handlers are `handlers`;
 * `wasDragged()` tells the click that ends a drag on the handle, which must not act as a tap, and forgets it.
 */
export function useSheetDrag(down: () => void, up?: () => void) {
  let from: number | null = null;
  let dragged = false;
  return {
    handlers: {
      pointerdown(event: PointerEvent) {
        from = event.clientY;
        dragged = false;
      },
      pointermove(event: PointerEvent) {
        if (from === null) return;
        const dy = event.clientY - from;
        // Once it moves, the moves keep coming here after the pointer leaves the handle (a finger is held so already, a
        // mouse is not). Not on the press: a held pointer's click goes to the holder, not to the handle button.
        const target = event.currentTarget as Element | null;
        if (Math.abs(dy) >= DRAG_START_PX && !target?.hasPointerCapture?.(event.pointerId)) {
          try {
            target?.setPointerCapture?.(event.pointerId);
          } catch {
            // a pointer that is already gone
          }
        }
        if (dy > DRAG_CLOSE_PX) down();
        else if (up && dy < -DRAG_CLOSE_PX) up();
        else return;
        from = null;
        dragged = true;
      },
      pointerup() {
        from = null;
      },
      pointercancel() {
        from = null;
      },
    },
    wasDragged() {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}

/**
 * A panel held to a third of its room in portrait that a drag up takes to two thirds:
 * `expanded` puts `.mob-sheet--expanded` on it. In landscape the panel already has the full height: `grow` does nothing.
 */
export function useSheetExpand() {
  const expanded = ref(false);
  return {
    expanded,
    grow() {
      if (!(window.matchMedia?.('(orientation: landscape)').matches ?? false))
        expanded.value = true;
    },
  };
}
