import { onBeforeUnmount, ref, type CSSProperties } from 'vue';

const HOLD_MS = 500;

/**
 * The name of an icon-only button, shown beside it while it is held (decision of 2026-10-05). The label sits at the
 * left of the button, or at its right when the button is in the left half of the screen. A press that showed the
 * label does not count as a tap: `consumeTap()` tells the button to ignore the click that follows.
 *
 * Only the button's measured edges are set here, as CSS variables of the label's anchor (`.mob-longpress-anchor`):
 * the gap to the button and the vertical centring on it are the stylesheet's (phone-components.css).
 */
export function useLongPressLabel() {
  const style = ref<CSSProperties | null>(null);
  /** The label is at the right of the button (`end`) or at its left (`start`). */
  const side = ref<'start' | 'end'>('start');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  function show(button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    const onLeftHalf = rect.left + rect.width / 2 < window.innerWidth / 2;
    side.value = onLeftHalf ? 'end' : 'start';
    style.value = {
      '--longpress-top': `${rect.top}px`,
      '--longpress-height': `${rect.height}px`,
      // From the screen edge on the label's side to the button's edge facing the label.
      '--longpress-edge': `${onLeftHalf ? rect.right : window.innerWidth - rect.left}px`,
    } as CSSProperties;
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
  return { style, side, start, end, consumeTap };
}
