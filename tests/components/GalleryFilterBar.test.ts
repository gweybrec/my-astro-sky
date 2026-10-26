/**
 * Tests for GalleryFilterBar.vue's sort dropdown: the gallery opens in the stored
 * order, and a choice reorders the gallery, closes the dropdown and is stored.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import GalleryFilterBar from '../../src/components/panels/GalleryFilterBar.vue';
import { useUiStore } from '../../src/stores/ui';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';

const gallery = {
  setSort: vi.fn(),
  setSearchQuery: vi.fn(),
  setSetupFilter: vi.fn(),
  setLabelFilter: vi.fn(),
  setDSOTypeFilter: vi.fn(),
  setDSOCatalogFilter: vi.fn(),
  setPoiFilter: vi.fn(),
  setDateRangeFilter: vi.fn(),
  setGearSetups: vi.fn(),
  getAllLabels: () => [],
  getAllSetups: () => [],
  getAllPois: () => [],
  getFilteredPhotos: () => [],
};

vi.mock('../../src/stores/canvas', () => ({ useCanvasStore: () => ({ gallery }) }));
vi.mock('../../src/api', () => ({ getGearSetups: vi.fn(async () => []) }));

let mounted: { unmount: () => void } | null = null;

async function mountInGallery() {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    stubActions: false,
    initialState: { poiCategories: { categories: [], loaded: true } },
  });
  const wrapper = mount(GalleryFilterBar, {
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  mounted = wrapper;
  useUiStore(pinia).currentViewMode = 'gallery';
  await flushPromises();
  return wrapper;
}

const sortButton = (wrapper: Awaited<ReturnType<typeof mountInGallery>>) =>
  wrapper.findAll('button').find((b) => b.text().includes('A–Z'))!;
const sortRadios = () => [
  ...document.body.querySelectorAll<HTMLInputElement>('input[name="gallery-sort"]'),
];

beforeEach(() => {
  configureStorage(createMemoryStore());
  vi.clearAllMocks();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('GalleryFilterBar sort', () => {
  it('opens the gallery in the stored order', async () => {
    storage().set('gallery-sort', 'date-desc');
    await mountInGallery();
    expect(gallery.setSort).toHaveBeenLastCalledWith('date-desc');
  });

  it('lists the four orders, the current one checked', async () => {
    const wrapper = await mountInGallery();
    await sortButton(wrapper).trigger('click');
    const radios = sortRadios();
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
  });

  it('a choice reorders the gallery, closes the dropdown and is stored', async () => {
    const wrapper = await mountInGallery();
    await sortButton(wrapper).trigger('click');
    sortRadios()[2].dispatchEvent(new Event('change'));
    await flushPromises();
    expect(gallery.setSort).toHaveBeenLastCalledWith('date-desc');
    expect(storage().get('gallery-sort')).toBe('date-desc');
    expect(sortRadios()).toHaveLength(0);
  });
});
