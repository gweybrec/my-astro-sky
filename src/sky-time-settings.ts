export const SKY_TIME_SETTINGS_KEY = 'sky-time-settings';

/**
 * Sim-seconds-per-real-second magnitudes, stepped through by the time-warp shortcuts
 * (j/k/l). Deliberately starts at 2 (not 1): the first j/l press from a stop should
 * immediately feel like time-warping, not tick at real-time speed — real-time flow
 * is what live mode already is.
 */
export const RATE_LADDER = [2, 5, 10, 30, 60, 300, 900, 3600, 21600, 86400];

export interface SkyTimeSettings {
  mode: 'live' | 'date';
  simDateISO: string;
  lat: number | null;
  lon: number | null;
  /** 0 = stopped; otherwise an index into RATE_LADDER (1-based: index 1 = ladder[0]). */
  timeRateIndex: number;
  timeRateSign: 1 | -1;
  showMoon: boolean;
  showAzimuthGrid: boolean;
}

export const DEFAULT_SETTINGS: SkyTimeSettings = {
  mode: 'live',
  simDateISO: new Date().toISOString(),
  lat: null,
  lon: null,
  timeRateIndex: 0,
  timeRateSign: 1,
  showMoon: false,
  showAzimuthGrid: false,
};

export function loadSkyTimeSettings(): SkyTimeSettings {
  try {
    const raw = localStorage.getItem(SKY_TIME_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, simDateISO: new Date().toISOString() };
}

export function saveSkyTimeSettings(settings: SkyTimeSettings): void {
  localStorage.setItem(SKY_TIME_SETTINGS_KEY, JSON.stringify(settings));
}
