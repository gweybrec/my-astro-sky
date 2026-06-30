import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PoiEditor from '../../src/components/modals/PoiEditor.vue';
import type { PointOfInterest } from '../../src/types';

const categories = [
  { id: 'cat-a', name: 'Galaxy', color: '#f00', position: 0 },
  { id: 'cat-b', name: 'Nebula', color: '#0f0', position: 1 },
];

function makeWrapper(pois: PointOfInterest[] = []) {
  return mount(PoiEditor, {
    props: { pois },
    global: {
      plugins: [
        createTestingPinia({
          stubActions: true,
          createSpy: vi.fn,
          initialState: { poiCategories: { categories, loaded: true } },
        }),
      ],
    },
  });
}

describe('PoiEditor blur-to-register', () => {
  let wrapper: ReturnType<typeof makeWrapper>;

  beforeEach(() => {
    wrapper = makeWrapper();
  });

  function lastEmittedPois(): PointOfInterest[] | undefined {
    const ev = wrapper.emitted('update:pois');
    return ev ? (ev[ev.length - 1][0] as PointOfInterest[]) : undefined;
  }

  it('registers the chip when the name input blurs to somewhere other than the dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: null });

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-a' }]);
  });

  it('does NOT register when the name input blurs to the type dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });

    expect(wrapper.emitted('update:pois')).toBeUndefined();
  });

  it('registers after the type is chosen in the dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });

    // Pick a different type — the change commits the pending name.
    await select.setValue('cat-b');

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-b' }]);
  });

  it('registers when the dropdown is left unchanged (blur to elsewhere)', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });
    // No change event; user clicks away from the dropdown.
    await select.trigger('blur', { relatedTarget: null });

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-a' }]);
  });

  it('does not register an empty name on blur', async () => {
    const input = wrapper.find('input[type="text"]');
    await input.trigger('blur', { relatedTarget: null });

    expect(wrapper.emitted('update:pois')).toBeUndefined();
  });
});
