import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => new Promise(() => {}) }));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({}), showInfo: vi.fn() }));
vi.mock('../src/sky-map-setup', () => ({
  createPhoneSkyMap: () => ({
    photos: {},
    reloadPhotos: () => Promise.resolve(),
    select: () => {},
    focus: () => {},
    refreshLocation: () => {},
    catalogsLoaded: () => {},
    destroy: () => {},
  }),
}));

import SkyPage from '../src/pages/SkyPage.vue';

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
});
