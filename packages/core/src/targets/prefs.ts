import { storage } from '../platform/storage';
import { TARGETS_PREFS_KEY } from '../observer-location';
import {
  addLenticularType,
  addProtoplanetaryType,
  renameLegacyCatalogs,
} from '../display-settings';
import { todayISO } from './format';

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

export type SkyAreaMode = 'directions' | 'region';

/** The sky filter in use: the stored mode, else 'region' for a record saved before the mode existed that names a region. */
export function skyAreaModeOf(p: Pick<TargetsPrefs, 'skyAreaMode' | 'skyRegionId'>): SkyAreaMode {
  return p.skyAreaMode ?? (p.skyRegionId ? 'region' : 'directions');
}

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
  /** Which sky filter the search uses: the N/S/E/W directions or the chosen region, never both (default 'directions'). */
  skyAreaMode?: SkyAreaMode;
  /** The directions kept in 'directions' mode (all four, or unset, = the whole sky). */
  horizonDirs?: string[];
  /** The saved sky region used in 'region' mode; kept when the mode switches back to directions. */
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
  /** The plans list shows the archived plans instead of the current ones. */
  showArchivedPlans?: boolean;
  obsStartTime?: string | null;
  obsEndTime?: string | null;
}

/** Loads the preferences, migrating the older v2 key (which held a telescope, a camera and an accessory) when there is no v3 record. */
export function loadTargetsPrefs(): TargetsPrefs {
  try {
    const raw = storage().get(TARGETS_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TargetsPrefs;
      if ('setupId' in parsed) {
        if (parsed.enabledCatalogs)
          parsed.enabledCatalogs = renameLegacyCatalogs(parsed.enabledCatalogs);
        // A record saved before the 'PPN' type existed: tick it once beside the planetary nebulae
        // (the mark is storage only: kept out of the preferences, which are compared to tell a new search)
        const { ppnTypeAdded, gxlTypeAdded, ...prefs } = parsed as TargetsPrefs & {
          ppnTypeAdded?: boolean;
          gxlTypeAdded?: boolean;
        };
        if (prefs.enabledTypes && !ppnTypeAdded)
          prefs.enabledTypes = addProtoplanetaryType(prefs.enabledTypes);
        // Same for the 'GxL' type (lenticular galaxies), beside the elliptical ones
        if (prefs.enabledTypes && !gxlTypeAdded)
          prefs.enabledTypes = addLenticularType(prefs.enabledTypes);
        return prefs;
      }
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
        enabledTypes:
          old.enabledTypes && addLenticularType(addProtoplanetaryType(old.enabledTypes)),
        sortBy: old.sortBy,
        horizonDirs: old.horizonDirs,
        enabledRatings: old.enabledRatings,
        enabledDifficulties: old.enabledDifficulties,
        enabledCatalogs: old.enabledCatalogs && renameLegacyCatalogs(old.enabledCatalogs),
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
  // The marks tell loadTargetsPrefs this record already knows the 'PPN' and 'GxL' types, so they are not ticked again.
  storage().set(
    TARGETS_PREFS_KEY,
    JSON.stringify({ ...p, ppnTypeAdded: true, gxlTypeAdded: true }),
  );
}

/**
 * Puts the night searched back to today, at app start: the filters are kept, but a stored date would silently point at
 * a past night when the app is opened days later.
 */
export function resetTargetsNightToToday(): void {
  saveTargetsPrefs({ ...loadTargetsPrefs(), lastDateISO: todayISO() });
}
