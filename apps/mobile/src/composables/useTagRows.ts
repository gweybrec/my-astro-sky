import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/** The number of rows the children of a wrapping box make: one per distinct top. */
export function rowCount(box: HTMLElement): number {
  return new Set([...box.children].map((child) => (child as HTMLElement).offsetTop)).size;
}

/**
 * How many of `total` chips a wrapping box shows so that, with the "+N" chip that counts the others, it keeps to
 * `maxRows` rows. The box must render the first `shown` chips, then the "+N" chip when `shown < total`. Measured from the
 * layout, so it follows the box's width (a tile is narrower in landscape) and the chips' texts.
 */
export function useTagRows(box: Ref<HTMLElement | null>, total: () => number, maxRows = 2) {
  const shown = ref(total());
  let run = 0;

  async function fit() {
    const mine = ++run;
    shown.value = total();
    await nextTick();
    while (mine === run && box.value && shown.value > 0 && rowCount(box.value) > maxRows) {
      shown.value -= 1;
      await nextTick();
    }
  }

  let observer: ResizeObserver | null = null;
  let width = -1;
  onMounted(() => {
    void fit();
    if (typeof ResizeObserver === 'undefined' || !box.value) return;
    observer = new ResizeObserver(([entry]) => {
      // Only a change of width moves chips to another row; the box's own height changes as chips are dropped.
      const next = Math.round(entry.contentRect.width);
      if (next === width) return;
      width = next;
      void fit();
    });
    observer.observe(box.value);
  });
  onBeforeUnmount(() => {
    run += 1;
    observer?.disconnect();
  });
  watch(total, () => void fit());

  return { shown, fit };
}
