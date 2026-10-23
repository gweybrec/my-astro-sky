import { computed, ref } from 'vue';

/** How close to the end of the list (px) the next part is drawn: before the finger gets there. */
const AHEAD_PX = 400;

/**
 * A long list drawn a part at a time (the Cibles list, the asteroids SkyBoT finds: thousands of rows): the first `chunk`
 * items, then `chunk` more each time the list is scrolled near its end. Drawing them all at once froze the page for
 * seconds on a phone. `onScroll` goes on the list's scroll host; `reset` starts again from the first part (a new
 * search).
 */
export function useGrowingList<T>(items: () => readonly T[], chunk: number) {
  const count = ref(chunk);
  const shown = computed(() => items().slice(0, count.value));

  function onScroll(event: Event) {
    const el = event.target as HTMLElement;
    if (
      el.scrollTop + el.clientHeight > el.scrollHeight - AHEAD_PX &&
      count.value < items().length
    ) {
      count.value += chunk;
    }
  }

  function reset() {
    count.value = chunk;
  }

  return { shown, onScroll, reset };
}
