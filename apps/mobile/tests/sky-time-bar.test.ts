import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { writeObserverLocation } from '@myastrosky/core/observer-location';
import { twilightWindow } from '@myastrosky/core/astro-time';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs } from './helpers';

import SkyTimeBar from '../src/pages/sky/SkyTimeBar.vue';

/** "Ciel": the time bar, driving the shared sky-time store as the desktop's time controls do. */

const mountBar = () => mount(SkyTimeBar, { global: { stubs: ionicStubs } });
const field = (w: ReturnType<typeof mount>) =>
  w.findAll('button').find((b) => b.attributes('aria-label')?.startsWith('Date et heure'))!;
const named = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name || b.text() === name)!;
const inputs = (w: ReturnType<typeof mount>) => w.findAllComponents(ionicStubs.IonInput);

describe('the time bar', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 22, 15));
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  afterEach(() => vi.useRealTimers());

  it('shows the present time while the map is live, as the board writes it', () => {
    const w = mountBar();
    expect(field(w).attributes('aria-label')).toBe(
      'Date et heure, ouvrir les sélecteurs : 2026-10-03 22:15',
    );
    expect(field(w).text()).toContain('2026-10-03 22:15');
    expect(w.text()).toContain('Ce soir');
  });

  it('shows the chosen moment once in the date mode', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    time.setMode('date');
    time.setSimDate(new Date(2026, 11, 24, 3, 7));
    await w.vm.$nextTick();
    expect(field(w).text()).toContain('2026-12-24 03:07');
  });

  it('switches to the date mode when the field is pressed, as the desktop does', async () => {
    const w = mountBar();
    await field(w).trigger('click');
    expect(useSkyTimeStore().mode).toBe('date');
  });

  it('applies the moment chosen in the phone picker', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await field(w).trigger('click');
    const [picker] = inputs(w);
    picker.vm.$emit('ionChange', { detail: { value: '2026-11-05T01:30' } });
    expect(time.simDate.getFullYear()).toBe(2026);
    expect([time.simDate.getMonth(), time.simDate.getDate()]).toEqual([10, 5]);
    expect([time.simDate.getHours(), time.simDate.getMinutes()]).toEqual([1, 30]);
  });

  it('goes to the evening with "Ce soir": the end of twilight at the location, else 21:00', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await named(w, 'Ce soir').trigger('click');
    expect(time.mode).toBe('date');
    expect([time.simDate.getHours(), time.simDate.getMinutes()]).toEqual([21, 0]);

    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    const located = useSkyTimeStore();
    const w2 = mountBar();
    await named(w2, 'Ce soir').trigger('click');
    const dusk = twilightWindow(new Date(2026, 9, 3, 22, 15), 48.58, 7.75)!.start;
    expect(located.simDate.getTime()).toBe(dusk.getTime());
  });

  it('pauses and resumes the clock, the button naming what it will do', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    expect(named(w, 'Mettre le temps en pause')).toBeTruthy();
    await named(w, 'Mettre le temps en pause').trigger('click');
    expect(time.mode).toBe('date');
    expect(time.paused).toBe(true);
    expect(named(w, 'Reprendre le temps')).toBeTruthy();
    await named(w, 'Reprendre le temps').trigger('click');
    expect(time.paused).toBe(false);
  });
});
