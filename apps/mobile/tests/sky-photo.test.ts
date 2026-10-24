import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { Photo } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { ionicStubs, mapSheetHost } from './helpers';

const deletePhotoAPI = vi.fn();
const getGearSetups = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
  getGearSetups: () => getGearSetups(),
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
  w: mount(SkyPhotoSheet, {
    props: { photo: p, layer },
    global: { stubs: ionicStubs, provide: mapSheetHost },
  }),
});
const button = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the photo sheet', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
    deletePhotoAPI.mockReset().mockResolvedValue(undefined);
    getGearSetups.mockReset().mockResolvedValue([{ id: 's1', name: 'Newton 200 + ASI 183' }]);
    confirm.mockReset().mockResolvedValue(true);
    showError.mockReset();
  });

  it('names the photo and lists its objects as chips, the most important catalogue first', () => {
    const { w } = mountSheet();
    expect(w.find('.mob-sheet-title').text()).toBe('Cygnus_wide_2025-08-23.jpg');
    expect(w.findAll('.mob-pager .mob-chip').map((c) => c.text())).toEqual([
      'NGC6888',
      'NGC7000',
      'IC5070',
    ]);
    expect(w.find('.mob-pager-dots').exists()).toBe(false);
  });

  it('shows what is known of the photo, read only, between the chips and the opacity', async () => {
    const { w } = mountSheet(
      photo({
        observationDate: '2025-08-23T21:00:00.000Z',
        integrations: [{ frames: 40, seconds: 300, filter: 'Ha' }],
        // the temperatures and the binning are the gallery's details, not the map's
        captureDetails: { gain: 100, offset: 50, ccdTemp: -10, setTemp: -10, binning: '1x1' },
        gearSetupId: 's1',
        labels: ['Seestar'],
        notes: 'Nuit claire',
      }),
    );
    await flushPromises();
    expect(
      w
        .findAll('.mob-facts .mob-fact')
        .map((f) => [f.find('.mob-fact-label').text(), f.find('.mob-fact-value').text()]),
    ).toEqual([
      ["Date d'observation", '23 août 2025'],
      ['Exposition totale', '3h20'],
      ['Gain', '100'],
      ['Offset', '50'],
      ['Équipement', 'Newton 200 + ASI 183'],
      ['Intégration', 'Ha 40 × 300 s'],
      ['Étiquettes', 'Seestar'],
      ['Notes', 'Nuit claire'],
    ]);
    // the objects are the chips above, the name is the title: neither is repeated
    const order = [...w.find('.mob-sheet-body').element.children].map((e) => e.className);
    expect(order.findIndex((c) => c.includes('mob-facts'))).toBeGreaterThan(
      order.findIndex((c) => c.includes('mob-pager ') || c === 'mob-pager'),
    );
    expect(order.findIndex((c) => c.includes('mob-facts'))).toBeLessThan(
      order.findIndex((c) => c.includes('mob-slider-row')),
    );
  });

  it('draws the chips compact (32 px, smaller text), laid out and measured the same way', () => {
    const { w } = mountSheet();
    const chips = w.findAll('.mob-chip');
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips)
      expect(chip.classes()).toEqual(expect.arrayContaining(['mob-chip--compact', 'm-secondary']));
  });

  // Laid out three chips to a line, 56 px apart, with the phone held as `orientation` says.
  const layOut = (orientation: 'portrait' | 'landscape') => {
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
      .mockImplementation(function (this: HTMLElement) {
        const i = Array.prototype.indexOf.call(this.parentElement?.children ?? [], this);
        return Math.floor(i / 3) * 56;
      });
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation(
        (query: string) =>
          ({ matches: query === `(orientation: ${orientation})` }) as MediaQueryList,
      );
    return () => {
      offsetTop.mockRestore();
      matchMedia.mockRestore();
    };
  };
  const ten = () => photo({ dsoIds: Array.from({ length: 10 }, (_, i) => `NGC${i + 1}`) });

  it('puts at most two lines of chips on a page in portrait, with a dot for each page', async () => {
    const restore = layOut('portrait');
    const { w } = mountSheet(ten());
    await flushPromises();
    expect(w.findAll('.mob-pager-page').map((p) => p.findAll('.mob-chip').length)).toEqual([6, 4]);
    expect(w.findAll('.mob-pager-page')[0].text()).toBe('NGC1NGC2NGC3NGC4NGC5NGC6');
    expect(w.findAll('.mob-pager-dot')).toHaveLength(2);
    expect(w.find('.mob-pager-dots').attributes('aria-label')).toBe('Page 1 sur 2');
    restore();
  });

  it('puts one line of chips on a page in landscape, where the sheet has less height', async () => {
    const restore = layOut('landscape');
    const { w } = mountSheet(ten());
    await flushPromises();
    expect(w.findAll('.mob-pager-page').map((p) => p.findAll('.mob-chip').length)).toEqual([
      3, 3, 3, 1,
    ]);
    restore();
  });

  it('keeps the chips laid out for measuring out of reach', () => {
    const { w } = mountSheet();
    const measure = w.find('.mob-pager-measure');
    expect(measure.attributes('aria-hidden')).toBe('true');
    expect(measure.attributes('inert')).toBeDefined();
  });

  it('goes to an object when its chip is tapped', async () => {
    const { w } = mountSheet();
    await w.findAll('.mob-pager .mob-chip')[2].trigger('click');
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

  it('asks for the display order of the photo', async () => {
    const { w } = mountSheet();
    await button(w, "Ordre d'affichage").trigger('click');
    expect(w.emitted('order')).toHaveLength(1);
  });

  it('draws the screen that waits as the board does, and ignores its taps', async () => {
    const { w } = mountSheet();
    expect(button(w, 'Repositionner').attributes('aria-disabled')).toBe('true');
    expect(button(w, "Ordre d'affichage").attributes('aria-disabled')).toBeUndefined();
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
