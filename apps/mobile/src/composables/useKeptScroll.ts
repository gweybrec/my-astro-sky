import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

/** Where a list was: the first item seen at its top (by its `data-keep-id`), how far below the top edge it sat, and the
 * scroll offset itself for when that item is no longer there. */
export interface ScrollAnchor {
  id: string | null;
  offset: number;
  scrollTop: number;
}

/** How long (ms) after the list shows again it is held at its place, while what it shows settles. */
export const RESTORE_MS = 1000;

/** The item at the top of `host`'s visible area and its distance from that edge. */
export function readScrollAnchor(host: HTMLElement): ScrollAnchor {
  const top = host.getBoundingClientRect().top;
  for (const el of host.querySelectorAll<HTMLElement>('[data-keep-id]')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top) {
      return { id: el.dataset.keepId ?? null, offset: rect.top - top, scrollTop: host.scrollTop };
    }
  }
  return { id: null, offset: 0, scrollTop: host.scrollTop };
}

/** The items (their `data-keep-id`) wholly inside `host`'s visible area. */
export function visibleKeepIds(host: HTMLElement): string[] {
  const box = host.getBoundingClientRect();
  return [...host.querySelectorAll<HTMLElement>('[data-keep-id]')]
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > rect.top && rect.top >= box.top && rect.bottom <= box.bottom;
    })
    .map((el) => el.dataset.keepId ?? '');
}

/**
 * Scrolls `host` so the anchor's item is back at its distance from the top edge; without it, back to the offset. An
 * item there but not laid out yet (no height) is left for a later try.
 */
export function restoreScrollAnchor(host: HTMLElement, anchor: ScrollAnchor): void {
  const el = anchor.id
    ? [...host.querySelectorAll<HTMLElement>('[data-keep-id]')].find(
        (e) => e.dataset.keepId === anchor.id,
      )
    : undefined;
  if (!el) {
    if (host.scrollTop !== anchor.scrollTop) host.scrollTop = anchor.scrollTop;
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return;
  const delta = rect.top - host.getBoundingClientRect().top - anchor.offset;
  if (delta !== 0) host.scrollTop += delta;
}

/**
 * Keeps a list where it was while its page is hidden (a page pushed over it, another tab), instead of leaving the offset
 * to the WebView, which can cut it down when the page shows again before the list is back at its full height. It does
 * not rely on the page's lifecycle events (a page pushed over the tabs hides the whole tabs page without telling the tab):
 * it watches the list itself. While the list is scrolled, the item at its top is noted; when the list loses its size
 * (hidden) the note is kept; when it gets it back, `prepare` gets the noted item's id (a list drawn a part at a time
 * draws down to it), then the item is held at its place for `RESTORE_MS`, or until the list is touched. The items carry
 * `data-keep-id`. With `target`, asked when the list shows again: the item it names, when it was not wholly in view where
 * the list was left, is brought to the top instead (the last photo seen on its own screen, reached by swiping).
 */
export function useKeptScroll(
  host: Ref<HTMLElement | null>,
  prepare?: (id: string) => void,
  options: { target?: () => string | null } = {},
) {
  let kept: ScrollAnchor | null = null;
  let keptVisible: string[] = [];
  let hidden = false;
  let restoringUntil = 0;
  let frame = 0;

  const restoring = () => performance.now() < restoringUntil;

  function note() {
    const el = host.value;
    if (el && !hidden && !restoring() && el.clientHeight > 0) {
      kept = readScrollAnchor(el);
      keptVisible = visibleKeepIds(el);
    }
  }

  function stopRestoring() {
    if (!restoring()) return;
    restoringUntil = 0;
    cancelAnimationFrame(frame);
    note();
  }

  async function restore() {
    const target = options.target?.() ?? null;
    const anchor =
      target && !keptVisible.includes(target)
        ? { id: target, offset: Math.max(0, kept?.offset ?? 0), scrollTop: kept?.scrollTop ?? 0 }
        : kept;
    if (!anchor) return;
    if (anchor.id) prepare?.(anchor.id);
    restoringUntil = performance.now() + RESTORE_MS;
    await nextTick();
    const step = () => {
      const el = host.value;
      if (!el || hidden) return;
      if (!restoring()) {
        note();
        return;
      }
      restoreScrollAnchor(el, anchor);
      frame = requestAnimationFrame(step);
    };
    step();
  }

  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const el = host.value;
          if (!el) return;
          if (el.clientHeight === 0) {
            hidden = true;
            restoringUntil = 0;
            cancelAnimationFrame(frame);
          } else if (hidden) {
            hidden = false;
            void restore();
          }
        })
      : null;

  const touched = ['touchstart', 'pointerdown', 'wheel'] as const;
  watch(
    host,
    (el, old) => {
      if (old) {
        old.removeEventListener('scroll', note);
        for (const type of touched) old.removeEventListener(type, stopRestoring);
        observer?.unobserve(old);
      }
      if (el) {
        el.addEventListener('scroll', note, { passive: true });
        for (const type of touched) el.addEventListener(type, stopRestoring, { passive: true });
        observer?.observe(el);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });
}
