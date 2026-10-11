import { storage } from '../platform/storage';
import { TARGETS_PREFS_KEY } from '../observer-location';

export type SortKey =
  | 'score'
  | 'altitude'
  | 'transit'
  | 'magnitude'
  | 'size'
  | 'fov-fit'
  | 'name'
  | 'rating'
  | 'difficulty';

/** The Targets tab's preferences, stored under {@link TARGETS_PREFS_KEY}; the desktop and the phone read and write the same record. */
export interface TargetsPrefs {
  setupId: string | null;
  lat: number | null;
  lon: number | null;
  lastDateISO: string | null;
  coordFormat?: 'decimal' | 'dms';
  enabledTypes?: string[];
  resultLimit?: number;
  sortBy?: SortKey;
  horizonDirs?: string[];
  /** Selected saved sky-region id, or null/undefined for "no region filter". */
  skyRegionId?: string | null;
  enabledRatings?: number[];
  enabledDifficulties?: number[];
  enabledCatalogs?: string[];
  includeOversized?: boolean;
  excludePhotographed?: boolean;
  pageSize?: number;
  enabledConstellations?: string[];
  minAltDeg?: number;
  maxAltDeg?: number;
  respectHorizon?: boolean;
  showMoon?: boolean;
  showCardinal?: boolean;
  obsStartTime?: string | null;
  obsEndTime?: string | null;
}

/** Loads the preferences, migrating the older v2 key (which held a telescope, a camera and an accessory) when there is no v3 record. */
export function loadTargetsPrefs(): TargetsPrefs {
  try {
    const raw = storage().get(TARGETS_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TargetsPrefs;
      if ('setupId' in parsed) return parsed;
    }
    // Migrate from v2 (had telescopeId/cameraId/accessoryId) — copy non-gear fields
    const legacy = storage().get('targets-prefs-v2');
    if (legacy) {
      const old = JSON.parse(legacy) as Partial<TargetsPrefs>;
      return {
        setupId: null,
        lat: old.lat ?? null,
        lon: old.lon ?? null,
        lastDateISO: old.lastDateISO ?? null,
        coordFormat: old.coordFormat,
        enabledTypes: old.enabledTypes,
        sortBy: old.sortBy,
        horizonDirs: old.horizonDirs,
        enabledRatings: old.enabledRatings,
        enabledDifficulties: old.enabledDifficulties,
        enabledCatalogs: old.enabledCatalogs,
        includeOversized: old.includeOversized,
        pageSize: old.pageSize,
      };
    }
  } catch {
    // ignore
  }
  return { setupId: null, lat: null, lon: null, lastDateISO: null };
}

export function saveTargetsPrefs(p: TargetsPrefs): void {
  storage().set(TARGETS_PREFS_KEY, JSON.stringify(p));
}
