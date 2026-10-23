/** How far a finger must travel down from a sheet's handle or header to close it. */
export const DRAG_CLOSE_PX = 48;

/** Dragging down from the handle or the header closes a sheet drawn in the page: the three pointer handlers for it. */
export function useSheetDrag(close: () => void) {
  let from: number | null = null;
  return {
    pointerdown(event: PointerEvent) {
      from = event.clientY;
    },
    pointermove(event: PointerEvent) {
      if (from !== null && event.clientY - from > DRAG_CLOSE_PX) {
        from = null;
        close();
      }
    },
    pointerup() {
      from = null;
    },
    pointercancel() {
      from = null;
    },
  };
}
