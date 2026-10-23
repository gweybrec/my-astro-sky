import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { PhotoCorrespondence } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const uploadPhoto = vi.fn();
const searchStarsAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  searchStarsAPI: (...a: unknown[]) => searchStarsAPI(...a),
}));
const findDSOsInImage = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOsInImage: (...a: unknown[]) => findDSOsInImage(...a),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

const route = { params: { id: '' }, fullPath: '' };
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace, back }),
  useRoute: () => route,
}));

import IdentifyStarsPage from '../src/pages/IdentifyStarsPage.vue';
import PhoneSearch from '../src/components/PhoneSearch.vue';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  pendingPhotos,
} from '../src/pending-photos';
import { skyStarPick } from '../src/sky-modes';
import { skyPhotoFocus } from '../src/composables/useSkySelection';
import { identifyPoints } from '../src/star-identify-session';

/** "Identifier les étoiles": a waiting photo placed by naming 2 or 3 of its stars. */

// The photo's area is 400 x 500; a 4000 x 2000 picture is fitted in it at a tenth, 400 x 200, centred.
const AREA = { left: 0, top: 0, width: 400, height: 500 };
globalThis.ResizeObserver = class {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback(
      [{ contentRect: { width: AREA.width, height: AREA.height } } as ResizeObserverEntry],
      this as never,
    );
  }
  unobserve() {}
  disconnect() {}
} as never;

async function mountPage() {
  const pending = await addPendingPhoto(new Blob(['jpg'], { type: 'image/jpeg' }), 'M101.jpg');
  route.params.id = pending.id;
  route.fullPath = `/gallery/identify/${pending.id}`;
  const w = mount(IdentifyStarsPage, { global: { stubs: ionicStubs }, attachTo: document.body });
  await flushPromises();
  const area = w.find('.mob-photo-area').element as HTMLElement;
  area.getBoundingClientRect = () => AREA as DOMRect;
  const img = w.find('img.mob-photo-view').element as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 4000 });
  Object.defineProperty(img, 'naturalHeight', { value: 2000 });
  img.dispatchEvent(new Event('load'));
  await flushPromises();
  return { w, pending };
}

const pointer = (el: Element, type: string, x: number, y: number, id = 1) =>
  el.dispatchEvent(
    new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }),
  );

/** A tap on the photo's stage at a screen position. */
async function tap(w: VueWrapper, x: number, y: number) {
  const stage = w.find('.mob-photo-stage').element;
  pointer(stage, 'pointerdown', x, y);
  pointer(stage, 'pointerup', x, y);
  await flushPromises();
}

/** A row's text, its parts (number, name, value) apart. */
const partsOf = (el: Element) =>
  [...el.children]
    .map((c) => c.textContent!.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
const rowTexts = (w: VueWrapper) =>
  w.findAll('.mob-identify-point:not([style*="none"]) > *').map((r) => partsOf(r.element));
const validateButton = (w: VueWrapper) =>
  w.findAll('.mob-sheet-footer button').find((b) => b.text() === 'Valider')!;

async function nameByCoordinates(w: VueWrapper, values: string[]) {
  await w
    .findAll('button')
    .find((b) => b.text() === 'RA/Déc')!
    .trigger('click');
  const fields = w.findAll('.mob-coord input');
  for (const [i, value] of values.entries()) await fields[i].setValue(value);
  await w
    .findAll('.mob-coord button')
    .find((b) => b.text() === 'OK')!
    .trigger('click');
  await flushPromises();
}

describe('identifying the stars of a waiting photo', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configurePendingStore(createMemoryPendingStore());
    uploadPhoto.mockReset().mockResolvedValue({ id: 'p9' });
    searchStarsAPI.mockReset().mockResolvedValue([]);
    findDSOsInImage.mockReset().mockReturnValue([{ id: 'M101' }]);
    showError.mockReset();
    push.mockReset();
    replace.mockReset();
    back.mockReset();
    skyStarPick.value = null;
    skyPhotoFocus.value = null;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:photo');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('shows the photo, three points to place and the instructions; Valider waits for two named points', async () => {
    const { w } = await mountPage();
    expect(w.find('.mob-topbar-title').text()).toBe('Identifier les étoiles — M101');
    expect(rowTexts(w)).toEqual(['1 Touchez la photo…', '2 En attente', '3 En attente']);
    expect(w.find('.mob-helper').text()).toBe(
      'Touchez 2 ou 3 étoiles reconnaissables dans la photo, puis identifiez chacune par son nom ou ses coordonnées RA/Déc.',
    );
    expect(validateButton(w).attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('puts the first point where the photo is tapped, and moves it to the next tap until it is named', async () => {
    const { w, pending } = await mountPage();
    // Outside the picture (above it): nothing.
    await tap(w, 200, 100);
    expect(w.findAll('.mob-marker')).toHaveLength(0);
    await tap(w, 300, 300);
    const marker = w.find('.mob-marker');
    expect(marker.attributes('aria-label')).toBe('Point 1');
    expect(w.find('.mob-identify-anchor').attributes('style')).toContain('left: 300px; top: 300px');
    expect(identifyPoints(pending.id)[0].at).toEqual({ x: 3000, y: 1500 });
    // Placed: it is named by a star's name, on the map, or by its coordinates.
    expect(w.find('.mob-identify-points input').attributes('placeholder')).toBe("Nom de l'étoile…");
    expect(w.find('[aria-label="Choisir sur la carte"]').exists()).toBe(true);
    await tap(w, 100, 260);
    expect(identifyPoints(pending.id)[0].at).toEqual({ x: 1000, y: 1100 });
    expect(w.findAll('.mob-marker')).toHaveLength(1);
    w.unmount();
  });

  it('names a point by a star found by its name, listed alone above the field', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    searchStarsAPI.mockResolvedValue([
      { hip: 102098, label: 'Deneb – α Cyg', mag: 1.25, ra: 310.36, dec: 45.28, bv: 0, score: 1 },
      { hip: 57632, label: 'Denebola – β Leo', mag: 2.14, ra: 177.26, dec: 14.57, bv: 0, score: 1 },
    ]);
    const { w } = await mountPage();
    await tap(w, 300, 300);
    w.findComponent(PhoneSearch).vm.$emit('focus');
    await w.find('.mob-identify-points input').setValue('den');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(searchStarsAPI).toHaveBeenCalledWith('den');
    const options = w.findAll('[role="option"]');
    expect(options.map((o) => partsOf(o.element))).toEqual([
      'Deneb – α Cyg mag 1.3',
      'Denebola – β Leo mag 2.1',
    ]);
    // Only the point being named stays with the list; the other points and the buttons wait.
    expect(rowTexts(w)).toHaveLength(1);
    expect(w.find('.mob-sheet-footer').isVisible()).toBe(false);
    await options[0].trigger('click');
    vi.useRealTimers();
    await flushPromises();
    expect(rowTexts(w)).toEqual(['1 Deneb', '2 Touchez la photo…', '3 En attente']);
    expect(w.find('.mob-status--success').exists()).toBe(true);
    // A tap on a named point names it again.
    await w.findAll('.mob-identify-point > .mob-row')[0].trigger('click');
    expect(w.find('.mob-identify-points input').exists()).toBe(true);
    w.unmount();
  });

  it('names a point by its coordinates, and says when they are not valid', async () => {
    const { w } = await mountPage();
    await tap(w, 300, 300);
    await nameByCoordinates(w, ['20', '41', '25.9', '45', '16', '99']);
    expect(showError.mock.calls[0][0].message).toBe('Coordonnées invalides');
    await w.findAll('.mob-coord input')[5].setValue('49');
    await w
      .findAll('.mob-coord button')
      .find((b) => b.text() === 'OK')!
      .trigger('click');
    expect(rowTexts(w)[0]).toBe('1 RA 310.36 Déc 45.28');
    w.unmount();
  });

  it('names a point by a star chosen on the map', async () => {
    const { w } = await mountPage();
    await tap(w, 300, 300);
    await w.find('[aria-label="Choisir sur la carte"]').trigger('click');
    expect(skyStarPick.value?.point).toBe(1);
    // The map replaces the page, and opens it again afterwards.
    expect(replace).toHaveBeenCalledWith('/tabs/sky');
    expect(skyStarPick.value?.returnTo).toBe(route.fullPath);
    skyStarPick.value!.done({
      hip: 102098,
      ra: 310.36,
      dec: 45.28,
      mag: 1.25,
      bv: 0,
      name: 'Deneb',
      bayer: 'α',
      constellation: 'Cyg',
    });
    await flushPromises();
    expect(rowTexts(w)[0]).toBe('1 Deneb (α Cyg)');
    w.unmount();
  });

  it('moves a point under the finger, with the magnifier above it', async () => {
    const { w, pending } = await mountPage();
    await tap(w, 300, 300);
    const marker = w.find('.mob-marker').element;
    pointer(marker, 'pointerdown', 305, 305);
    await flushPromises();
    pointer(marker, 'pointermove', 255, 285);
    await flushPromises();
    expect(identifyPoints(pending.id)[0].at).toEqual({ x: 2500, y: 1300 });
    const magnifier = w.find('.mob-magnifier');
    // On the point, above the finger (the picture inside it is drawn by its background, which this test browser does not
    // keep).
    expect(w.find('.mob-identify-anchor').attributes('style')).toContain('left: 250px; top: 280px');
    expect(magnifier.classes()).toContain('mob-identify-above');
    pointer(marker, 'pointerup', 255, 285);
    await flushPromises();
    expect(w.find('.mob-magnifier').exists()).toBe(false);
    w.unmount();
  });

  it('stores the photo with its named points and the objects in it, then shows it on the map', async () => {
    const { w, pending } = await mountPage();
    await tap(w, 300, 300);
    await nameByCoordinates(w, ['14', '3', '12', '54', '20', '57']);
    await tap(w, 100, 260);
    await nameByCoordinates(w, ['14', '5', '1', '53', '39', '44']);
    expect(rowTexts(w)[2]).toBe('3 Touchez la photo…');
    await validateButton(w).trigger('click');
    await flushPromises();
    const [file, correspondences, manual, , meta] = uploadPhoto.mock.calls[0];
    expect((file as File).name).toBe('M101.jpg');
    expect(manual).toBeUndefined();
    expect(
      (correspondences as PhotoCorrespondence[]).map((c) => [
        c.pointIndex,
        c.photoX,
        c.photoY,
        c.starHip,
      ]),
    ).toEqual([
      [0, 3000, 1500, 0],
      [1, 1000, 1100, 0],
    ]);
    expect((correspondences as PhotoCorrespondence[])[0].starRa).toBeCloseTo(210.8, 1);
    expect(meta).toEqual({ dsoIds: ['M101'], displayName: 'M101' });
    expect(pendingPhotos.value).toHaveLength(0);
    expect(skyPhotoFocus.value).toBe('p9');
    expect(replace).toHaveBeenCalledWith('/tabs/sky');
    // The next identification of a photo starts again with no point.
    expect(identifyPoints(pending.id).every((p) => p.at === null)).toBe(true);
    w.unmount();
  });

  it('gives the identification up from the back arrow of its bar, as Annuler does', async () => {
    const { w } = await mountPage();
    await w.find('header.mob-topbar [aria-label="Retour"]').trigger('click');
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
    expect(pendingPhotos.value).toHaveLength(1);
    w.unmount();
  });

  it('keeps the photo waiting when the identification is given up', async () => {
    const { w } = await mountPage();
    await w
      .findAll('.mob-sheet-footer button')
      .find((b) => b.text() === 'Annuler')!
      .trigger('click');
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(pendingPhotos.value).toHaveLength(1);
    w.unmount();
  });
});
