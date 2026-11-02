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
    expect(field(w).attributes('aria-label')).toBe('Date et heure, régler : 2026-10-03 22:15');
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

  it('opens the steppers inside the bar, no picker, and closes them again', async () => {
    const w = mountBar();
    expect(w.find('[role="group"]').exists()).toBe(false);
    await field(w).trigger('click');
    expect(field(w).attributes('aria-expanded')).toBe('true');
    expect(w.find('[role="group"]').text()).toContain('2026');
    expect(w.findAll('input')).toHaveLength(0);
    await field(w).trigger('click');
    expect(w.find('[role="group"]').exists()).toBe(false);
  });

  it('steps the moment one unit per press, and again while a stepper is held', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await field(w).trigger('click');
    time.setSimDate(new Date(2026, 9, 3, 22, 15));
    if (!time.paused) time.togglePaused();
    await w.vm.$nextTick();

    const plusHour = named(w, 'Plus une heure');
    await plusHour.trigger('pointerdown');
    await plusHour.trigger('pointerup');
    await plusHour.trigger('click');
    expect([time.simDate.getHours(), time.simDate.getMinutes()]).toEqual([23, 15]);

    const minusDay = named(w, 'Moins un jour');
    await minusDay.trigger('pointerdown');
    vi.advanceTimersByTime(400 + 3 * 100);
    await minusDay.trigger('pointerup');
    expect([time.simDate.getMonth(), time.simDate.getDate()]).toEqual([8, 29]);
    vi.advanceTimersByTime(1000);
    expect([time.simDate.getMonth(), time.simDate.getDate()]).toEqual([8, 29]);
    expect(w.find('[role="group"]').text()).toContain('29');
  });

  it('changes the speed, writes it after the moment, and goes back to x1 and to now', async () => {
    const w = mountBar();
    const time = useSkyTimeStore();
    await named(w, 'Accélérer le temps').trigger('click');
    expect(time.mode).toBe('date');
    expect(time.effectiveRate).toBe(2);
    expect(field(w).text()).toContain('· ×2');
    await named(w, 'Ralentir ou reculer le temps').trigger('click');
    await named(w, 'Ralentir ou reculer le temps').trigger('click');
    expect(time.effectiveRate).toBe(-2);
    await named(w, 'Vitesse normale (×1)').trigger('click');
    expect(time.effectiveRate).toBe(1);
    expect(field(w).text()).not.toContain('×');

    time.setSimDate(new Date(2020, 0, 1));
    await named(w, 'Accélérer le temps').trigger('click');
    await named(w, 'Maintenant').trigger('click');
    expect(time.simDate.getTime()).toBe(new Date(2026, 9, 3, 22, 15).getTime());
    expect(time.effectiveRate).toBe(1);
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

  it('swaps the pause icon for the play icon when the clock is paused', async () => {
    const w = mountBar();
    const iconOf = (name: string) => named(w, name).find('svg').html();
    expect(iconOf('Mettre le temps en pause')).toContain('M16 5v14');
    await named(w, 'Mettre le temps en pause').trigger('click');
    expect(iconOf('Reprendre le temps')).toContain('M8 5v14l11-7z');
    expect(iconOf('Reprendre le temps')).not.toContain('M16 5v14');
  });
});
