import { storage } from './platform/storage';
import type { HorizonProfile } from './horizon-io';

/** The storage key of the terrain-horizon settings (shared by the desktop's sky map and the phone). */
export const HORIZON_SETTINGS_KEY = 'horizon-settings-v1';

export interface HorizonSettings {
  /** Whether the terrain horizon is shown on the map. */
  enabled: boolean;
  /** Height of the observer's eyes above the ground, in metres; null = the default. */
  obsHeightM: number | null;
  /** The active skyline: computed from elevation data or imported from a file. */
  profile: HorizonProfile | null;
}

/** The stored settings, or the defaults (nothing shown, no profile) when none or unreadable. */
export function loadHorizonSettings(): HorizonSettings {
  try {
    const raw = storage().get(HORIZON_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        obsHeightM: typeof parsed.obsHeightM === 'number' ? parsed.obsHeightM : null,
        profile: parsed.profile ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: false, obsHeightM: null, profile: null };
}

export function saveHorizonSettings(settings: HorizonSettings): void {
  storage().set(HORIZON_SETTINGS_KEY, JSON.stringify(settings));
}
