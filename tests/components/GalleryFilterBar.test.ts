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

const sortSelect = (wrapper: Awaited<ReturnType<typeof mountInGallery>>) =>
  wrapper.find('select#gallery-sort');

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

  it('lists the four orders in a native dropdown, the current one chosen', async () => {
    const wrapper = await mountInGallery();
    const select = sortSelect(wrapper);
    expect(select.findAll('option')).toHaveLength(4);
    expect((select.element as HTMLSelectElement).value).toBe('name-asc');
    expect(document.body.querySelector('input[type="radio"]')).toBeNull();
  });

  it('a choice reorders the gallery and is stored', async () => {
    const wrapper = await mountInGallery();
    await sortSelect(wrapper).setValue('date-desc');
    await flushPromises();
    expect(gallery.setSort).toHaveBeenLastCalledWith('date-desc');
    expect(storage().get('gallery-sort')).toBe('date-desc');
  });
});
