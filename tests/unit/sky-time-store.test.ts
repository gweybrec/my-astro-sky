import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSkyTimeStore } from '../../src/stores/sky-time';
import { SKY_TIME_SETTINGS_KEY, RATE_LADDER } from '../../src/sky-time-settings';
import { twilightWindow } from '../../src/astro-time';

describe('sky-time store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in live mode with time stopped', () => {
    const store = useSkyTimeStore();
    expect(store.mode).toBe('live');
    expect(store.effectiveRate).toBe(0);
    expect(store.showMoon).toBe(false);
    expect(store.showAzimuthGrid).toBe(false);
  });

  it('toggleMode switches live <-> date without touching simDate', () => {
    const store = useSkyTimeStore();
    const frozen = new Date('2020-06-15T10:00:00.000Z');
    store.setSimDate(frozen);

    store.toggleMode();
    expect(store.mode).toBe('date');
    expect(store.simDate.getTime()).toBe(frozen.getTime());

    store.toggleMode();
    expect(store.mode).toBe('live');
    expect(store.simDate.getTime()).toBe(frozen.getTime());

    // Switching back to date within the same session finds the same date/time again.
    store.toggleMode();
    expect(store.simDate.getTime()).toBe(frozen.getTime());
  });

  it('stepRateForward auto-switches to date mode and jumps straight to the first rung (not 1x)', () => {
    const store = useSkyTimeStore();
    store.stepRateForward();
    expect(store.mode).toBe('date');
    expect(store.effectiveRate).toBe(RATE_LADDER[0]);
    expect(RATE_LADDER[0]).toBeGreaterThan(1);

    store.stepRateForward();
    expect(store.effectiveRate).toBe(RATE_LADDER[1]);
  });

  it('stepRateBackward jumps straight to the first rung in reverse', () => {
    const store = useSkyTimeStore();
    store.stepRateBackward();
    expect(store.mode).toBe('date');
    expect(store.effectiveRate).toBe(-RATE_LADDER[0]);

    store.stepRateBackward();
    expect(store.effectiveRate).toBe(-RATE_LADDER[1]);
  });

  it('acts as a signed +/- dial: backward decreases a forward rate one rung at a time', () => {
    const store = useSkyTimeStore();
    store.stepRateForward(); // +ladder[0]
    store.stepRateForward(); // +ladder[1]
    store.stepRateForward(); // +ladder[2] (e.g. +10)
    expect(store.effectiveRate).toBe(RATE_LADDER[2]);

    store.stepRateBackward(); // one rung down, still forward (e.g. +10 -> +5)
    expect(store.effectiveRate).toBe(RATE_LADDER[1]);

    store.stepRateBackward(); // ladder[0]
    expect(store.effectiveRate).toBe(RATE_LADDER[0]);

    store.stepRateBackward(); // reaches a full stop
    expect(store.effectiveRate).toBe(0);

    store.stepRateBackward(); // now starts climbing backward from the stop
    expect(store.effectiveRate).toBe(-RATE_LADDER[0]);
  });

  it('symmetric: forward decreases a backward rate one rung at a time', () => {
    const store = useSkyTimeStore();
    store.stepRateBackward();
    store.stepRateBackward();
    expect(store.effectiveRate).toBe(-RATE_LADDER[1]);

    store.stepRateForward();
    expect(store.effectiveRate).toBe(-RATE_LADDER[0]);

    store.stepRateForward();
    expect(store.effectiveRate).toBe(0);

    store.stepRateForward();
    expect(store.effectiveRate).toBe(RATE_LADDER[0]);
  });

  it('stopTime freezes simDate where it is, without resetting to "now"', () => {
    const store = useSkyTimeStore();
    store.toggleMode();
    const frozen = new Date('2020-01-01T00:00:00.000Z');
    store.setSimDate(frozen);
    store.stepRateForward();
    store.stopTime();
    expect(store.effectiveRate).toBe(0);
    expect(store.simDate.getTime()).toBe(frozen.getTime());
  });

  it('resetToNow jumps simDate back to "now" and stops the rate', () => {
    const store = useSkyTimeStore();
    store.setSimDate(new Date('2020-01-01T00:00:00.000Z'));
    store.stepRateForward();
    const before = Date.now();

    store.resetToNow();

    expect(store.effectiveRate).toBe(0);
    expect(Math.abs(store.simDate.getTime() - before)).toBeLessThan(1000);
  });

  it('jumpToEvening keeps the calendar day and moves to a default hour without a location', () => {
    const store = useSkyTimeStore();
    const base = new Date(2026, 5, 15, 3, 30, 0); // 03:30 local — the small hours
    store.setSimDate(base);

    store.jumpToEvening();

    expect(store.mode).toBe('date');
    const d = store.simDate;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(21);
    expect(d.getMinutes()).toBe(0);
  });

  it('jumpToEvening uses the real astronomical dusk once an observer location is set', () => {
    const store = useSkyTimeStore();
    const base = new Date(2026, 5, 15, 3, 30, 0);
    store.setSimDate(base);
    store.setLocation(45.5, 4.8);

    store.jumpToEvening();

    const expected = twilightWindow(base, 45.5, 4.8);
    expect(expected).not.toBeNull();
    expect(store.simDate.getTime()).toBe(expected!.start.getTime());
  });

  it('persists settings on every mutation', () => {
    const store = useSkyTimeStore();
    store.setShowMoon(true);
    const raw = localStorage.getItem(SKY_TIME_SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).showMoon).toBe(true);
  });

  it('setShowAzimuthGrid toggles and persists', () => {
    const store = useSkyTimeStore();
    store.setShowAzimuthGrid(true);
    expect(store.showAzimuthGrid).toBe(true);
    const raw = localStorage.getItem(SKY_TIME_SETTINGS_KEY);
    expect(JSON.parse(raw!).showAzimuthGrid).toBe(true);
  });

  it('seedLocationIfNeeded pre-fills from the Targets tab location, once', () => {
    localStorage.setItem('targets-prefs-v3', JSON.stringify({ lat: 48.85, lon: 2.35 }));
    const store = useSkyTimeStore();
    expect(store.lat).toBeNull();

    store.seedLocationIfNeeded();
    expect(store.lat).toBe(48.85);
    expect(store.lon).toBe(2.35);

    // A later change to the Targets prefs must not retroactively override an explicit set.
    store.setLocation(10, 20);
    localStorage.setItem('targets-prefs-v3', JSON.stringify({ lat: 0, lon: 0 }));
    store.seedLocationIfNeeded();
    expect(store.lat).toBe(10);
    expect(store.lon).toBe(20);
  });

  it('does not seed location when nothing is saved in the Targets tab', () => {
    const store = useSkyTimeStore();
    store.seedLocationIfNeeded();
    expect(store.lat).toBeNull();
    expect(store.lon).toBeNull();
  });

  it('ticks simDate forward at the effective rate while in date mode', () => {
    vi.useFakeTimers();
    const store = useSkyTimeStore();
    store.setSimDate(new Date('2026-01-01T00:00:00.000Z'));
    store.stepRateForward(); // first rung
    const start = store.simDate.getTime();

    vi.advanceTimersByTime(500);
    expect(store.simDate.getTime()).toBe(start + RATE_LADDER[0] * 500);
  });

  it('stops ticking once stopTime is called', () => {
    vi.useFakeTimers();
    const store = useSkyTimeStore();
    store.stepRateForward();
    vi.advanceTimersByTime(500);
    store.stopTime();
    const frozen = store.simDate.getTime();
    vi.advanceTimersByTime(2000);
    expect(store.simDate.getTime()).toBe(frozen);
  });
});
