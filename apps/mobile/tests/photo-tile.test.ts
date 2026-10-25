import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { ionicStubs } from './helpers';
import PhotoTile from '../src/components/PhotoTile.vue';
import type { PhotoTag } from '../src/photo-tags';
import { rowCount } from '../src/composables/useTagRows';
import {
  loadGalleryDisplay,
  PER_LINE_CHOICES,
  photosPerLine,
  setPhotosPerLine,
} from '../src/gallery-display';

describe('a gallery card left with its tab', () => {
  it('drops the address of a picture still loading, and keeps one already loaded', async () => {
    const w = mount(PhotoTile, {
      props: { name: 'M31.jpg', picture: '/uploads/a.jpg', paused: true },
    });
    expect(w.find('img').attributes('src')).toBeUndefined();
    await w.setProps({ paused: false });
    expect(w.find('img').attributes('src')).toBe('/uploads/a.jpg');
    await w.find('img').trigger('load');
    await w.setProps({ paused: true });
    expect(w.find('img').attributes('src')).toBe('/uploads/a.jpg');
  });

  it('shows a turned photo turned in its square', async () => {
    const w = mount(PhotoTile, { props: { name: 'M31.jpg', picture: '/uploads/a.jpg', turns: 3 } });
    expect(w.find('img').attributes('style')).toContain('rotate(270deg)');
    await w.setProps({ turns: 0 });
    expect(w.find('img').attributes('style')).toBeUndefined();
  });
});

/** A gallery card's chips ("+N" for the ones that do not fit in two rows) and the photos-per-line choice. */

const tags = (n: number): PhotoTag[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'dso', text: `NGC${i + 1}` }));

/**
 * A layout for the test: `perRow` chips to a row, the "+N" chip counting as one. happy-dom lays nothing out, so each
 * chip's top is derived from its place among its siblings.
 */
function fakeRows(perRow: number) {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const siblings = this.parentElement ? [...this.parentElement.children] : [];
      return Math.floor(siblings.indexOf(this) / perRow) * 24;
    },
  });
}

describe('a gallery card', () => {
  beforeEach(() => fakeRows(3));

  const mountTile = (count: number) =>
    mount(PhotoTile, {
      props: { name: 'M31.jpg', picture: '/uploads/a.jpg', tags: tags(count) },
      global: { stubs: ionicStubs },
      attachTo: document.body,
    });
  const chips = (w: ReturnType<typeof mountTile>) => w.findAll('.mob-tag').map((c) => c.text());

  it('counts the rows of a wrapping box from the tops of its children', () => {
    const w = mountTile(5);
    expect(rowCount(w.find('.mob-tags').element as HTMLElement)).toBe(2);
  });

  it('shows every chip when they fit in two rows', async () => {
    const w = mountTile(6);
    await flushPromises();
    expect(chips(w)).toEqual(['NGC1', 'NGC2', 'NGC3', 'NGC4', 'NGC5', 'NGC6']);
  });

  it('keeps to two rows, the chips that do not fit counted in a last one', async () => {
    const w = mountTile(9);
    await flushPromises();
    // Three to a row: five chips and the "+4" make the two rows.
    expect(chips(w)).toEqual(['NGC1', 'NGC2', 'NGC3', 'NGC4', 'NGC5', '+4']);
    expect(w.findAll('.mob-tag').at(-1)!.classes()).toContain('mob-tag--more');
  });

  it('counts again when the chips change', async () => {
    const w = mountTile(9);
    await flushPromises();
    await w.setProps({ tags: tags(4) });
    await flushPromises();
    expect(chips(w)).toEqual(['NGC1', 'NGC2', 'NGC3', 'NGC4']);
    await w.setProps({ tags: tags(7) });
    await flushPromises();
    expect(chips(w)).toEqual(['NGC1', 'NGC2', 'NGC3', 'NGC4', 'NGC5', '+2']);
  });

  it('has no chips block without chips, and tells a tap', async () => {
    const w = mount(PhotoTile, { props: { name: 'M27.jpg' }, global: { stubs: ionicStubs } });
    expect(w.find('.mob-tags').exists()).toBe(false);
    expect(w.find('.mob-photo-card-name').text()).toBe('M27.jpg');
    await w.trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });
});

describe('the photos per line of the gallery', () => {
  beforeEach(() => {
    configureStorage(createMemoryStore());
    loadGalleryDisplay();
  });

  it('is two in portrait and six in landscape until chosen', () => {
    expect({ ...photosPerLine }).toEqual({ portrait: 2, landscape: 6 });
    expect(PER_LINE_CHOICES).toEqual({ portrait: [1, 2, 3], landscape: [3, 4, 5, 6] });
  });

  it('keeps one choice for each way of holding the phone', () => {
    setPhotosPerLine('portrait', 1);
    setPhotosPerLine('landscape', 4);
    photosPerLine.portrait = 2;
    loadGalleryDisplay();
    expect({ ...photosPerLine }).toEqual({ portrait: 1, landscape: 4 });
  });

  it('refuses a number that is not offered, and ignores a stored record it cannot read', () => {
    setPhotosPerLine('portrait', 6);
    expect(photosPerLine.portrait).toBe(2);
    storage().set('gallery-display-v1', '{"portrait":9,"landscape":"x"}');
    loadGalleryDisplay();
    expect({ ...photosPerLine }).toEqual({ portrait: 2, landscape: 6 });
    storage().set('gallery-display-v1', 'not json');
    loadGalleryDisplay();
    expect({ ...photosPerLine }).toEqual({ portrait: 2, landscape: 6 });
  });
});
