import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => new Promise(() => {}) }));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));
vi.mock('../src/sky-map-setup', () => ({
  createPhoneSkyMap: () => ({
    photos: {},
    reloadPhotos: () => Promise.resolve(),
    select: () => {},
    focus: () => {},
    showPhoto: () => {},
    refreshLocation: () => {},
    catalogsLoaded: () => {},
    destroy: () => {},
  }),
}));

import SkyPage from '../src/pages/SkyPage.vue';
import { skyRegionDraw, skyRegionView } from '../src/sky-modes';

/** The map's own controls: what shows with the live sky and what shows with the sky at a date. */
describe('the Ciel page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  const mountPage = () => mount(SkyPage, { global: { stubs: ionicStubs } });

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
    const region = { id: 'r1', name: 'Vue depuis le jardin', color: '#4a9eff', points: [], position: 0 };
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
});
