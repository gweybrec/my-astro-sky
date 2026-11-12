import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const deletePhotoAPI = vi.fn();
const rotatePhotoAPI = vi.fn();
const solveWCS = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  rotatePhotoAPI: (...a: unknown[]) => rotatePhotoAPI(...a),
  solveWCS: (...a: unknown[]) => solveWCS(...a),
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
  photoFileUrl: (name: string) => `/uploads/${name}`,
}));

const replace = vi.fn();
// Ionic calls a page's "will enter" each time it shows again; a test calls the ones kept here to come back to the page.
const enters: Array<() => unknown> = [];
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  onIonViewWillEnter: (fn: () => unknown) => {
    enters.push(fn);
  },
}));
const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push, back: vi.fn() }),
  useRoute: () => ({ params: { id: 'p1' } }),
}));

const setStatusBarHidden = vi.fn();
const pickFile = vi.fn();
vi.mock('../src/platform-device', () => ({
  setStatusBarHidden: (hidden: boolean) => setStatusBarHidden(hidden),
  pickFile: (...a: unknown[]) => pickFile(...a),
  WCS_FILE_TYPES: { mimeTypes: [], extensions: ['.fits'] },
}));

const confirm = vi.fn();
const showError = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
// A solved photo has a sky matrix; the drawing and the sky lookups are stand-ins that record what they are asked.
const solved = { value: true };
vi.mock('@myastrosky/core/photo-placement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/photo-placement')>()),
  computePhotoToProjMatrix: () => (solved.value ? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } : null),
}));
const findDsoPlacementsInImage = vi.fn();
const drawPhotoOverlay = vi.fn();
vi.mock('@myastrosky/render/photo-dso-overlay-render', () => ({
  drawPhotoOverlay: (...a: unknown[]) => drawPhotoOverlay(...a),
}));
vi.mock('@myastrosky/render/poi-pins', () => ({
  poiPinsInImage: (pois: { name: string; ra?: number }[]) =>
    pois.filter((p) => p.ra !== undefined).map((poi) => ({ poi, x: 10, y: 10 })),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));

vi.mock('@myastrosky/core/catalog/dso-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/catalog/dso-registry')>()),
  findDsoPlacementsInImage: (...a: unknown[]) => findDsoPlacementsInImage(...a),
  getDSOById: (id: string) =>
    id === 'M31'
      ? {
          id: 'M31',
          catalogs: ['M31'],
          displayName: "Galaxie d'Andromède",
          type: 'GxS',
          constellation: 'And',
        }
      : undefined,
}));

import PhotoPage from '../src/pages/PhotoPage.vue';
import PhotoInfoSheet from '../src/pages/gallery/PhotoInfoSheet.vue';
import SkyCheckSheet from '../src/pages/sky/SkyCheckSheet.vue';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { setAutoRotateLandscape } from '../src/photo-display';
import { skyPhotoFocus } from '../src/composables/useSkySelection';
import { pendingWcs } from '../src/composables/useWcsLoad';
import {
  clearGalleryFilters,
  galleryFilters,
  gallerySort,
  takeLastViewedPhoto,
} from '../src/gallery-display';

/** "Photo, détail", "Photo, zoom", "Photo, informations", "Photo, boutons d'affichage", "Photo, barres masquées". */

const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    filename: 'm31.jpg',
    originalName: 'M31_2025-09-14_stack.jpg',
    width: 4000,
    height: 2000,
    dsoIds: ['M31', 'M32'],
    observationDate: '2025-09-14T21:30:00.000Z',
    integrations: [
      { frames: 60, seconds: 180, filter: 'L' },
      { frames: 20, seconds: 240, filter: 'R' },
      { frames: 0, seconds: 120, filter: 'L' },
    ],
    gearSetupId: 's1',
    correspondences: [],
    ...over,
  }) as Photo;

const mountPage = () => mount(PhotoPage, { global: { stubs: ionicStubs } });
const button = (w: ReturnType<typeof mountPage>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;
/** A button of the sheet, named by its text. */
const labelled = (w: ReturnType<typeof mountPage>, text: string) =>
  w.findAll('.mob-photo-actions button').find((b) => b.text() === text)!;
const shown = (w: ReturnType<typeof mountPage>, selector: string) =>
  (w.find(selector).element as HTMLElement).style.display !== 'none';
/** An upright phone: happy-dom's window is wider than tall. */
const upright = () =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
const facts = (w: ReturnType<typeof mountPage>) =>
  w
    .findAll('.mob-fact')
    .map((f) => [f.find('.mob-fact-label').text(), f.find('.mob-fact-value').text()]);

describe("a photo's own screen", () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    getPhotos.mockReset().mockResolvedValue([photo()]);
    getGearSetups.mockReset().mockResolvedValue([{ id: 's1', name: 'Équipement 1' }]);
    deletePhotoAPI.mockReset().mockResolvedValue(undefined);
    confirm.mockReset().mockResolvedValue(true);
    showError.mockReset();
    replace.mockReset();
    push.mockReset();
    solved.value = true;
    skyPhotoFocus.value = null;
    pendingWcs.value = null;
    pickFile.mockReset();
    solveWCS.mockReset();
    configureStorage(createMemoryStore());
    // The photo is landscape: the tests that are not about it run without the screen's own turn.
    setAutoRotateLandscape(false);
    rotatePhotoAPI.mockReset();
    vi.unstubAllGlobals();
    setActivePinia(createPinia());
    findDsoPlacementsInImage.mockReset().mockReturnValue([{ dso: { id: 'M31' }, x: 5, y: 5 }]);
    drawPhotoOverlay.mockReset();
  });

  it("shows the photo whole under a top bar with the photo's name, and no reset button", async () => {
    const w = mountPage();
    await flushPromises();
    expect(w.find('h1').text()).toBe('M31_2025-09-14_stack.jpg');
    // The photo's area comes after the bar, not under it: nothing of the whole photo is hidden by the bar.
    expect(w.find('.mob-photo-bar + .mob-photo-area img.mob-photo-view').exists()).toBe(true);
    const picture = w.find('img.mob-photo-view');
    expect(picture.attributes('src')).toBe('/uploads/m31.jpg');
    expect(picture.attributes('alt')).toBe('M31_2025-09-14_stack.jpg');
    expect(w.findAll('.mob-topbar--overlay button').map((b) => b.attributes('aria-label'))).toEqual(
      ['Retour', 'Affichage'],
    );
    expect(button(w, 'Réinitialiser le zoom')).toBeUndefined();
  });

  it('"Affichage" opens and closes the column of buttons under it', async () => {
    const w = mountPage();
    await flushPromises();
    expect(button(w, 'Affichage').attributes('aria-expanded')).toBe('false');
    expect(shown(w, '.mob-photo-buttons')).toBe(false);
    await button(w, 'Affichage').trigger('click');
    expect(button(w, 'Affichage').attributes('aria-expanded')).toBe('true');
    expect(shown(w, '.mob-photo-buttons')).toBe(true);
    expect(w.findAll('.mob-photo-buttons button').map((b) => b.attributes('aria-label'))).toEqual([
      'Voir sur la carte',
      'Afficher les objets',
      "Afficher les points d'intérêt",
      'Faire pivoter à droite',
      'Informations sur la photo',
    ]);
    await button(w, 'Affichage').trigger('click');
    expect(shown(w, '.mob-photo-buttons')).toBe(false);
  });

  it('one tap on the photo hides the bar and the buttons, another brings them back; a double tap still zooms', async () => {
    const w = mountPage();
    await flushPromises();
    await button(w, 'Affichage').trigger('click');
    const stage = w.find('.mob-photo-stage');
    (w.find('.mob-photo-area').element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800 }) as DOMRect;
    const tap = (at: number) => {
      const init = { pointerId: 1, clientX: 200, clientY: 400 };
      const down = new PointerEvent('pointerdown', init);
      const up = new PointerEvent('pointerup', init);
      Object.defineProperty(down, 'timeStamp', { value: at });
      Object.defineProperty(up, 'timeStamp', { value: at + 40 });
      stage.element.dispatchEvent(down);
      stage.element.dispatchEvent(up);
    };
    const later = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
    };
    // The bar keeps its place when hidden (only its content goes), so the photo under it does not move.
    const barHidden = () => w.find('.mob-photo-bar').classes('mob-photo-bar--hidden');
    tap(0);
    await later();
    expect(barHidden()).toBe(true);
    expect(shown(w, '.mob-photo-bar')).toBe(true);
    expect(shown(w, '.mob-photo-buttons')).toBe(false);
    tap(1000);
    await later();
    expect(barHidden()).toBe(false);
    expect(shown(w, '.mob-photo-buttons')).toBe(true);
    // two taps close together zoom and leave the bars as they are
    tap(5000);
    tap(5120);
    await later();
    expect(w.find('img.mob-photo-view').attributes('style')).toContain('scale(3)');
    expect(barHidden()).toBe(false);
  });

  it('shows the name of the photo when the picture cannot be read', async () => {
    getPhotos.mockResolvedValue([photo({ dsoIds: [] })]);
    const w = mountPage();
    await flushPromises();
    expect(w.find('h1').text()).toBe('M31_2025-09-14_stack.jpg');
    await w.find('img.mob-photo-view').trigger('error');
    expect(w.find('img.mob-photo-view').exists()).toBe(false);
    expect(w.find('.mob-stage-caption').text()).toBe('M31_2025-09-14_stack.jpg');
  });

  it("gives Android's status bar back when the page goes away", async () => {
    setStatusBarHidden.mockClear();
    const w = mountPage();
    await flushPromises();
    w.unmount();
    expect(setStatusBarHidden).toHaveBeenLastCalledWith(false);
  });

  it('goes back to the gallery when the photo no longer exists', async () => {
    getPhotos.mockResolvedValue([]);
    mountPage();
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('shows the button that resets the zoom only while the photo is zoomed', async () => {
    const w = mountPage();
    await flushPromises();
    const stage = w.find('.mob-photo-stage');
    (w.find('.mob-photo-area').element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800 }) as DOMRect;
    const tap = async (at: number) => {
      const init = { pointerId: 1, clientX: 200, clientY: 400 };
      const down = new PointerEvent('pointerdown', init);
      const up = new PointerEvent('pointerup', init);
      Object.defineProperty(down, 'timeStamp', { value: at });
      Object.defineProperty(up, 'timeStamp', { value: at + 40 });
      stage.element.dispatchEvent(down);
      stage.element.dispatchEvent(up);
      await flushPromises();
    };
    await tap(0);
    await tap(120);
    expect(w.find('img.mob-photo-view').attributes('style')).toContain('scale(3)');
    await button(w, 'Réinitialiser le zoom').trigger('click');
    expect(w.find('img.mob-photo-view').attributes('style')).toContain('scale(1)');
    expect(button(w, 'Réinitialiser le zoom')).toBeUndefined();
  });

  it('lists what is known of the photo, read only, values written as the desktop writes them', async () => {
    getPhotos.mockResolvedValue([
      photo({
        captureDetails: { gain: 100, ccdTemp: -10 },
        labels: ['Seestar', 'Mosaïque'],
        pointsOfInterest: [
          { name: 'C/2023 A3', categoryId: 'cat-comet' },
        ] as Photo['pointsOfInterest'],
        notes: ' Nuit claire. ',
      }),
    ]);
    const w = mountPage();
    await flushPromises();
    await button(w, 'Informations sur la photo').trigger('click');
    expect(w.findComponent(PhotoInfoSheet).props('open')).toBe(true);
    expect(w.find('.mob-sheet-title').text()).toBe("Galaxie d'Andromède");
    expect(w.find('.mob-sheet .mob-meta').text()).toContain('M31');
    expect(w.findAll('.mob-sheet .mob-badge').map((b) => b.text())).toEqual([
      'Galaxie spirale',
      'AND',
    ]);
    // 60 x 180 s + 20 x 240 s = 4 h 20; the row without frames does not count.
    expect(facts(w)).toEqual([
      ['Nom du fichier', 'M31_2025-09-14_stack.jpg'],
      ["Date d'observation", '14 sept. 2025'],
      ['Exposition totale', '4h20'],
      ['Gain', '100'],
      ['Temp. capteur', '-10 °C'],
      ['Équipement', 'Équipement 1'],
      ['Intégration', 'L 60 × 180 s · R 20 × 240 s'],
      ['Étiquettes', 'Seestar · Mosaïque'],
      ["Points d'intérêt", 'C/2023 A3'],
      ['Notes', 'Nuit claire.'],
    ]);
    // its objects are compact chips above the facts, as on the map's photo sheet, that only show them (no tap)
    const chips = w.findAll('.mob-sheet .mob-pager .mob-chip');
    expect(chips.map((c) => c.text())).toEqual(['M31', 'M32']);
    expect(
      chips.every((c) => c.classes('mob-chip--still') && c.attributes('role') === undefined),
    ).toBe(true);
    expect(chips.every((c) => c.attributes('tabindex') === undefined)).toBe(true);
    // facts without cards, none on a line of its own, the integration rows in the mono face; the sheet is
    // a third of the screen at most in portrait
    expect(w.find('.mob-facts').classes()).toEqual(['mob-facts', 'mob-photo-facts']);
    expect(w.findAll('.mob-fact--wide')).toHaveLength(0);
    // 8 px under the title: the photo sheets' own spacing (the target pages put their facts right under the badges)
    expect(w.find('.mob-facts').classes()).toContain('mob-photo-facts');
    expect(w.find('.mob-fact-value .m-mono').text()).toBe('L 60 × 180 s · R 20 × 240 s');
    expect(w.find('.mob-sheet-modal').classes()).toContain('mob-sheet-modal--third');
    expect(w.findAll('.mob-photo-actions button').map((b) => b.text())).toEqual([
      'Charger un fichier WCS (fits/tiff)',
      'Modifier',
      'Supprimer',
    ]);
  });

  it('leaves out what the photo does not have, and is titled with the file without an object', async () => {
    getPhotos.mockResolvedValue([
      photo({ dsoIds: [], observationDate: null, integrations: [], gearSetupId: null }),
    ]);
    const w = mountPage();
    await flushPromises();
    expect(w.find('.mob-sheet-title').text()).toBe('M31_2025-09-14_stack.jpg');
    expect(w.find('.mob-sheet .mob-meta').exists()).toBe(false);
    expect(facts(w)).toEqual([['Nom du fichier', 'M31_2025-09-14_stack.jpg']]);
    expect(getGearSetups).not.toHaveBeenCalled();
  });

  it('"Voir sur la carte" leaves the photo for the Ciel tab and asks the map to frame it', async () => {
    const w = mountPage();
    await flushPromises();
    await button(w, 'Voir sur la carte').trigger('click');
    expect(skyPhotoFocus.value).toBe('p1');
    expect(replace).toHaveBeenCalledWith('/tabs/sky');
  });

  it('deletes the photo after a confirmation and goes back to the gallery', async () => {
    const w = mountPage();
    await flushPromises();
    confirm.mockResolvedValueOnce(false);
    await labelled(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(deletePhotoAPI).not.toHaveBeenCalled();
    await labelled(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[1][0].message).toContain('M31_2025-09-14_stack.jpg');
    expect(deletePhotoAPI).toHaveBeenCalledWith('p1');
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps the photo when the deletion fails, and says so', async () => {
    deletePhotoAPI.mockRejectedValue(new Error('disk'));
    const w = mountPage();
    await flushPromises();
    await labelled(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('turns the photo right from its buttons and shows it turned, whole again', async () => {
    rotatePhotoAPI.mockResolvedValue(photo({ quarterTurns: 1 }));
    const w = mountPage();
    await flushPromises();
    const turn = button(w, 'Faire pivoter à droite');
    // a quarter arc with its arrow (docs/dev/curved-arrow-svg.md), not the reload circle
    expect(turn.html()).toContain('A 13 13 0 0 1 18 19');
    await turn.trigger('click');
    await flushPromises();
    expect(rotatePhotoAPI).toHaveBeenCalledWith('p1');
    // the same picture, laid out on its side and turned a quarter
    const view = w.find('.mob-photo-view');
    expect(view.attributes('src')).toBe('/uploads/m31.jpg');
    expect(view.classes()).toContain('mob-photo-view--sideways');
    expect(view.attributes('style')).toContain('rotate(90deg)');
  });

  it('shows a landscape photo turned a quarter on an upright phone, without saving any rotation', async () => {
    setAutoRotateLandscape(true);
    upright();
    const w = mountPage();
    await flushPromises();
    const view = w.find('.mob-photo-view');
    expect(view.classes()).toContain('mob-photo-view--sideways');
    expect(view.attributes('style')).toContain('rotate(90deg)');
    expect(rotatePhotoAPI).not.toHaveBeenCalled();
  });

  it("shows a photo the user turned with its own rotation, not the screen's", async () => {
    setAutoRotateLandscape(true);
    upright();
    getPhotos.mockResolvedValue([photo({ quarterTurns: 2 })]);
    const w = mountPage();
    await flushPromises();
    const view = w.find('.mob-photo-view');
    expect(view.classes()).not.toContain('mob-photo-view--sideways');
    expect(view.attributes('style')).toContain('rotate(180deg)');
  });

  it('turns a photo the screen turned a quarter further than what is seen', async () => {
    setAutoRotateLandscape(true);
    upright();
    rotatePhotoAPI
      .mockResolvedValueOnce(photo({ quarterTurns: 1 }))
      .mockResolvedValueOnce(photo({ quarterTurns: 2 }));
    const w = mountPage();
    await flushPromises();
    await button(w, 'Faire pivoter à droite').trigger('click');
    await flushPromises();
    // shown a quarter (the screen's), saved none: two quarters saved, so it now shows half a turn
    expect(rotatePhotoAPI).toHaveBeenCalledTimes(2);
    expect(w.find('.mob-photo-view').attributes('style')).toContain('rotate(180deg)');
  });

  it('keeps the photo and says so when it cannot be turned', async () => {
    rotatePhotoAPI.mockRejectedValue(new Error('disk'));
    const w = mountPage();
    await flushPromises();
    await button(w, 'Faire pivoter à droite').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(w.find('.mob-photo-view').attributes('src')).toBe('/uploads/m31.jpg');
    expect(button(w, 'Faire pivoter à droite').attributes('disabled')).toBeUndefined();
  });

  it('opens the edit page of the photo from the sheet', async () => {
    push.mockReset();
    const w = mountPage();
    await flushPromises();
    await labelled(w, 'Modifier').trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/photo/p1/edit');
  });

  it('reads a WCS file from the sheet, then opens the editor with what it found', async () => {
    const file = new File(['x'], 'm31.fits');
    pickFile.mockResolvedValue(file);
    const result = { success: true, dateObs: '2025-09-14T21:30:00Z' };
    solveWCS.mockResolvedValue(result);
    const w = mountPage();
    await flushPromises();
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    // the photo's size, so that the solution is scaled to the photo
    expect(solveWCS).toHaveBeenCalledWith(file, 4000, 2000);
    expect(pendingWcs.value).toEqual({ photoId: 'p1', result });
    expect(push).toHaveBeenCalledWith('/gallery/photo/p1/edit');
  });

  it('stays on the photo when the WCS file is not chosen or cannot be read', async () => {
    const w = mountPage();
    await flushPromises();
    pickFile.mockResolvedValueOnce(null);
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    expect(solveWCS).not.toHaveBeenCalled();
    pickFile.mockResolvedValueOnce(new File(['x'], 'bad.fits'));
    solveWCS.mockResolvedValueOnce({ success: false, code: 'NO_WCS' });
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(pendingWcs.value).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('explains a file that was not plate-solved, with its name', async () => {
    const w = mountPage();
    await flushPromises();
    pickFile.mockResolvedValueOnce(new File(['x'], 'brut.fits'));
    solveWCS.mockResolvedValueOnce({ success: false, code: 'NO_WCS_DATA' });
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    expect(showError.mock.calls.at(-1)?.[0]).toContain('brut.fits');
    expect(showError.mock.calls.at(-1)?.[0]).toContain('Siril');
  });

  it("asks before taking a file whose proportions differ from the photo's", async () => {
    const w = mountPage();
    await flushPromises();
    const result = {
      success: true,
      dateObs: '2025-09-14T21:30:00Z',
      dimensionWarning: {
        sourceW: 3000,
        sourceH: 3000,
        targetW: 4000,
        targetH: 2000,
        aspectMismatch: true,
      },
    };
    pickFile.mockResolvedValue(new File(['x'], 'autre.fits'));
    solveWCS.mockResolvedValue(result);
    confirm.mockResolvedValueOnce(false);
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Continuer quand même' }),
    );
    expect(pendingWcs.value).toBeNull();
    expect(push).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await labelled(w, 'Charger un fichier WCS (fits/tiff)').trigger('click');
    await flushPromises();
    expect(pendingWcs.value).toEqual({ photoId: 'p1', result });
  });

  describe('the objects and points of interest drawn over the photo ("Photo, objets affichés")', () => {
    beforeEach(() => {
      // The photo's area has a size, and its canvas a context, as in a browser.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 400,
        height: 800,
      } as DOMRect);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        new Proxy({}, { get: () => vi.fn() }) as unknown as CanvasRenderingContext2D,
      );
    });
    const pressed = (w: ReturnType<typeof mountPage>, name: string) =>
      button(w, name).attributes('aria-pressed');

    it("draws the objects of the map's catalogues once their toggle is on, and offers the catalogues meanwhile", async () => {
      useDisplayStore().setDsoCatalogs(['M']);
      const w = mountPage();
      await flushPromises();
      await button(w, 'Informations sur la photo').trigger('click');
      expect(pressed(w, 'Afficher les objets')).toBe('false');
      expect(drawPhotoOverlay).not.toHaveBeenCalled();
      expect(w.find('button[aria-label^="Catalogues"]').exists()).toBe(false);

      await button(w, 'Afficher les objets').trigger('click');
      await flushPromises();
      expect(pressed(w, 'Afficher les objets')).toBe('true');
      expect(findDsoPlacementsInImage.mock.lastCall![3]).toEqual(new Set(['M']));
      const drawn = drawPhotoOverlay.mock.lastCall![1];
      expect(drawn.placements).toHaveLength(1);
      expect(drawn.pins).toEqual([]);
      // 4000 px wide photo fitted in a 400 px wide area
      expect(drawn.dispScale).toBeCloseTo(0.1);

      const field = w.find('button[aria-label^="Catalogues"]');
      await field.trigger('click');
      const sheet = w
        .findAllComponents(SkyCheckSheet)
        .find((c) => c.props('title') === 'Catalogues')!;
      expect(sheet.props('open')).toBe(true);
      sheet.vm.$emit('update:selected', ['M', 'NGC']);
      await flushPromises();
      expect(findDsoPlacementsInImage.mock.lastCall![3]).toEqual(new Set(['M', 'NGC']));
      // the map's own choice is not changed
      expect(useDisplayStore().dsoCatalogs).toEqual(['M']);

      await button(w, 'Afficher les objets').trigger('click');
      await flushPromises();
      expect(w.find('button[aria-label^="Catalogues"]').exists()).toBe(false);
    });

    it('pins the points of interest that have a sky position', async () => {
      getPhotos.mockResolvedValue([
        photo({
          pointsOfInterest: [
            { name: 'C/2023 A3', categoryId: 'cat-comet', ra: 10, dec: 20 },
            { name: 'Sans position', categoryId: 'cat-comet' },
          ] as Photo['pointsOfInterest'],
        }),
      ]);
      const w = mountPage();
      await flushPromises();
      await button(w, "Afficher les points d'intérêt").trigger('click');
      await flushPromises();
      const drawn = drawPhotoOverlay.mock.lastCall![1];
      expect(drawn.placements).toEqual([]);
      expect(drawn.pins.map((p: { poi: { name: string } }) => p.poi.name)).toEqual(['C/2023 A3']);
    });

    it('cannot draw objects on a photo not placed on the sky, nor points of interest without a position', async () => {
      solved.value = false;
      const w = mountPage();
      await flushPromises();
      expect(button(w, 'Afficher les objets').attributes('disabled')).toBeDefined();
      expect(button(w, "Afficher les points d'intérêt").attributes('disabled')).toBeDefined();
    });
  });

  describe('swiping to the next or previous photo ("Photo, glisser vers la suivante")', () => {
    // Three photos, by name: a, p1 (the one opened), c; one more that the gallery's search leaves out.
    const three = () => [
      photo({ id: 'c', originalName: 'c.jpg', filename: 'c.jpg', thumbFilename: 'c-thumb.jpg' }),
      photo({ id: 'p1', originalName: 'b.jpg' }),
      photo({ id: 'a', originalName: 'a.jpg', filename: 'a.jpg' }),
      photo({ id: 'x', originalName: 'hidden.png', filename: 'x.png', labels: [], notes: '' }),
    ];
    beforeEach(() => {
      getPhotos.mockResolvedValue(three());
      gallerySort.value = 'name-asc';
      clearGalleryFilters();
      galleryFilters.query = '.jpg';
      takeLastViewedPhoto();
    });

    /** A pointer event on the stage, at a given time (ms). */
    async function fire(w: ReturnType<typeof mountPage>, type: string, x: number, at: number) {
      const event = new Event(type, { bubbles: true });
      for (const [key, value] of Object.entries({
        pointerId: 1,
        clientX: x,
        clientY: 400,
        timeStamp: at,
      }))
        Object.defineProperty(event, key, { value });
      w.find('.mob-photo-stage').element.dispatchEvent(event);
      await flushPromises();
    }
    /** Drags one finger sideways over the stage by `dx`, slowly (no flick), then lets go. */
    async function drag(w: ReturnType<typeof mountPage>, dx: number, up = true) {
      await fire(w, 'pointerdown', 200, 0);
      await fire(w, 'pointermove', 200 + dx / 2, 500);
      await fire(w, 'pointermove', 200 + dx, 1000);
      if (up) await fire(w, 'pointerup', 200 + dx, 1000);
    }
    const track = (w: ReturnType<typeof mountPage>) => w.find('.mob-photo-track');
    const slid = (w: ReturnType<typeof mountPage>) =>
      track(w).trigger('transitionend', { propertyName: 'transform' });
    /** The area is 400 px wide (happy-dom lays nothing out). */
    const sized = (w: ReturnType<typeof mountPage>) =>
      Object.defineProperty(w.find('.mob-photo-area').element, 'clientWidth', { value: 400 });

    /** The picture (not its thumbnail) of the pane on one side. */
    const picture = (w: ReturnType<typeof mountPage>, side: 'previous' | 'current' | 'next') =>
      w.find(`.mob-photo-pane--${side} img.mob-photo-view:last-of-type`);

    it("holds the neighbours in the gallery's order beside the photo, the next one with its thumbnail first", async () => {
      const w = mountPage();
      await flushPromises();
      const panes = w.findAll('.mob-photo-pane');
      expect(panes.map((p) => p.classes().find((c) => c.startsWith('mob-photo-pane--')))).toEqual([
        'mob-photo-pane--previous',
        'mob-photo-pane--current',
        'mob-photo-pane--next',
      ]);
      expect(panes[0].findAll('img').map((i) => i.attributes('src'))).toEqual(['/uploads/a.jpg']);
      expect(panes[2].findAll('img').map((i) => i.attributes('src'))).toEqual([
        '/uploads/c-thumb.jpg',
        '/uploads/c.jpg',
      ]);
      expect(panes[2].attributes('aria-hidden')).toBe('true');
      expect(panes[1].attributes('aria-hidden')).toBeUndefined();
    });

    it('keeps the picture that slid in as the photo: it is neither loaded nor drawn again', async () => {
      const w = mountPage();
      await flushPromises();
      sized(w);
      const incoming = picture(w, 'next').element;
      await drag(w, -200);
      await slid(w);
      expect(picture(w, 'current').element).toBe(incoming);
      expect(picture(w, 'current').attributes('alt')).toBe('c.jpg');
    });

    it("drops a photo's thumbnail once its picture is loaded", async () => {
      const w = mountPage();
      await flushPromises();
      expect(w.findAll('.mob-photo-pane--next img')).toHaveLength(2);
      await picture(w, 'next').trigger('load');
      expect(w.findAll('.mob-photo-pane--next img').map((i) => i.attributes('src'))).toEqual([
        '/uploads/c.jpg',
      ]);
    });

    it('follows the finger, slides to the next photo once let go past a third, on the same page and address', async () => {
      const w = mountPage();
      await flushPromises();
      sized(w);
      await drag(w, -150, false);
      expect(track(w).attributes('style')).toContain('translateX(-150px)');
      await fire(w, 'pointerup', 50, 1000);
      expect(track(w).classes()).toContain('mob-photo-track--settling');
      expect(track(w).attributes('style')).toContain('calc(-1 * (100% + var(--photo-swipe-gap)))');
      await slid(w);
      expect(w.find('h1').text()).toBe('c.jpg');
      // Another address would make Ionic open a new page, empty until it has loaded: the page stays.
      expect(replace).not.toHaveBeenCalled();
      expect(picture(w, 'current').attributes('src')).toBe('/uploads/c.jpg');
      expect(track(w).attributes('style') ?? '').not.toContain('translate');
      // c is the last photo the search keeps: no next one, the previous is b.
      expect(w.findAll('.mob-photo-pane').map((p) => p.classes())).toEqual([
        ['mob-photo-pane', 'mob-photo-pane--previous'],
        ['mob-photo-pane', 'mob-photo-pane--current'],
      ]);
      expect(takeLastViewedPhoto()).toBe('c');
    });

    it('goes to the previous photo the other way', async () => {
      const w = mountPage();
      await flushPromises();
      sized(w);
      await drag(w, 200);
      await slid(w);
      expect(w.find('h1').text()).toBe('a.jpg');
    });

    it('springs back when let go short of a third', async () => {
      const w = mountPage();
      await flushPromises();
      sized(w);
      await drag(w, -100);
      expect(track(w).attributes('style') ?? '').not.toContain('translate');
      expect(w.find('h1').text()).toBe('b.jpg');
      expect(replace).not.toHaveBeenCalled();
    });

    it('only gives a little past the first photo, and springs back', async () => {
      getPhotos.mockResolvedValue(three().filter((p) => p.id !== 'a'));
      const w = mountPage();
      await flushPromises();
      sized(w);
      await drag(w, 200, false);
      expect(track(w).attributes('style')).toContain('translateX(50px)');
      await fire(w, 'pointerup', 400, 1000);
      expect(track(w).attributes('style') ?? '').not.toContain('translate');
      expect(w.find('h1').text()).toBe('b.jpg');
    });

    it('does not change photo on a zoomed photo: the finger moves it', async () => {
      const w = mountPage();
      await flushPromises();
      sized(w);
      for (const at of [0, 100]) {
        await fire(w, 'pointerdown', 200, at);
        await fire(w, 'pointerup', 200, at + 20);
      }
      expect(w.find('[aria-label="Réinitialiser le zoom"]').exists()).toBe(true);
      await drag(w, -300);
      expect(track(w).attributes('style') ?? '').not.toContain('translate');
      expect(w.find('h1').text()).toBe('b.jpg');
    });

    it('has no neighbour for a photo the gallery does not show', async () => {
      galleryFilters.query = 'nothing';
      const w = mountPage();
      await flushPromises();
      expect(w.findAll('.mob-photo-pane').map((p) => p.classes())).toEqual([
        ['mob-photo-pane', 'mob-photo-pane--current'],
      ]);
      sized(w);
      await drag(w, -300);
      expect(w.find('h1').text()).toBe('b.jpg');
    });

    it('reloads the photo shown, not the one first opened, when the page shows again (back from its editor)', async () => {
      const before = enters.length;
      const w = mountPage();
      await flushPromises();
      sized(w);
      await drag(w, -200);
      await slid(w);
      getPhotos.mockResolvedValue(
        three().map((p) => (p.id === 'c' ? { ...p, originalName: 'c, edited.jpg' } : p)),
      );
      for (const enter of enters.slice(before)) await enter();
      await flushPromises();
      expect(w.find('h1').text()).toBe('c, edited.jpg');
    });
  });
});
