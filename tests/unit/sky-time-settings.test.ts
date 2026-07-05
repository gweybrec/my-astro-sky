import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSkyTimeSettings,
  saveSkyTimeSettings,
  SKY_TIME_SETTINGS_KEY,
  RATE_LADDER,
  DEFAULT_SETTINGS,
  type SkyTimeSettings,
} from '../../src/sky-time-settings';

describe('sky-time-settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults (live mode, no location, 1x baseline, unpaused) with no stored value', () => {
    const s = loadSkyTimeSettings();
    expect(s.mode).toBe('live');
    expect(s.lat).toBeNull();
    expect(s.lon).toBeNull();
    expect(s.timeRateIndex).toBe(0);
    expect(s.timeRateSign).toBe(1);
    expect(s.paused).toBe(false);
    expect(s.showMoon).toBe(false);
    expect(s.showAzimuthGrid).toBe(false);
    expect(s.localSkyMode).toBe(false);
    // simDateISO must be a valid, parseable ISO date close to "now".
    expect(new Date(s.simDateISO).getTime()).not.toBeNaN();
    expect(Math.abs(s.lastSyncEpochMs - Date.now())).toBeLessThan(1000);
  });

  it('round-trips a saved settings object', () => {
    const settings: SkyTimeSettings = {
      mode: 'date',
      simDateISO: '2026-01-15T22:30:00.000Z',
      lat: 45.5,
      lon: -73.6,
      timeRateIndex: 3,
      timeRateSign: -1,
      paused: true,
      lastSyncEpochMs: 1700000000000,
      showMoon: true,
      showAzimuthGrid: true,
      localSkyMode: true,
    };
    saveSkyTimeSettings(settings);
    const loaded = loadSkyTimeSettings();
    expect(loaded).toEqual(settings);
  });

  it('merges a partial/legacy stored value with defaults', () => {
    localStorage.setItem(SKY_TIME_SETTINGS_KEY, JSON.stringify({ showMoon: true }));
    const loaded = loadSkyTimeSettings();
    expect(loaded.showMoon).toBe(true);
    expect(loaded.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(loaded.lat).toBe(DEFAULT_SETTINGS.lat);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(SKY_TIME_SETTINGS_KEY, '{not json');
    const loaded = loadSkyTimeSettings();
    expect(loaded.mode).toBe('live');
    expect(loaded.timeRateIndex).toBe(0);
  });

  it('rate ladder is ascending and skips 1x (first rung already feels like a warp)', () => {
    expect(RATE_LADDER[0]).toBeGreaterThan(1);
    for (let i = 1; i < RATE_LADDER.length; i++) {
      expect(RATE_LADDER[i]).toBeGreaterThan(RATE_LADDER[i - 1]);
    }
  });
});
