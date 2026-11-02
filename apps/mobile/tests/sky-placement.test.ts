import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type {
  ManualPlacement,
  Photo,
  PhotoCorrespondence,
  ViewState,
} from '@myastrosky/core/types';
import { ionicStubs } from './helpers';
import { project } from '@myastrosky/core/projection';

const uploadPhoto = vi.fn();
const updatePhotoManualPlacement = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  updatePhotoManualPlacement: (...a: unknown[]) => updatePhotoManualPlacement(...a),
  photoFileUrl: (name: string) => `/uploads/${name}`,
}));
const findDSOsInImage = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOsInImage: (...a: unknown[]) => findDSOsInImage(...a),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

import SkyPlacement from '../src/pages/sky/SkyPlacement.vue';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  pendingPhotos,
} from '../src/pending-photos';

/** "Placer la photo": a waiting photo placed by hand over the sky map. */

// A view centred on M101, the photo's starting place.
const M101 = project(210.8, 54.35);
const VIEW: ViewState = {
  centerX: M101.x,
  centerY: M101.y,
  scale: 1000,
  rotationDeg: 0,
  width: 400,
  height: 500,
};
const map = {
  getView: () => VIEW,
  viewCenterSky: () => ({ ra: 210.8, dec: 54.35 }),
};
let viewListener: (() => void) | null = null;
const onView = (listener: () => void) => {
  viewListener = listener;
  return () => (viewListener = null);
};

const mapEl = document.createElement('div');
document.body.appendChild(mapEl);
mapEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 500 }) as DOMRect;
Object.defineProperty(mapEl, 'clientWidth', { value: 400 });
Object.defineProperty(mapEl, 'clientHeight', { value: 500 });

async function mountPlacement() {
  const pending = await addPendingPhoto(new Blob(['jpg'], { type: 'image/jpeg' }), 'M101.jpg');
  const w = mount(SkyPlacement, {
    props: { map: map as never, mapEl, pendingId: pending.id, onView },
    global: { stubs: ionicStubs },
  });
  await flushPromises();
  const img = mapEl.querySelector('img.mob-placing-photo') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 4000 });
  Object.defineProperty(img, 'naturalHeight', { value: 2000 });
  img.dispatchEvent(new Event('load'));
  await flushPromises();
  return { w, img, pending };
}

/** The photo's CSS matrix: [a, b, c, d, e, f]. */
const matrixOf = (img: HTMLImageElement) =>
  img.style.transform
    .replace(/^matrix\(|\)$/g, '')
    .split(',')
    .map(Number);
const pointer = (img: HTMLImageElement, type: string, id: number, x: number, y: number) =>
  img.dispatchEvent(
    new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }),
  );
const values = (w: Awaited<ReturnType<typeof mountPlacement>>['w']) =>
  w.findAll('.mob-slider-value').map((v) => v.text());

describe('placing a photo by hand', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configurePendingStore(createMemoryPendingStore());
    uploadPhoto.mockReset().mockResolvedValue({ id: 'p9' });
    findDSOsInImage.mockReset().mockReturnValue([{ id: 'M101' }, { id: 'NGC5474' }]);
    showError.mockReset();
    mapEl.innerHTML = '';
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:photo');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('shows the photo at the centre of the map, its longer side over most of the map, with its settings', async () => {
    const { w, img } = await mountPlacement();
    expect(mapEl.querySelector('.mob-map-hint')!.textContent).toBe(
      'Un doigt : déplacer · Deux doigts : agrandir et tourner',
    );
    const [a, b, c, d, e, f] = matrixOf(img);
    // 60 % of the map's shorter side (400) over the photo's longer side (4000).
    expect(a).toBeCloseTo(0.06);
    expect(b).toBeCloseTo(0);
    expect(d).toBeCloseTo(0.06);
    expect(c).toBeCloseTo(0);
    // The photo's centre lies at the centre of the map.
    expect(e + a * 2000).toBeCloseTo(200, 0);
    expect(f + d * 1000).toBeCloseTo(250, 0);
    expect(w.findAll('.mob-slider-label').map((l) => l.text())).toEqual([
      'Rotation',
      'Zoom photo',
      'Opacité',
    ]);
    expect(values(w)).toEqual(['0°', '100 %', '0.85']);
    expect(img.style.opacity).toBe('0.85');
    expect(w.find('.mob-row-title').text()).toBe('Miroir ↔');
  });

  it('moves the photo under one finger, and turns and grows it under two', async () => {
    const { w, img } = await mountPlacement();
    pointer(img, 'pointerdown', 1, 200, 250);
    pointer(img, 'pointermove', 1, 240, 280);
    pointer(img, 'pointerup', 1, 240, 280);
    await flushPromises();
    let [a, , , d, e, f] = matrixOf(img);
    expect(e + a * 2000).toBeCloseTo(240, 0);
    expect(f + d * 1000).toBeCloseTo(280, 0);

    // Two fingers 80 px apart become 160 px apart, turned by 30°.
    pointer(img, 'pointerdown', 1, 200, 280);
    pointer(img, 'pointerdown', 2, 280, 280);
    const turn = Math.PI / 6;
    pointer(img, 'pointermove', 1, 240 - 80 * Math.cos(turn), 280 - 80 * Math.sin(turn));
    pointer(img, 'pointermove', 2, 240 + 80 * Math.cos(turn), 280 + 80 * Math.sin(turn));
    await flushPromises();
    expect(values(w).slice(0, 2)).toEqual(['30°', '200 %']);
    [a, , , d, e, f] = matrixOf(img);
    expect(Math.hypot(a, matrixOf(img)[1])).toBeCloseTo(0.12);
  });

  it('follows the map when it moves under the photo', async () => {
    const { img } = await mountPlacement();
    const before = img.style.transform;
    const moved = { ...VIEW, scale: 2000 };
    map.getView = () => moved;
    viewListener?.();
    await flushPromises();
    expect(img.style.transform).not.toBe(before);
    expect(matrixOf(img)[0]).toBeCloseTo(0.12);
    map.getView = () => VIEW;
  });

  it('sets the rotation, the size, the opacity and the mirror from the panel', async () => {
    const { w, img } = await mountPlacement();
    const ranges = w.findAllComponents({ name: 'IonRange' });
    expect(ranges).toHaveLength(0); // stubbed: the rows are driven through their models
    const sliders = w.findAllComponents({ name: 'PhoneSliderRow' });
    sliders[0].vm.$emit('update:modelValue', 45);
    sliders[1].vm.$emit('update:modelValue', 1);
    sliders[2].vm.$emit('update:modelValue', 0.5);
    w.findComponent({ name: 'PhoneToggleRow' }).vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(values(w)).toEqual(['45°', '200 %', '0.50']);
    expect(img.style.opacity).toBe('0.5');
    const [a, b] = matrixOf(img);
    // Mirrored: the photo's x axis is turned by 180° + 45°.
    expect(Math.atan2(b, a) * (180 / Math.PI)).toBeCloseTo(-135);
  });

  it('stores the photo with its placement, three points of the sky and the objects in it, and forgets the waiting one', async () => {
    const { w, pending } = await mountPlacement();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Valider')!
      .trigger('click');
    await flushPromises();
    const [file, correspondences, placement, , meta] = uploadPhoto.mock.calls[0] as [
      File,
      PhotoCorrespondence[],
      ManualPlacement,
      undefined,
      { dsoIds: string[]; displayName: string },
    ];
    expect(file.name).toBe('M101.jpg');
    expect(correspondences).toHaveLength(3);
    expect(correspondences.every((c) => c.starRa !== undefined && c.starDec !== undefined)).toBe(
      true,
    );
    expect(placement).toMatchObject({ centerRa: 210.8, centerDec: 54.35, rotationDeg: 0 });
    expect(placement.projPerPx).toBeCloseTo(0.06 / 1000);
    expect(meta).toEqual({ dsoIds: ['M101', 'NGC5474'], displayName: 'M101' });
    expect(pendingPhotos.value.find((p) => p.id === pending.id)).toBeUndefined();
    expect(w.emitted('placed')).toEqual([[{ id: 'p9' }]]);
  });

  it('keeps the photo waiting and shows the error when it cannot be stored', async () => {
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    const { w, pending } = await mountPlacement();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Valider')!
      .trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(pendingPhotos.value.some((p) => p.id === pending.id)).toBe(true);
    expect(w.emitted('placed')).toBeUndefined();
  });

  it('goes along to a searched object at the same size on screen, then keeps to the sky again', async () => {
    vi.useFakeTimers();
    try {
      const { w, img } = await mountPlacement();
      const before = matrixOf(img);
      expect(w.find('.mob-placing-search').exists()).toBe(true);
      await w.find('.mob-placing-search .mob-search').trigger('click');
      expect(w.emitted('search')).toHaveLength(1);
      // The search zooms in four times on NGC 5474.
      const target = project(211.2575, 53.6623);
      const zoomed = { ...VIEW, centerX: target.x, centerY: target.y, scale: 4000 };
      const centre = map.viewCenterSky;
      (w.vm as unknown as { follow(move: () => void): void }).follow(() => {
        map.getView = () => zoomed;
        map.viewCenterSky = () => ({ ra: 211.2575, dec: 53.6623 });
        viewListener?.();
      });
      await flushPromises();
      const after = matrixOf(img);
      // Same size and place on screen; "Zoom photo" still reads 100 %.
      expect(after[0]).toBeCloseTo(before[0]);
      expect(after[4]).toBeCloseTo(before[4], 0);
      expect(after[5]).toBeCloseTo(before[5], 0);
      expect(values(w)[1]).toBe('100 %');
      // Once the map has stopped, a zoom of the map makes the photo larger with the sky again.
      vi.advanceTimersByTime(400);
      map.getView = () => ({ ...zoomed, scale: 8000 });
      viewListener?.();
      await flushPromises();
      expect(matrixOf(img)[0]).toBeCloseTo(before[0] * 2);
      map.getView = () => VIEW;
      map.viewCenterSky = centre;
    } finally {
      vi.useRealTimers();
    }
  });

  it('folds its settings down to the handle and the buttons, by a tap or a drag, and opens again', async () => {
    // In portrait (the test window is wider than tall).
    const media = window.matchMedia;
    window.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { w } = await mountPlacement();
    const grab = () => w.find('.mob-placing-grab .mob-sheet-grab');
    const shown = () => !w.find('.mob-placing-fold').classes().includes('mob-placing-fold--closed');
    expect(grab().attributes('aria-label')).toBe('Masquer les réglages');
    await grab().trigger('click');
    expect(shown()).toBe(false);
    expect(grab().attributes('aria-label')).toBe('Afficher les réglages');
    expect(w.findAll('.mob-sheet-footer button').map((b) => b.text())).toEqual([
      'Annuler',
      'Valider',
    ]);
    await grab().trigger('click');
    expect(shown()).toBe(true);
    // A drag down from the handle folds it; the click that ends the drag does not open it again.
    const handle = w.find('.mob-placing-grab');
    await handle.trigger('pointerdown', { clientY: 100 });
    await handle.trigger('pointermove', { clientY: 170 });
    await handle.trigger('pointerup', { clientY: 170 });
    await grab().trigger('click');
    expect(shown()).toBe(false);
    await handle.trigger('pointerdown', { clientY: 170 });
    await handle.trigger('pointermove', { clientY: 100 });
    expect(shown()).toBe(true);
    // Open, a drag up takes it to two thirds; a drag down takes it back to a third, still open, then folds it.
    const expanded = () => w.find('.mob-placing-panel').classes().includes('mob-sheet--expanded');
    expect(expanded()).toBe(false);
    await handle.trigger('pointerdown', { clientY: 170 });
    await handle.trigger('pointermove', { clientY: 100 });
    expect(expanded()).toBe(true);
    await handle.trigger('pointerdown', { clientY: 100 });
    await handle.trigger('pointermove', { clientY: 170 });
    expect(expanded()).toBe(false);
    expect(shown()).toBe(true);
    await handle.trigger('pointerdown', { clientY: 100 });
    await handle.trigger('pointermove', { clientY: 170 });
    expect(shown()).toBe(false);
    window.matchMedia = media;
  });

  it('gives up with Annuler', async () => {
    const { w } = await mountPlacement();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Annuler')!
      .trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});

/** Repositionner: a placed photo moved again on the same screen. */
describe('repositioning a placed photo', () => {
  const PLACED: ManualPlacement = {
    centerRa: 210.8,
    centerDec: 54.35,
    rotationDeg: 20,
    projPerPx: 0.0001,
    mirrorX: false,
    mirrorY: false,
    angleOnSky: true,
  };
  const PHOTO = {
    id: 'p1',
    filename: 'p1.jpg',
    mediumFilename: 'p1-medium.jpg',
    originalName: 'M101.jpg',
    width: 4000,
    height: 2000,
    correspondences: [],
    manualPlacement: PLACED,
  } as unknown as Photo;
  const layer = { hidePhoto: vi.fn(), unhidePhoto: vi.fn(), replacePhoto: vi.fn() };

  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    uploadPhoto.mockReset();
    updatePhotoManualPlacement.mockReset().mockResolvedValue(undefined);
    showError.mockReset();
    Object.values(layer).forEach((f) => f.mockReset());
    mapEl.innerHTML = '';
  });

  async function mountReposition() {
    const w = mount(SkyPlacement, {
      props: { map: map as never, mapEl, photo: PHOTO, layer: layer as never, onView },
      global: { stubs: ionicStubs },
    });
    await flushPromises();
    const img = mapEl.querySelector('img.mob-placing-photo') as HTMLImageElement;
    // The medium copy loads, smaller than the photo.
    Object.defineProperty(img, 'naturalWidth', { value: 1000 });
    Object.defineProperty(img, 'naturalHeight', { value: 500 });
    img.dispatchEvent(new Event('load'));
    await flushPromises();
    return { w, img };
  }
  const click = (w: Awaited<ReturnType<typeof mountReposition>>['w'], text: string) =>
    w
      .findAll('button')
      .find((b) => b.text() === text)!
      .trigger('click');

  it('starts where the photo is, at 100 %, hidden on the map, its copy at the full size', async () => {
    const { w, img } = await mountReposition();
    expect(layer.hidePhoto).toHaveBeenCalledWith('p1');
    expect(img.getAttribute('src')).toBe('/uploads/p1-medium.jpg');
    expect(img.style.width).toBe('4000px');
    expect(img.style.height).toBe('2000px');
    expect(values(w).slice(0, 2)).toEqual(['20°', '100 %']);
    const [a, b, , , e, f] = matrixOf(img);
    // 0.0001 projection units per pixel at a scale of 1000, turned by 20°, centred on the map.
    expect(Math.hypot(a, b)).toBeCloseTo(0.1);
    expect(Math.atan2(b, a) * (180 / Math.PI)).toBeCloseTo(20);
    expect(e + a * 2000 + matrixOf(img)[2] * 1000).toBeCloseTo(200, 0);
    expect(f + b * 2000 + matrixOf(img)[3] * 1000).toBeCloseTo(250, 0);
  });

  it('brings a photo out of the map (under the panel) to its middle, at the same zoom', async () => {
    // The photo's centre one map width to the right of the view's centre.
    const away = project(210.8, 54.35);
    const view = { ...VIEW, centerX: away.x - 400 / VIEW.scale };
    const panBy = vi.fn();
    Object.assign(map, { getView: () => view, panBy });
    try {
      await mountReposition();
      expect(panBy).toHaveBeenCalledTimes(1);
      const [dx, dy] = panBy.mock.calls[0] as [number, number];
      expect(dx).toBeCloseTo(400, 0);
      expect(dy).toBeCloseTo(0, 0);
    } finally {
      Object.assign(map, { getView: () => VIEW });
    }
  });

  it('stores the new placement only, and shows the photo there on the map', async () => {
    const { w, img } = await mountReposition();
    const [a, b, c, d, e, f] = matrixOf(img);
    const centre = { x: e + a * 2000 + c * 1000, y: f + b * 2000 + d * 1000 };
    pointer(img, 'pointerdown', 1, centre.x, centre.y);
    pointer(img, 'pointermove', 1, centre.x + 40, centre.y);
    pointer(img, 'pointerup', 1, centre.x + 40, centre.y);
    await click(w, 'Valider');
    await flushPromises();
    expect(uploadPhoto).not.toHaveBeenCalled();
    const [id, placement] = updatePhotoManualPlacement.mock.calls[0] as [string, ManualPlacement];
    expect(id).toBe('p1');
    expect(placement).toMatchObject({ rotationDeg: 20, projPerPx: 0.0001, angleOnSky: true });
    expect(placement.centerRa).not.toBeCloseTo(PLACED.centerRa, 3);
    const moved = { ...PHOTO, manualPlacement: placement };
    expect(layer.replacePhoto).toHaveBeenCalledWith(moved);
    expect(w.emitted('repositioned')).toEqual([[moved]]);
    w.unmount();
    expect(layer.unhidePhoto).toHaveBeenCalledWith('p1');
  });

  it('leaves the photo as it was with Annuler, or when it cannot be stored', async () => {
    updatePhotoManualPlacement.mockRejectedValue(new Error('offline'));
    const { w } = await mountReposition();
    await click(w, 'Valider');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(layer.replacePhoto).not.toHaveBeenCalled();
    expect(w.emitted('repositioned')).toBeUndefined();
    await click(w, 'Annuler');
    expect(w.emitted('cancel')).toHaveLength(1);
    w.unmount();
    expect(layer.unhidePhoto).toHaveBeenCalledWith('p1');
  });
});
