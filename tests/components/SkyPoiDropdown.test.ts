/**
 * Tests for SkyPoiDropdown.vue — the sky map's POI pin dropdown. Unlike the
 * gallery's PoiFilterDropdown (a search filter: nothing checked ⇒ show all), it
 * follows the sky map's label/type dropdowns: every POI checked (= shown) by
 * default, unchecking hides it, a "Select all" row, category rows with an
 * indeterminate state, and no "Clear" button.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import SkyPoiDropdown from '../../src/components/panels/SkyPoiDropdown.vue';
import { useDisplayStore } from '../../src/stores/display';
import { poiKey } from '../../src/poi';

const setVisiblePois = vi.fn();
const photos = [
  {
    photo: {
      pointsOfInterest: [
        { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.27, dec: 34.41 },
        { name: 'Vesta', categoryId: 'cat-asteroid' },
      ],
    },
  },
  { photo: { pointsOfInterest: [{ name: 'SN 2025rbs', categoryId: 'cat-supernova' }] } },
];

vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({
    skyMap: null,
    overlay: {
      getPlacedPhotos: () => photos,
      addOnPhotosChanged: vi.fn(),
      setVisiblePois,
    },
  }),
}));

const categories = [
  { id: 'cat-asteroid', name: 'Asteroid', color: '#c9a227', position: 1 },
  { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
];

let mounted: { unmount: () => void } | null = null;

async function mountOpen(disabled = false) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    stubActions: false,
    initialState: { poiCategories: { categories, loaded: true } },
  });
  const wrapper = mount(SkyPoiDropdown, {
    props: { disabled },
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  mounted = wrapper;
  await wrapper.find('button').trigger('click');
  await flushPromises();
  return { wrapper, store: useDisplayStore(pinia) };
}

/** Rows of the open dropdown panel (teleported to body): label text → checkbox. */
function rows() {
  return [...document.body.querySelectorAll<HTMLLabelElement>('label')].map((l) => ({
    text: l.textContent!.replace(/\s+/g, ' ').trim(),
    input: l.querySelector('input') as HTMLInputElement,
  }));
}
const row = (prefix: string) => rows().find((r) => r.text.startsWith(prefix))!;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  setVisiblePois.mockClear();
});

describe('SkyPoiDropdown', () => {
  it('lists every POI checked by default, grouped by type, with no Clear button', async () => {
    const { wrapper } = await mountOpen();
    expect(wrapper.find('button').text()).toBe('Points of interest (3)');
    expect(row('Select all').input.checked).toBe(true);
    expect(row('Supernova').input.checked).toBe(true);
    expect(row('SN 2026aaiv').input.checked).toBe(true);
    expect(row('Vesta').input.checked).toBe(true);
    expect(document.body.textContent).not.toMatch(/clear/i);
  });

  it('unchecking a POI hides it (and the pins) and makes its category partial', async () => {
    const { wrapper, store } = await mountOpen();
    const sn = row('SN 2026aaiv').input;
    sn.checked = false;
    sn.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(store.visiblePois[poiKey('cat-supernova', 'SN 2026aaiv')]).toBe(false);
    expect(setVisiblePois).toHaveBeenLastCalledWith(store.visiblePois);
    expect(row('Supernova').input.indeterminate).toBe(true);
    expect(row('Select all').input.indeterminate).toBe(true);
    expect(wrapper.find('button').text()).toBe('Points of interest (2)');
  });

  it('a category checkbox shows or hides all its POIs', async () => {
    const { store } = await mountOpen();
    const cat = row('Supernova').input;
    cat.checked = false;
    cat.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(row('SN 2026aaiv').input.checked).toBe(false);
    expect(row('SN 2025rbs').input.checked).toBe(false);
    expect(row('Vesta').input.checked).toBe(true);
    expect(store.visiblePois[poiKey('cat-asteroid', 'Vesta')]).toBeUndefined();
  });

  it('"Select all" re-checks everything', async () => {
    const { store } = await mountOpen();
    store.setVisiblePoi(poiKey('cat-asteroid', 'Vesta'), false);
    await flushPromises();
    const all = row('Select all').input;
    all.checked = true;
    all.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(rows().every((r) => r.input.checked)).toBe(true);
  });

  it('is inert and greyed out when disabled', async () => {
    const { wrapper } = await mountOpen(true);
    expect((wrapper.find('button').element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.classes()).toContain('opacity-40');
    expect(document.body.querySelector('input')).toBeNull();
  });
});
