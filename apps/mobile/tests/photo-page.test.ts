import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const deletePhotoAPI = vi.fn();
const rotatePhotoAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  rotatePhotoAPI: (...a: unknown[]) => rotatePhotoAPI(...a),
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
  photoFileUrl: (name: string) => `/uploads/${name}`,
}));

const replace = vi.fn();
const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push, back: vi.fn() }),
  useRoute: () => ({ params: { id: 'p1' } }),
}));

const setStatusBarHidden = vi.fn();
vi.mock('../src/platform-device', () => ({
  setStatusBarHidden: (hidden: boolean) => setStatusBarHidden(hidden),
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
import { skyPhotoFocus } from '../src/composables/useSkySelection';

/** "Photo, détail", "Photo, zoom" and "Photo, informations": a photo's own screen. */

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
    ...over,
  }) as Photo;

const mountPage = () => mount(PhotoPage, { global: { stubs: ionicStubs } });
const button = (w: ReturnType<typeof mountPage>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;
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
    configureStorage(createMemoryStore());
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
      ['Retour', 'Faire pivoter à droite', 'Informations sur la photo'],
    );
    expect(button(w, 'Réinitialiser le zoom')).toBeUndefined();
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
      ['Objets dans cette image', 'M31 · M32'],
    ]);
    // compact facts, the integration rows in the mono face; the sheet is a third of the screen at most in portrait
    expect(w.find('.mob-facts').classes()).toContain('mob-facts--compact');
    // 8 px under the title: the photo sheets' own spacing (the target pages put their facts right under the badges)
    expect(w.find('.mob-facts').classes()).toContain('mob-photo-facts');
    expect(w.find('.mob-fact-value .m-mono').text()).toBe('L 60 × 180 s · R 20 × 240 s');
    expect(w.find('.mob-sheet-modal').classes()).toContain('mob-sheet-modal--third');
    expect(w.findAll('.mob-icon-row button').map((b) => b.attributes('aria-label'))).toEqual([
      'Voir sur la carte',
      'Modifier les métadonnées',
      'Afficher les objets',
      "Afficher les points d'intérêt",
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
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(deletePhotoAPI).not.toHaveBeenCalled();
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[1][0].message).toContain('M31_2025-09-14_stack.jpg');
    expect(deletePhotoAPI).toHaveBeenCalledWith('p1');
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps the photo when the deletion fails, and says so', async () => {
    deletePhotoAPI.mockRejectedValue(new Error('disk'));
    const w = mountPage();
    await flushPromises();
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('turns the photo right from the top bar and shows it turned, whole again', async () => {
    rotatePhotoAPI.mockResolvedValue(photo({ filename: 'm31-b.jpg', width: 2000, height: 4000 }));
    const w = mountPage();
    await flushPromises();
    const turn = button(w, 'Faire pivoter à droite');
    // before the information button, as the board
    const bar = w.findAll('.mob-photo-bar button').map((b) => b.attributes('aria-label'));
    expect(bar.indexOf('Faire pivoter à droite')).toBe(
      bar.indexOf('Informations sur la photo') - 1,
    );
    await turn.trigger('click');
    await flushPromises();
    expect(rotatePhotoAPI).toHaveBeenCalledWith('p1');
    expect(w.find('.mob-photo-view').attributes('src')).toBe('/uploads/m31-b.jpg');
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

  it('opens the edit page of the photo from the pen', async () => {
    push.mockReset();
    const w = mountPage();
    await flushPromises();
    await button(w, 'Modifier les métadonnées').trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/photo/p1/edit');
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
});
