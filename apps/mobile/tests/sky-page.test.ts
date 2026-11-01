import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
/** The pages Ionic's router opens, with the direction (no slide: 'none'). */
const navigate = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace, currentRoute: { value: { path: '/tabs/sky' } } }),
}));
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIonRouter: () => ({ navigate }),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => new Promise(() => {}) }));
const reloadPhotos = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const sizesRepaired = vi.hoisted(() => ({ settle: (_n: number) => {} }));
const mediumsMade = vi.hoisted(() => ({ settle: (_n: number) => {} }));
/** The map under the page, for the tests that need one (letting go of a frame); none for the others. */
const fakeMap = vi.hoisted(() => ({ map: undefined as unknown }));
vi.mock('../src/photo-sizes', () => ({
  photoSizesRepaired: () => new Promise<number>((resolve) => (sizesRepaired.settle = resolve)),
  photoMediumsMade: () => new Promise<number>((resolve) => (mediumsMade.settle = resolve)),
}));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));
vi.mock('../src/sky-map-setup', () => ({
  currentSkyMap: { value: null },
  createPhoneSkyMap: () => ({
    photos: {},
    reloadPhotos,
    select: () => {},
    focus: () => {},
    showPhoto: () => {},
    refreshLocation: () => {},
    catalogsLoaded: () => {},
    destroy: () => {},
    map: fakeMap.map,
  }),
}));

import SkyPage from '../src/pages/SkyPage.vue';
import { skyPlanView, skyRegionDraw, skyRegionView, skyTargetView } from '../src/sky-modes';
import { framesSheetOpen } from '../src/sky-frames';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';

/** The map's own controls: what shows with the live sky and what shows with the sky at a date. */
describe('the Ciel page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  const mountPage = () => mount(SkyPage, { global: { stubs: ionicStubs } });

  it('reads its photos again when the start-up repair gave some a size, and not when it gave none', async () => {
    mountPage();
    await flushPromises();
    reloadPhotos.mockClear();
    sizesRepaired.settle(0);
    await flushPromises();
    expect(reloadPhotos).not.toHaveBeenCalled();

    mountPage();
    await flushPromises();
    reloadPhotos.mockClear();
    sizesRepaired.settle(2);
    await flushPromises();
    expect(reloadPhotos).toHaveBeenCalledOnce();
  });

  it('reads its photos again when medium-sized copies were made at start-up, and not when none were', async () => {
    mountPage();
    await flushPromises();
    reloadPhotos.mockClear();
    mediumsMade.settle(0);
    await flushPromises();
    expect(reloadPhotos).not.toHaveBeenCalled();

    mountPage();
    await flushPromises();
    reloadPhotos.mockClear();
    mediumsMade.settle(3);
    await flushPromises();
    expect(reloadPhotos).toHaveBeenCalledOnce();
  });

  it('shows neither the time bar nor the toggles of the map with the live sky', async () => {
    const w = mountPage();
    await flushPromises();
    expect(useSkyTimeStore().mode).toBe('live');
    expect(w.find('.mob-timebar').exists()).toBe(false);
    expect(w.find('.mob-map-ribbon').exists()).toBe(false);
  });

  it('shows both once the date button has put the map in the date mode, and hides them again', async () => {
    const w = mountPage();
    await flushPromises();
    const dateButton = () =>
      w
        .findAll('button')
        .find((b) => /ciel (en direct|à une date)/i.test(b.attributes('aria-label') ?? ''))!;
    await dateButton().trigger('click');
    expect(useSkyTimeStore().mode).toBe('date');
    expect(w.find('.mob-timebar').exists()).toBe(true);
    expect(w.find('.mob-map-ribbon').exists()).toBe(true);
    await dateButton().trigger('click');
    expect(w.find('.mob-timebar').exists()).toBe(false);
  });

  it('gives a sky region being drawn or shown its own title bar, whose back arrow opens the regions page again', async () => {
    const w = mountPage();
    await flushPromises();
    const region = {
      id: 'r1',
      name: 'Vue depuis le jardin',
      color: '#4a9eff',
      points: [],
      position: 0,
    };
    skyRegionView.value = { region, returnTo: '/targets/regions' };
    await flushPromises();
    expect(w.find('.mob-topbar-title').text()).toBe('Vue depuis le jardin');
    expect(w.find('.mob-map-mode.mob-map-mode--bare').exists()).toBe(true);
    await w.find('button[aria-label="Retour"]').trigger('click');
    await flushPromises();
    expect(skyRegionView.value).toBeNull();
    expect(replace).toHaveBeenLastCalledWith('/tabs/targets');
    expect(push).toHaveBeenLastCalledWith('/targets/regions');

    skyRegionDraw.value = { returnTo: '/targets/regions' };
    await flushPromises();
    expect(w.find('.mob-topbar-title').text()).toBe('Dessiner une région');
    expect(w.find('.mob-map-mode--bare').exists()).toBe(false);
    await w.find('button[aria-label="Retour"]').trigger('click');
    expect(skyRegionDraw.value).toBeNull();
    expect(w.find('.mob-map-mode').exists()).toBe(false);
  });

  describe('showing a target ("Ciel, voir une cible")', () => {
    beforeEach(() => {
      fakeMap.map = { selectFrame: vi.fn(), getView: () => ({ width: 0, height: 0 }) };
      skyTargetView.value = null;
    });
    afterEach(() => {
      fakeMap.map = undefined;
      skyTargetView.value = null;
    });

    /** "Afficher sur la carte" of the plan's target page: a free frame of the setup on the target. */
    function showTarget() {
      const fov = useFovFramesStore();
      fov.specs = new Map([
        [
          's1',
          {
            name: 'Équipement 1',
            label: 'Équipement 1 · 2.5° × 1.7°',
            wDeg: 2.5,
            hDeg: 1.7,
            smart: false,
            mosaic: null,
          },
        ],
      ]);
      fov.adhoc.push({
        id: 'a1',
        setupId: 's1',
        anchor: { kind: 'sky', ra: 10.7, dec: 41.3, dsoId: 'NGC7023' },
        rotationDeg: 0,
      });
      fov.setSelection({ kind: 'plan', planId: 'p9' });
      fov.setFramesVisible(false);
      const frames = { visible: false, selection: { kind: 'plan' as const, planId: 'p9' } };
      fov.setSelection({ kind: 'free' });
      fov.setFramesVisible(true);
      fov.setActive('a1');
      skyTargetView.value = {
        frameId: 'a1',
        frames,
        dsoId: 'NGC7023',
        name: "Nébuleuse de l'Iris",
        tab: 'plans',
        pages: ['/plans/p1', '/plans/p1/targets'],
        page: '/plans/p1/targets/NGC7023',
        pageOf: (id) => `/plans/p1/targets/${id}`,
      };
      return fov;
    }

    it("has the target's name in its own bar, over the map alone", async () => {
      const w = mountPage();
      await flushPromises();
      showTarget();
      await flushPromises();
      expect(w.find('.mob-topbar-title').text()).toBe("Nébuleuse de l'Iris");
      expect(w.find('.mob-map-mode.mob-map-mode--bare').exists()).toBe(true);
      // no search row of the map in the mode
      expect(w.find('.mob-map-top').exists()).toBe(false);
    });

    it("opens the target's page again with the pages under it, in one press of the back arrow", async () => {
      const w = mountPage();
      await flushPromises();
      showTarget();
      await flushPromises();
      replace.mockClear();
      navigate.mockClear();
      await w.find('button[aria-label="Retour"]').trigger('click');
      await flushPromises();
      expect(skyTargetView.value).toBeNull();
      expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/plans']);
      // the pages open again without a slide each
      expect(navigate.mock.calls).toEqual([
        ['/plans/p1', 'none', 'push'],
        ['/plans/p1/targets', 'none', 'push'],
        ['/plans/p1/targets/NGC7023', 'none', 'push'],
      ]);
    });

    it('takes the object the frame is moved onto as the target, and keeps the last one on empty sky', async () => {
      const w = mountPage();
      await flushPromises();
      const fov = showTarget();
      await flushPromises();
      fov.adhoc[0].anchor = { kind: 'sky', ra: 11, dec: 42, dsoId: 'M31' };
      await flushPromises();
      // the catalogue is not loaded here: the object is named by its id
      expect(w.find('.mob-topbar-title').text()).toBe('M31');
      fov.adhoc[0].anchor = { kind: 'sky', ra: 12, dec: 43, dsoId: null };
      await flushPromises();
      expect(w.find('.mob-topbar-title').text()).toBe('M31');
      navigate.mockClear();
      await w.find('button[aria-label="Retour"]').trigger('click');
      await flushPromises();
      expect(navigate).toHaveBeenLastCalledWith('/plans/p1/targets/M31', 'none', 'push');
    });

    it('removes the frame it showed when it is left, and puts the frames back as they were', async () => {
      const w = mountPage();
      await flushPromises();
      const fov = showTarget();
      await flushPromises();
      expect(fov.adhoc.map((f) => f.id)).toEqual(['a1']);
      await w.find('button[aria-label="Retour"]').trigger('click');
      await flushPromises();
      expect(fov.adhoc).toEqual([]);
      expect(fov.framesVisible).toBe(false);
      expect(fov.selection).toEqual({ kind: 'plan', planId: 'p9' });
    });
  });

  describe('showing a plan ("Ciel, contours de champ d\'un plan")', () => {
    beforeEach(() => {
      fakeMap.map = { selectFrame: vi.fn(), getView: () => ({ width: 0, height: 0 }) };
      skyPlanView.value = null;
    });
    afterEach(() => {
      fakeMap.map = undefined;
      skyPlanView.value = null;
      framesSheetOpen.value = false;
    });

    /** "Afficher sur la carte" of the plan's page: the plan's frames shown, the frames' sheet on them. */
    function showPlan() {
      const fov = useFovFramesStore();
      fov.setSelection({ kind: 'free' });
      fov.setFramesVisible(false);
      const frames = { visible: false, selection: { kind: 'free' as const } };
      fov.setSelection({ kind: 'plan', planId: 'p1' });
      fov.setFramesVisible(true);
      skyPlanView.value = {
        planId: 'p1',
        name: 'Nuit du 2026-10-03',
        frames,
        returnTo: '/plans/p1',
      };
      framesSheetOpen.value = true;
      return fov;
    }

    it("has the plan's name in its own bar, over the map alone, without the map's search row", async () => {
      const w = mountPage();
      await flushPromises();
      showPlan();
      await flushPromises();
      expect(w.find('.mob-topbar-title').text()).toBe('Nuit du 2026-10-03');
      expect(w.find('.mob-map-mode.mob-map-mode--bare').exists()).toBe(true);
      expect(w.find('.mob-map-top').exists()).toBe(false);
    });

    it("opens the plan's page again with the back arrow, and puts the frames back as they were", async () => {
      const w = mountPage();
      await flushPromises();
      const fov = showPlan();
      await flushPromises();
      replace.mockClear();
      navigate.mockClear();
      await w.find('button[aria-label="Retour"]').trigger('click');
      await flushPromises();
      expect(skyPlanView.value).toBeNull();
      expect(framesSheetOpen.value).toBe(false);
      expect(replace.mock.calls.map((c) => c[0])).toEqual(['/tabs/plans']);
      expect(navigate.mock.calls).toEqual([['/plans/p1', 'none', 'push']]);
      expect(fov.framesVisible).toBe(false);
      expect(fov.selection).toEqual({ kind: 'free' });
    });

    it("reopens the frames' sheet from the bar's frames button once it was dragged away", async () => {
      const w = mountPage();
      await flushPromises();
      showPlan();
      await flushPromises();
      expect(w.findComponent({ name: 'SkyFramesSheet' }).props('planView')).toBe(true);
      framesSheetOpen.value = false;
      await flushPromises();
      await w.find('.mob-topbar button[aria-label="Contours de champ"]').trigger('click');
      expect(framesSheetOpen.value).toBe(true);
    });

    it('has no frames button in the bar of the other modes', async () => {
      const w = mountPage();
      await flushPromises();
      skyTargetView.value = {
        frameId: null,
        frames: { visible: true, selection: { kind: 'free' } },
        dsoId: 'M31',
        name: "Galaxie d'Andromède",
        tab: 'targets',
        pages: [],
        page: '/targets/M31',
        pageOf: (id) => `/targets/${id}`,
      };
      await flushPromises();
      expect(w.find('.mob-topbar-title').text()).toBe("Galaxie d'Andromède");
      expect(w.find('.mob-topbar button[aria-label="Contours de champ"]').exists()).toBe(false);
      skyTargetView.value = null;
    });
  });
});
