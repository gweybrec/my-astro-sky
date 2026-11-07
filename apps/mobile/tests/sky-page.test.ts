import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
/** The pages Ionic's router opens, with the direction (no slide: 'none'). */
const navigate = vi.hoisted(() => vi.fn());
/** The page shown (reactive: the search page pushed over the map hides it), and the map's "view entered" hooks. */
const route = vi.hoisted(() => ({ current: null as unknown as { value: { path: string } } }));
const entered = vi.hoisted(() => [] as (() => void)[]);
vi.mock('vue-router', async () => {
  const { ref } = await import('vue');
  route.current = ref({ path: '/tabs/sky' });
  return { useRouter: () => ({ push, replace, currentRoute: route.current }) };
});
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIonRouter: () => ({ navigate }),
  onIonViewDidEnter: (hook: () => void) => entered.push(hook),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => new Promise(() => {}) }));
const reloadPhotos = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const sizesRepaired = vi.hoisted(() => ({ settle: (_n: number) => {} }));
const mediumsMade = vi.hoisted(() => ({ settle: (_n: number) => {} }));
/** The map under the page, for the tests that need one (letting go of a frame); none for the others. */
const fakeMap = vi.hoisted(() => ({ map: undefined as unknown }));
/** What the page asks of the map: highlight a selection, go somewhere. */
const sky = vi.hoisted(() => ({ select: vi.fn(), focus: vi.fn() }));
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
    select: (...a: unknown[]) => sky.select(...a),
    focus: (...a: unknown[]) => sky.focus(...a),
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
import { skyFocus, skyLayersOpen, skySelection } from '../src/composables/useSkySelection';
import SkyLayersSheet from '../src/pages/sky/SkyLayersSheet.vue';
import SkyFramesSheet from '../src/pages/sky/SkyFramesSheet.vue';
import PhoneToggleRow from '../src/components/PhoneToggleRow.vue';

/** The map's own controls: what shows with the live sky and what shows with the sky at a date. */
describe('the Ciel page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
    skyLayersOpen.value = false;
    skySelection.value = null;
    route.current.value = { path: '/tabs/sky' };
    entered.length = 0;
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

  it('shows no time bar with the live sky', async () => {
    const w = mountPage();
    await flushPromises();
    expect(useSkyTimeStore().mode).toBe('live');
    expect(w.find('.mob-timebar').exists()).toBe(false);
  });

  it('opens the layers sheet with the calendar button; its first switch brings the time bar and takes it away', async () => {
    const w = mountPage();
    await flushPromises();
    await w.find('button[aria-label="Calques de la carte"]').trigger('click');
    await flushPromises();
    expect(skyLayersOpen.value).toBe(true);
    const dateRow = w
      .findAllComponents(PhoneToggleRow)
      .find((r) => r.props('title') === 'Ciel du jour')!;
    dateRow.vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(useSkyTimeStore().mode).toBe('date');
    expect(w.find('.mob-timebar').exists()).toBe(true);
    dateRow.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(w.find('.mob-timebar').exists()).toBe(false);
  });

  it('closes the layers sheet when an object is selected', async () => {
    const w = mountPage();
    await flushPromises();
    skyLayersOpen.value = true;
    await flushPromises();
    expect(w.findComponent(SkyLayersSheet).exists()).toBe(true);
    skySelection.value = { kind: 'star', star: { hip: 1, ra: 0, dec: 0, mag: 1 } as never };
    await flushPromises();
    expect(skyLayersOpen.value).toBe(false);
    expect(w.findComponent(SkyLayersSheet).exists()).toBe(false);
  });

  it("opens the layers sheet over an object's sheet, closing the object's", async () => {
    const w = mountPage();
    await flushPromises();
    skySelection.value = { kind: 'star', star: { hip: 1, ra: 0, dec: 0, mag: 1 } as never };
    await flushPromises();
    await w.find('button[aria-label="Calques de la carte"]').trigger('click');
    await flushPromises();
    expect(skySelection.value).toBeNull();
    expect(w.findComponent(SkyLayersSheet).exists()).toBe(true);
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

  describe('a floating frame and the search (note "Cadre flottant et recherche")', () => {
    // Each test's page is unmounted: one left over would take the search for its own frame.
    enableAutoUnmount(afterEach);
    const M42 = {
      id: 'M42',
      ra: 83.8,
      dec: -5.4,
      type: 'EN',
      mag: 4,
      majAxis: 90,
      minAxis: 60,
      constellation: 'Ori',
      catalogs: ['M42'],
      displayName: "Nébuleuse d'Orion",
    } as never;
    let map: {
      selectFrame: ReturnType<typeof vi.fn>;
      navigateUnderFrame: ReturnType<typeof vi.fn>;
    };
    beforeEach(() => {
      map = {
        selectFrame: vi.fn(),
        navigateUnderFrame: vi.fn(() => true),
        getView: () => ({ width: 412, height: 800, scale: 300 }),
      } as never;
      fakeMap.map = map;
      sky.select.mockReset();
      sky.focus.mockReset();
      skyFocus.value = null;
    });
    afterEach(() => {
      fakeMap.map = undefined;
    });

    /** A free frame of a setup, selected: floating on the screen, or pinned to the sky. */
    function frame(anchor: 'screen' | 'sky') {
      const fov = useFovFramesStore();
      fov.specs = new Map([
        [
          's1',
          {
            name: 'Équipement 1',
            label: 'Équipement 1',
            wDeg: 5.4,
            hDeg: 3.6,
            smart: false,
            mosaic: null,
          },
        ],
      ]);
      fov.adhoc.push({
        id: 'a1',
        setupId: 's1',
        anchor:
          anchor === 'screen'
            ? { kind: 'screen', nx: 0.5, ny: 0.4 }
            : { kind: 'sky', ra: 10.7, dec: 41.3, dsoId: null },
        rotationDeg: 0,
      });
      fov.setSelection({ kind: 'free' });
      fov.setFramesVisible(true);
      fov.setActive('a1');
      return fov;
    }
    /** Choosing an object in the search page, pushed over the map, then back to the map. */
    async function search() {
      route.current.value = { path: '/sky/search' };
      await flushPromises();
      skySelection.value = { kind: 'dso', dso: M42 };
      skyFocus.value = { ra: 83.8, dec: -5.4, scale: 1200 };
      await flushPromises();
      route.current.value = { path: '/tabs/sky' };
      for (const hook of entered) hook();
      await flushPromises();
    }

    it('brings the object under the floating frame, which keeps its sheet; the object is highlighted, without its sheet', async () => {
      mountPage();
      await flushPromises();
      const fov = frame('screen');
      await flushPromises();
      await search();
      expect(map.selectFrame).not.toHaveBeenCalled();
      expect(fov.activeId).toBe('a1');
      expect(skySelection.value).toBeNull();
      expect(map.navigateUnderFrame).toHaveBeenCalledWith('a1', 83.8, -5.4, 1200);
      expect(sky.select).toHaveBeenLastCalledWith({ kind: 'dso', dso: M42 });
      expect(sky.focus).not.toHaveBeenCalled();
    });

    it('selects the object as before when the frame is pinned', async () => {
      mountPage();
      await flushPromises();
      frame('sky');
      await flushPromises();
      await search();
      expect(map.selectFrame).toHaveBeenCalledWith(null);
      expect(skySelection.value).toEqual({ kind: 'dso', dso: M42 });
      expect(map.navigateUnderFrame).not.toHaveBeenCalled();
      expect(sky.focus).toHaveBeenCalled();
    });

    it('brings a frame beside its sheet only once the sheet has measured how tall it opens', async () => {
      /** What the sheet had measured when the map moved the frame. */
      const coverWhenMoved: (string | undefined)[] = [];
      const w = mountPage();
      Object.assign(map, {
        setCover: vi.fn(),
        centerFrameInView: vi.fn(() => {
          const room = w.find('.mob-map-sheet-room').element as HTMLElement;
          coverWhenMoved.push(room.dataset.cover);
        }),
      });
      await flushPromises();
      frame('screen');
      w.findComponent(SkyFramesSheet).vm.$emit('show', 'a1');
      await new Promise((r) => setTimeout(r, 800));
      expect(coverWhenMoved).toHaveLength(1);
      expect(coverWhenMoved[0]).toBeDefined();
    });

    it('selects an object tapped on the map as before, letting go of the floating frame', async () => {
      mountPage();
      await flushPromises();
      frame('screen');
      await flushPromises();
      skySelection.value = { kind: 'dso', dso: M42 };
      await flushPromises();
      expect(map.selectFrame).toHaveBeenCalledWith(null);
      expect(skySelection.value).toEqual({ kind: 'dso', dso: M42 });
    });
  });
});
