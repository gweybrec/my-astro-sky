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

  it('starts in live mode at the 1x baseline, unpaused', () => {
    const store = useSkyTimeStore();
    expect(store.mode).toBe('live');
    expect(store.effectiveRate).toBe(1);
    expect(store.paused).toBe(false);
    expect(store.showMoon).toBe(false);
    expect(store.showSun).toBe(false);
    expect(store.showPlanets).toBe(false);
    expect(store.showAzimuthGrid).toBe(false);
  });

  it('the first time date mode is entered this session, simDate resets to "now" at 1x unpaused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-06-15T10:00:00.000Z'));
    const store = useSkyTimeStore();
    // Set while still in live mode — the UI never exposes this, but a keyboard shortcut
    // could reach here; the first date-mode activation must still win over it.
    store.setSimDate(new Date('1999-01-01T00:00:00.000Z'));

    store.toggleMode();

    expect(store.mode).toBe('date');
    expect(store.simDate.getTime()).toBe(new Date('2020-06-15T10:00:00.000Z').getTime());
    expect(store.effectiveRate).toBe(1);
    expect(store.paused).toBe(false);
  });

  it('after the first activation, toggling live <-> date preserves simDate (no elapsed time)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-06-15T10:00:00.000Z'));
    const store = useSkyTimeStore();
    store.toggleMode(); // -> date, first activation this session
    const activated = store.simDate.getTime();

    store.toggleMode();
    expect(store.mode).toBe('live');
    expect(store.simDate.getTime()).toBe(activated);

    // Switching back to date within the same session, with no real time elapsed
    // (fake timers), finds the same date/time again.
    store.toggleMode();
    expect(store.simDate.getTime()).toBe(activated);
  });

  it('re-entering date mode fast-forwards simDate by the real time elapsed while away, at the persisted rate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-06-15T10:00:00.000Z'));
    const store = useSkyTimeStore();
    store.stepRateForward(); // first activation + jump to the first rung
    store.setSimDate(new Date('2026-01-01T00:00:00.000Z'));
    const rate = store.effectiveRate;

    store.toggleMode(); // -> live
    vi.advanceTimersByTime(10_000);
    store.toggleMode(); // -> date again

    expect(store.simDate.getTime()).toBe(
      new Date('2026-01-01T00:00:00.000Z').getTime() + rate * 10_000,
    );
  });

  it('does not fast-forward on re-entry while paused', () => {
    vi.useFakeTimers();
    const store = useSkyTimeStore();
    store.stepRateForward();
    store.setSimDate(new Date('2026-01-01T00:00:00.000Z'));
    store.togglePaused();
    const frozen = store.simDate.getTime();

    store.toggleMode(); // -> live
    vi.advanceTimersByTime(10_000);
    store.toggleMode(); // -> date again, still paused

    expect(store.simDate.getTime()).toBe(frozen);
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

    store.stepRateBackward(); // reaches the pivot, now facing backward: 1x reverse
    expect(store.effectiveRate).toBe(-1);

    store.stepRateBackward(); // now starts climbing backward from -1x
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
    expect(store.effectiveRate).toBe(1);

    store.stepRateForward();
    expect(store.effectiveRate).toBe(RATE_LADDER[0]);
  });

  it('setRateNormal resets the dial to 1x and unpauses, from any state', () => {
    const store = useSkyTimeStore();
    store.stepRateBackward();
    store.stepRateBackward();
    store.togglePaused();

    store.setRateNormal();

    expect(store.effectiveRate).toBe(1);
    expect(store.paused).toBe(false);
  });

  it('togglePaused freezes simDate where it is, without resetting to "now" or touching the rate', () => {
    const store = useSkyTimeStore();
    store.toggleMode();
    const frozen = new Date('2020-01-01T00:00:00.000Z');
    store.setSimDate(frozen);
    store.stepRateForward();
    const rateBefore = store.effectiveRate;

    store.togglePaused();

    expect(store.paused).toBe(true);
    expect(store.effectiveRate).toBe(rateBefore);
    expect(store.simDate.getTime()).toBe(frozen.getTime());

    store.togglePaused();
    expect(store.paused).toBe(false);
    expect(store.effectiveRate).toBe(rateBefore);
  });

  it('resetToNow jumps simDate back to "now" and resets the dial to 1x, unpaused', () => {
    const store = useSkyTimeStore();
    store.setSimDate(new Date('2020-01-01T00:00:00.000Z'));
    store.stepRateForward();
    store.togglePaused();
    const before = Date.now();

    store.resetToNow();

    expect(store.effectiveRate).toBe(1);
    expect(store.paused).toBe(false);
    expect(Math.abs(store.simDate.getTime() - before)).toBeLessThan(1000);
  });

  it('jumpToEvening keeps the calendar day and moves to a default hour without a location', () => {
    const store = useSkyTimeStore();
    store.toggleMode(); // consume the session's first-activation reset first
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
    store.toggleMode(); // consume the session's first-activation reset first
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

  it('remembers showMoon and showAzimuthGrid across mode switches, like simDate', () => {
    const store = useSkyTimeStore();
    store.toggleMode(); // -> date
    store.setShowMoon(true);
    store.setShowAzimuthGrid(true);

    store.toggleMode(); // -> live
    expect(store.mode).toBe('live');
    expect(store.showMoon).toBe(true);
    expect(store.showAzimuthGrid).toBe(true);

    store.toggleMode(); // -> date again, same session
    expect(store.showMoon).toBe(true);
    expect(store.showAzimuthGrid).toBe(true);
  });

  it('setShowSun and setShowPlanets toggle independently and persist', () => {
    const store = useSkyTimeStore();
    store.setShowSun(true);
    expect(store.showSun).toBe(true);
    expect(store.showPlanets).toBe(false);
    expect(JSON.parse(localStorage.getItem(SKY_TIME_SETTINGS_KEY)!).showSun).toBe(true);

    store.setShowPlanets(true);
    expect(store.showPlanets).toBe(true);
    expect(JSON.parse(localStorage.getItem(SKY_TIME_SETTINGS_KEY)!).showPlanets).toBe(true);
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
    store.stepRateForward(); // first activation (jumps to "now") + first rung
    store.setSimDate(new Date('2026-01-01T00:00:00.000Z'));
    const start = store.simDate.getTime();

    vi.advanceTimersByTime(500);
    expect(store.simDate.getTime()).toBe(start + RATE_LADDER[0] * 500);
  });

  it('stops ticking once paused', () => {
    vi.useFakeTimers();
    const store = useSkyTimeStore();
    store.stepRateForward();
    vi.advanceTimersByTime(500);
    store.togglePaused();
    const frozen = store.simDate.getTime();
    vi.advanceTimersByTime(2000);
    expect(store.simDate.getTime()).toBe(frozen);
  });

  describe('setLocalSkyMode', () => {
    it('defaults to false', () => {
      const store = useSkyTimeStore();
      expect(store.localSkyMode).toBe(false);
    });

    it('rejects enabling outside date mode', () => {
      const store = useSkyTimeStore();
      store.setLocation(45, 4);
      store.setLocalSkyMode(true);
      expect(store.localSkyMode).toBe(false);
    });

    it('rejects enabling without an observer location', () => {
      const store = useSkyTimeStore();
      store.toggleMode(); // -> date
      store.setLocalSkyMode(true);
      expect(store.localSkyMode).toBe(false);
    });

    it('enables once date mode + location are both set', () => {
      const store = useSkyTimeStore();
      store.toggleMode(); // -> date
      store.setLocation(45, 4);
      store.setLocalSkyMode(true);
      expect(store.localSkyMode).toBe(true);
    });

    it('auto-disables when leaving date mode', () => {
      const store = useSkyTimeStore();
      store.toggleMode(); // -> date
      store.setLocation(45, 4);
      store.setLocalSkyMode(true);
      store.toggleMode(); // -> live
      expect(store.localSkyMode).toBe(false);
    });

    it('auto-disables when the observer location is cleared', () => {
      const store = useSkyTimeStore();
      store.toggleMode(); // -> date
      store.setLocation(45, 4);
      store.setLocalSkyMode(true);
      store.setLocation(null, null);
      expect(store.localSkyMode).toBe(false);
    });

    it('persists', () => {
      const store = useSkyTimeStore();
      store.toggleMode(); // -> date
      store.setLocation(45, 4);
      store.setLocalSkyMode(true);
      const raw = localStorage.getItem(SKY_TIME_SETTINGS_KEY);
      expect(JSON.parse(raw!).localSkyMode).toBe(true);
    });
  });
});
