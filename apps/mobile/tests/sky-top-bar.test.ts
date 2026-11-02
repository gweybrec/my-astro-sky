import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

import SkyTopBar from '../src/pages/sky/SkyTopBar.vue';

/** "Ciel": the top row of the map, whose calendar button opens the layers sheet. */

const mountBar = () => mount(SkyTopBar, { global: { stubs: ionicStubs } });
const button = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;

describe('the top row of the map', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });

  it('has the search field, then the display, frames and calendar buttons', () => {
    const w = mountBar();
    expect(w.find('input[type=search]').exists()).toBe(true);
    expect(w.findAll('button').map((b) => b.attributes('aria-label'))).toEqual([
      'Affichage',
      'Contours de champ',
      'Calques de la carte',
    ]);
  });

  it('shows a short hint in the search field; the search page shows the full one', () => {
    const input = mountBar().find('input[type=search]');
    expect(input.attributes('placeholder')).toBe('Rechercher…');
    expect(input.attributes('aria-label')).toBe('Rechercher étoile ou DSO…');
  });

  it('asks for the search, the display sheet and the frames sheet', async () => {
    const w = mountBar();
    await w.find('input[type=search]').trigger('click');
    await button(w, 'Affichage').trigger('click');
    await button(w, 'Contours de champ').trigger('click');
    expect(w.emitted('search')).toHaveLength(1);
    expect(w.emitted('display')).toHaveLength(1);
    expect(w.emitted('frames')).toHaveLength(1);
  });

  it('asks for the layers sheet with the calendar button, without changing the mode', async () => {
    const w = mountBar();
    await button(w, 'Calques de la carte').trigger('click');
    expect(w.emitted('layers')).toHaveLength(1);
    expect(useSkyTimeStore().mode).toBe('live');
  });

  it('draws the calendar button pressed while the map shows the sky at a date', async () => {
    const w = mountBar();
    expect(button(w, 'Calques de la carte').attributes('aria-pressed')).toBe('false');
    useSkyTimeStore().setMode('date');
    await w.vm.$nextTick();
    expect(button(w, 'Calques de la carte').attributes('aria-pressed')).toBe('true');
  });
});
