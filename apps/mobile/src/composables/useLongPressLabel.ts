import { onBeforeUnmount, ref, type CSSProperties } from 'vue';

const HOLD_MS = 500;
const GAP_PX = 8;

/**
 * The name of an icon-only button, shown beside it while it is held (decision of 2026-10-05). The label sits at the
 * left of the button, or at its right when the button is in the left half of the screen. A press that showed the
 * label does not count as a tap: `consumeTap()` tells the button to ignore the click that follows.
 */
export function useLongPressLabel() {
  const style = ref<CSSProperties | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  function show(button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    const onLeftHalf = rect.left + rect.width / 2 < window.innerWidth / 2;
    style.value = onLeftHalf
      ? { position: 'fixed', top: `${rect.top}px`, left: `${rect.right + GAP_PX}px`, right: 'auto' }
      : {
          position: 'fixed',
          top: `${rect.top}px`,
          right: `${window.innerWidth - rect.left + GAP_PX}px`,
        };
    shown = true;
  }

  function start(event: Event) {
    clearTimeout(timer);
    shown = false;
    const button = event.currentTarget as HTMLElement;
    timer = setTimeout(() => show(button), HOLD_MS);
  }

  function end() {
    clearTimeout(timer);
    style.value = null;
  }

  /** True once, right after a long press: the click that ends the press must not run the button's action. */
  function consumeTap(): boolean {
    const was = shown;
    shown = false;
    return was;
  }

  onBeforeUnmount(() => clearTimeout(timer));
  return { style, start, end, consumeTap };
}
