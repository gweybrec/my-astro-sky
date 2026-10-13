import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { Photo } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { ionicStubs } from './helpers';

const deletePhotoAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
}));
const confirm = vi.fn();
const showError = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

import SkyPhotoSheet from '../src/pages/sky/SkyPhotoSheet.vue';
import PhoneSliderRow from '../src/components/PhoneSliderRow.vue';

/** "Ciel, photo sélectionnée": the sheet of a placed photo. */

const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    originalName: 'Cygnus_wide_2025-08-23.jpg',
    dsoIds: ['NGC7000', 'IC5070', 'NGC6888'],
    ...over,
  }) as Photo;

function fakeLayer(state = { opacity: 1, visible: true }) {
  return {
    getPlacedPhotos: () => [{ photo: { id: 'p1' }, ...state }],
    setPhotoOpacity: vi.fn((_id: string, v: number) => (state.opacity = v)),
    toggleVisibility: vi.fn(() => (state.visible = !state.visible)),
    removePhotosFromMap: vi.fn(),
  } as unknown as PhotoLayer & {
    setPhotoOpacity: ReturnType<typeof vi.fn>;
    toggleVisibility: ReturnType<typeof vi.fn>;
    removePhotosFromMap: ReturnType<typeof vi.fn>;
  };
}

const mountSheet = (p = photo(), layer = fakeLayer()) => ({
  layer,
  w: mount(SkyPhotoSheet, { props: { photo: p, layer }, global: { stubs: ionicStubs } }),
});
const button = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the photo sheet', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
    deletePhotoAPI.mockReset().mockResolvedValue(undefined);
    confirm.mockReset().mockResolvedValue(true);
    showError.mockReset();
  });

  it('names the photo and lists its objects as chips', () => {
    const { w } = mountSheet();
    expect(w.find('.mob-sheet-title').text()).toBe('Cygnus_wide_2025-08-23.jpg');
    expect(w.findAll('.mob-chip').map((c) => c.text())).toEqual(['NGC7000', 'IC5070', 'NGC6888']);
    expect(w.find('.mob-pager-dots').exists()).toBe(false);
  });

  it('puts the objects nine to a page, with a dot for each page', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `NGC${i + 1}`);
    const { w } = mountSheet(photo({ dsoIds: ids }));
    expect(w.findAll('.mob-pager-page').map((p) => p.findAll('.mob-chip').length)).toEqual([9, 1]);
    expect(w.findAll('.mob-pager-dot')).toHaveLength(2);
    expect(w.find('.mob-pager-dots').attributes('aria-label')).toBe('Page 1 sur 2');
  });

  it('goes to an object when its chip is tapped', async () => {
    const { w } = mountSheet();
    await w.findAll('.mob-chip')[1].trigger('click');
    expect(w.emitted('dso')).toEqual([['IC5070']]);
  });

  it('sets the photo opacity at once from the slider', () => {
    const { w, layer } = mountSheet();
    w.findComponent(PhoneSliderRow).vm.$emit('update:modelValue', 0.4);
    return w.vm.$nextTick().then(() => {
      expect(layer.setPhotoOpacity).toHaveBeenCalledWith('p1', 0.4);
    });
  });

  it('hides and shows the photo, the button naming what it will do', async () => {
    const { w, layer } = mountSheet();
    await button(w, 'Masquer').trigger('click');
    expect(layer.toggleVisibility).toHaveBeenCalledWith('p1');
    await button(w, 'Afficher').trigger('click');
    expect(layer.toggleVisibility).toHaveBeenCalledTimes(2);
  });

  it('deletes only after the confirmation, and tells the page', async () => {
    const { w, layer } = mountSheet();
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(deletePhotoAPI).toHaveBeenCalledWith('p1');
    expect(layer.removePhotosFromMap).toHaveBeenCalledWith(['p1']);
    expect(w.emitted('removed')).toHaveLength(1);
  });

  it('keeps the photo when the delete is not confirmed', async () => {
    confirm.mockResolvedValue(false);
    const { w } = mountSheet();
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(deletePhotoAPI).not.toHaveBeenCalled();
    expect(w.emitted('removed')).toBeUndefined();
  });

  it('shows the red toast and keeps the photo when the delete fails', async () => {
    deletePhotoAPI.mockRejectedValue(new Error('boom'));
    const { w, layer } = mountSheet();
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(layer.removePhotosFromMap).not.toHaveBeenCalled();
    expect(w.emitted('removed')).toBeUndefined();
  });

  it('opens the photo in the gallery', async () => {
    const { w } = mountSheet();
    await button(w, 'Ouvrir dans la galerie').trigger('click');
    expect(w.emitted('gallery')).toHaveLength(1);
  });

  it('asks for the edit page of the photo', async () => {
    const { w } = mountSheet();
    await button(w, 'Modifier les métadonnées').trigger('click');
    expect(w.emitted('edit')).toHaveLength(1);
  });

  it('draws the two screens that wait as the board does, and ignores their taps', async () => {
    const { w } = mountSheet();
    for (const name of ['Repositionner', "Ordre d'affichage"]) {
      expect(button(w, name).attributes('aria-disabled')).toBe('true');
    }
    expect(w.findAll('.mob-icon-row button').map((b) => b.attributes('aria-label'))).toEqual([
      'Masquer',
      'Ouvrir dans la galerie',
      'Repositionner',
      "Ordre d'affichage",
      'Modifier les métadonnées',
      'Supprimer',
    ]);
  });

  it('closes from the handle and by dragging down', async () => {
    const { w } = mountSheet();
    await w.find('.mob-sheet-grab').trigger('click');
    const drag = w.find('.mob-sheet-drag').element;
    const fire = (type: string, y: number) =>
      drag.dispatchEvent(new MouseEvent(type, { clientY: y, bubbles: true }));
    fire('pointerdown', 100);
    fire('pointermove', 170);
    expect(w.emitted('close')).toHaveLength(2);
  });
});
