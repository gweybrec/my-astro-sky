import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

import SkyTopBar from '../src/pages/sky/SkyTopBar.vue';

/** "Ciel": the top row of the map, whose date button is the desktop's live / date switch. */

const mountBar = () => mount(SkyTopBar, { global: { stubs: ionicStubs } });
const button = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the top row of the map', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });

  it('has the search field, then the display button, then the date button', () => {
    const w = mountBar();
    expect(w.find('input[type=search]').exists()).toBe(true);
    expect(w.findAll('button').map((b) => b.attributes('aria-label'))).toEqual([
      'Affichage',
      'Voir le ciel à une date donnée',
    ]);
  });

  it('asks for the search and the display sheet', async () => {
    const w = mountBar();
    await w.find('input[type=search]').trigger('click');
    await button(w, 'Affichage').trigger('click');
    expect(w.emitted('search')).toHaveLength(1);
    expect(w.emitted('display')).toHaveLength(1);
  });

  it('switches to the date mode with the date button, without opening any picker', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await button(w, 'Voir le ciel à une date donnée').trigger('click');
    expect(time.mode).toBe('date');
    expect(w.emitted()).not.toHaveProperty('dateMode');
    expect(button(w, 'Revenir au ciel en direct')).toBeTruthy();
  });

  it('goes back to the live sky with the same button', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await button(w, 'Voir le ciel à une date donnée').trigger('click');
    await button(w, 'Revenir au ciel en direct').trigger('click');
    expect(time.mode).toBe('live');
  });
});
