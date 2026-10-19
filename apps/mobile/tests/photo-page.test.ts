import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const deletePhotoAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
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
const solved = { value: true };
vi.mock('@myastrosky/core/photo-identify', () => ({ isPhotoSolved: () => solved.value }));

vi.mock('@myastrosky/core/catalog/dso-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/catalog/dso-registry')>()),
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
import IdentifyChooseSheet from '../src/pages/gallery/IdentifyChooseSheet.vue';
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
      ['Retour', 'Informations sur la photo'],
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

  it('lists what is known of the photo, values written as the desktop writes them', async () => {
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
      ["Date d'observation", '14 sept. 2025'],
      ['Exposition totale', '4h20'],
      ['Équipement', 'Équipement 1'],
      ['Filtres', 'L, R'],
    ]);
    expect(w.findAll('.mob-icon-row button').map((b) => b.attributes('aria-label'))).toEqual([
      'Voir sur la carte',
      'Modifier les métadonnées',
      'Identifier les objets',
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
    expect(w.find('.mob-facts').exists()).toBe(false);
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

  it('opens the edit page of the photo from the pen', async () => {
    push.mockReset();
    const w = mountPage();
    await flushPromises();
    await button(w, 'Modifier les métadonnées').trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/photo/p1/edit');
  });

  it('"Identifier les objets" puts the choice of an identification in place of the sheet, which its arrow brings back', async () => {
    const w = mountPage();
    await flushPromises();
    const info = () => w.findComponent(PhotoInfoSheet).props('open');
    const choose = () => w.findComponent(IdentifyChooseSheet).props('open');
    await button(w, 'Informations sur la photo').trigger('click');
    await button(w, 'Identifier les objets').trigger('click');
    expect([info(), choose()]).toEqual([false, true]);
    const sheet = w.findComponent(IdentifyChooseSheet);
    expect(sheet.findAll('.mob-row-title').map((r) => r.text())).toEqual([
      'Identifier un astéroïde',
      'Identifier des supernovae',
      'Identifier des comètes',
    ]);
    await sheet.find('button[aria-label="Retour"]').trigger('click');
    expect([info(), choose()]).toEqual([true, false]);

    await button(w, 'Identifier les objets').trigger('click');
    await w.findComponent(IdentifyChooseSheet).findAll('.mob-row')[2].trigger('click');
    expect(choose()).toBe(false);
    expect(push).toHaveBeenCalledWith('/gallery/photo/p1/identify/comet');
  });

  it('cannot identify objects on a photo without a solve', async () => {
    solved.value = false;
    const w = mountPage();
    await flushPromises();
    expect(button(w, 'Identifier les objets').attributes('disabled')).toBeDefined();
  });
});
