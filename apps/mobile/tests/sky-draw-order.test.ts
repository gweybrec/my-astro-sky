import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { PhotoCanvasQuad } from '@myastrosky/core/photo-draw-order';
import type { Photo } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const updatePhotoOrder = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: (...a: unknown[]) => getPhotos(...a),
  updatePhotoOrder: (...a: unknown[]) => updatePhotoOrder(...a),
}));
vi.mock('@myastrosky/core/catalog/dso-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/catalog/dso-registry')>()),
  getDSOById: (id: string) => (id === 'NGC7000' ? { id, catalogs: ['NGC7000'] } : undefined),
}));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

import SkyDrawOrderPage from '../src/pages/SkyDrawOrderPage.vue';
import PhoneReorderList from '../src/components/PhoneReorderList.vue';
import PhoneToggleRow from '../src/components/PhoneToggleRow.vue';
import { skyDrawOrder } from '../src/sky-draw-order';

/** "Ciel, ordre d'affichage": the placed photos, the top one first, reordered by dragging. */

const photo = (id: string, over: Partial<Photo> = {}): Photo =>
  ({ id, originalName: `${id}.jpg`, dsoIds: [], labels: [], notes: '', ...over }) as Photo;
const square = (id: string, x: number): PhotoCanvasQuad => ({
  id,
  name: id,
  corners: [
    { x, y: 0 },
    { x: x + 10, y: 0 },
    { x: x + 10, y: 10 },
    { x, y: 10 },
  ],
});

// Bottom to top on the map: a, b, c, far. "far" overlaps none of the others.
const placed = [
  photo('a', { dsoIds: ['NGC7000'], originalName: 'Cygnus_wide.jpg' }),
  photo('b'),
  photo('c'),
  photo('far'),
];
const quads = [square('a', 0), square('b', 5), square('c', 2), square('far', 100)];

function fakeLayer() {
  let order = placed.map((p) => p.id);
  return {
    getPlacedPhotos: () => order.map((id) => ({ photo: placed.find((p) => p.id === id)! })),
    setPhotoOrder: vi.fn((ids: string[]) => (order = ids)),
  } as unknown as PhotoLayer & { setPhotoOrder: ReturnType<typeof vi.fn> };
}

function mountPage(
  request: typeof skyDrawOrder.value = { photoId: 'b', layer: fakeLayer(), quads },
) {
  skyDrawOrder.value = request;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  const replace = vi.spyOn(router, 'replace');
  const w = mount(SkyDrawOrderPage, {
    global: { stubs: ionicStubs, plugins: [router, createPinia()] },
  });
  return { w, layer: request?.layer as ReturnType<typeof fakeLayer>, replace };
}
const titles = (w: ReturnType<typeof mount>) =>
  w.findAll('.mob-entry .mob-row-title').map((e) => e.text());

describe('the display order page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    getPhotos.mockReset();
    updatePhotoOrder.mockReset().mockResolvedValue(undefined);
    showError.mockReset();
  });

  it('lists the overlapping photos, the top one first, the chosen one highlighted', () => {
    const { w } = mountPage();
    expect(w.find('h1').text()).toBe("Ordre d'affichage");
    // "far" overlaps nothing: kept out while "Chevauchement uniquement" is on.
    expect(titles(w)).toEqual(['c.jpg', 'b.jpg', 'NGC7000']);
    expect(w.find('.mob-entry--current .mob-row-title').text()).toBe('b.jpg');
  });

  it('writes the first object as the title and the file name under it', () => {
    const { w } = mountPage();
    const rows = w.findAll('.mob-entry');
    expect(rows[2].find('.mob-row-sub').text()).toBe('Cygnus_wide.jpg');
    expect(rows[0].find('.mob-row-sub').exists()).toBe(false);
  });

  it('lists every photo once the overlap switch is off, and filters by the search', async () => {
    const { w } = mountPage();
    w.findComponent(PhoneToggleRow).vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(titles(w)).toEqual(['far.jpg', 'c.jpg', 'b.jpg', 'NGC7000']);
    await w.find('input[type=search]').setValue('far');
    expect(titles(w)).toEqual(['far.jpg']);
    await w.find('input[type=search]').setValue('nothing at all');
    expect(w.find('.mob-empty-text').text()).toBe('Aucune photo ne correspond aux filtres actuels');
  });

  it('moves only the listed photos, shows it on the map and saves every photo', async () => {
    // "u" has no placement: it is not on the map but the save needs it, in its own place.
    getPhotos.mockResolvedValue([photo('a'), photo('u'), photo('b'), photo('c'), photo('far')]);
    const { w, layer } = mountPage();
    // Listed: c, b, a. Dragged: a to the top.
    w.findComponent(PhoneReorderList).vm.$emit('reorder', ['a', 'c', 'b']);
    await flushPromises();
    // Bottom first: b, c, a, and "far" (not listed) stays on top.
    expect(layer.setPhotoOrder).toHaveBeenCalledWith(['b', 'c', 'a', 'far']);
    expect(updatePhotoOrder).toHaveBeenCalledWith(['b', 'u', 'c', 'a', 'far']);
    expect(titles(w)).toEqual(['NGC7000', 'c.jpg', 'b.jpg']);
  });

  it('puts the order back and shows the red toast when the save fails', async () => {
    getPhotos.mockResolvedValue(placed);
    updatePhotoOrder.mockRejectedValue(new Error('boom'));
    const { w, layer } = mountPage();
    w.findComponent(PhoneReorderList).vm.$emit('reorder', ['a', 'c', 'b']);
    await flushPromises();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(layer.setPhotoOrder).toHaveBeenLastCalledWith(['a', 'b', 'c', 'far']);
    expect(titles(w)).toEqual(['c.jpg', 'b.jpg', 'NGC7000']);
  });

  it('goes back to the map when opened without a photo', async () => {
    const { replace } = mountPage(null);
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/tabs/sky');
  });
});
