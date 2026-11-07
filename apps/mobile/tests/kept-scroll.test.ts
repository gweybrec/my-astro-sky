import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';

import {
  readScrollAnchor,
  restoreScrollAnchor,
  useKeptScroll,
} from '../src/composables/useKeptScroll';
import { useGrowingList } from '../src/composables/useGrowingList';

const ITEM_H = 100;

/**
 * A scroll host of `ids` items, each ITEM_H tall, laid out from the scroll offset (happy-dom does no layout, so the
 * boxes are computed: what a browser gives). `hidden` plays the page hidden by Ionic: no size, offset lost.
 */
function fakeList(ids: string[]) {
  const host = document.createElement('div');
  let scrollTop = 0;
  let hidden = false;
  Object.defineProperty(host, 'scrollTop', {
    get: () => (hidden ? 0 : scrollTop),
    set: (v: number) => (scrollTop = Math.max(0, v)),
  });
  Object.defineProperty(host, 'clientHeight', { get: () => (hidden ? 0 : 800) });
  host.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
  const render = (list: string[]) => {
    host.replaceChildren(
      ...list.map((id, i) => {
        const el = document.createElement('button');
        el.dataset.keepId = id;
        el.getBoundingClientRect = () =>
          ({
            top: 50 + i * ITEM_H - scrollTop,
            bottom: 50 + (i + 1) * ITEM_H - scrollTop,
          }) as DOMRect;
        return el;
      }),
    );
  };
  render(ids);
  return {
    host,
    render,
    setHidden: (v: boolean) => (hidden = v),
    loseOffset: () => (scrollTop = 0),
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('readScrollAnchor and restoreScrollAnchor', () => {
  it('note the first item seen at the top and its distance below the edge', () => {
    const { host } = fakeList(ids(50));
    host.scrollTop = 4230;
    expect(readScrollAnchor(host)).toEqual({ id: 'p42', offset: -30, scrollTop: 4230 });
  });

  it('put that item back at the same place, whatever the offset became meanwhile', () => {
    const { host, loseOffset } = fakeList(ids(50));
    host.scrollTop = 4230;
    const anchor = readScrollAnchor(host);
    loseOffset();
    restoreScrollAnchor(host, anchor);
    expect(host.scrollTop).toBe(4230);
  });

  it('keep the item in place when items above it changed', () => {
    const list = fakeList(ids(50));
    list.host.scrollTop = 4230;
    const anchor = readScrollAnchor(list.host);
    list.render(ids(50).slice(2)); // two photos above it are gone
    restoreScrollAnchor(list.host, anchor);
    expect(readScrollAnchor(list.host)).toMatchObject({ id: 'p42', offset: -30 });
  });

  it('fall back to the offset when the item is no longer there', () => {
    const list = fakeList(ids(50));
    list.host.scrollTop = 4230;
    const anchor = readScrollAnchor(list.host);
    list.render(ids(30));
    list.loseOffset();
    restoreScrollAnchor(list.host, anchor);
    expect(list.host.scrollTop).toBe(4230);
  });
});

describe('useGrowingList.showAtLeast', () => {
  it('draws whole parts down to the item asked for, never fewer than drawn', () => {
    const list = useGrowingList(() => ids(100), 24);
    list.showAtLeast(43);
    expect(list.shown.value).toHaveLength(48);
    list.showAtLeast(5);
    expect(list.shown.value).toHaveLength(48);
  });
});

describe('useKeptScroll', () => {
  // Unmounting stops the place being held, so no frame runs after a test.
  enableAutoUnmount(afterEach);
  // The list's size changes, as a ResizeObserver reports them; a frame is a macrotask.
  let resized: () => void = () => {};
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  const frames = (n = 3) => new Promise((r) => setTimeout(r, n));

  function setup(n: number) {
    const list = fakeList(ids(n));
    const prepare = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          useKeptScroll(ref(list.host), prepare);
          return () => h('div');
        },
      }),
    );
    const scrollTo = (top: number) => {
      list.host.scrollTop = top;
      list.host.dispatchEvent(new Event('scroll'));
    };
    const hide = () => {
      list.setHidden(true);
      resized();
    };
    const show = () => {
      list.setHidden(false);
      resized();
    };
    return { list, prepare, wrapper, scrollTo, hide, show };
  }

  it('puts the list back where it was after it was hidden and its offset cut down', async () => {
    const { list, prepare, scrollTo, hide, show } = setup(100);
    scrollTo(6120);
    hide();
    list.loseOffset();
    show();
    await flushPromises();
    await frames();
    expect(prepare).toHaveBeenCalledWith('p61');
    expect(list.host.scrollTop).toBe(6120);
  });

  it('ignores the scroll the WebView makes while putting the page back, and holds the place while it settles', async () => {
    const { list, scrollTo, hide, show } = setup(100);
    scrollTo(6120);
    hide();
    show();
    scrollTo(0); // the cut-down offset, reported as a scroll
    await flushPromises();
    await frames();
    expect(list.host.scrollTop).toBe(6120);
    list.loseOffset(); // later in the slide-in
    await frames();
    expect(list.host.scrollTop).toBe(6120);
  });

  it('stops holding the place as soon as the list is touched', async () => {
    const { list, scrollTo, hide, show } = setup(100);
    scrollTo(6120);
    hide();
    show();
    await flushPromises();
    await frames();
    list.host.dispatchEvent(new Event('touchstart'));
    scrollTo(3000);
    await frames();
    expect(list.host.scrollTop).toBe(3000);
  });

  it('leaves a list alone that was never scrolled', async () => {
    const { list, prepare, hide, show } = setup(10);
    hide();
    show();
    await flushPromises();
    await frames();
    expect(prepare).not.toHaveBeenCalled();
    expect(list.host.scrollTop).toBe(0);
  });
});
