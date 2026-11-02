import { onBeforeUnmount } from 'vue';

const FIRST_REPEAT_MS = 400;
const REPEAT_MS = 100;

/**
 * A button that acts at once when pressed and again and again while held (the time bar's date steppers), like the
 * spin boxes of Stellarium's date window. `start` on pointer down, `stop` on pointer up, cancel or leave.
 */
export function useHoldRepeat(action: () => void) {
  let wait: ReturnType<typeof setTimeout> | undefined;
  let repeat: ReturnType<typeof setInterval> | undefined;

  function stop() {
    clearTimeout(wait);
    clearInterval(repeat);
    wait = repeat = undefined;
  }

  function start() {
    stop();
    action();
    wait = setTimeout(() => (repeat = setInterval(action, REPEAT_MS)), FIRST_REPEAT_MS);
  }

  onBeforeUnmount(stop);
  return { start, stop };
}
