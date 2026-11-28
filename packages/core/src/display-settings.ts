import type { ConstellationStyle } from './types';
import { detectInitialDensity, AUTO_STAR_BUDGET } from './density-slider';
import { deviceHints } from './platform/device-hints';
import { storage } from './platform/storage';

export const SETTINGS_KEY = 'display-settings';

export const DSO_TYPES_ALL = [
  'GxS',
  'GxE',
  'GxL',
  'GxI',
  'Gx',
  'OC',
  'GC',
  'EN',
  'RN',
  'PN',
  'PPN',
  'SNR',
  'DN',
  'PS',
  '?',
];
export const DSO_CATALOGS_DEFAULT_ON = new Set(['M', 'NGC', 'IC', 'SH2']);

export interface DisplaySettings {
  showStars: boolean;
  /** The Milky Way picture under the stars. */
  showMilkyWay: boolean;
  showConstellationLines: boolean;
  showConstellationNames: boolean;
  showStarLabels: boolean;
  showDSOLabels: boolean;
  showGrid: boolean;
  showPhotos: boolean;
  showPhotoOutlines: boolean;
  visibleLabels: { [label: string]: boolean };
  maxStarCount: number;
  maxDSOCount: number;
  /** When true, the star/DSO density budget is auto-tuned to render performance
   * (the slider is driven by the app and disabled). See SkyMap.adaptAutoDensity. */
  autoStarDensity: boolean;
  autoDSODensity: boolean;
  /** When true (default), detail is reduced while panning/zooming for smoother motion.
   * When false, full detail is kept while moving — no flicker, at some performance cost. */
  reduceDetailWhileMoving: boolean;
  skyOpacity: number;
  backgroundOpacity: number;
  showDSOs: boolean;
  /** Pins for positioned POIs (e.g. identified supernovae) over their photos. */
  showPois: boolean;
  /** Sky-map POI pins unchecked in the POI dropdown (`poiKey` → false); absent ⇒ shown. */
  visiblePois: { [poiKey: string]: boolean };
  dsoTypes: string[];
  dsoCatalogs: string[];
  showStarTooltips: boolean;
  showDSOTooltips: boolean;
  simplifiedDSOTooltips: boolean;
  hemisphere: 'north' | 'south';
  borderLatDeg: number;
  mapRotationDeg: number;
  constellationStyle: ConstellationStyle;
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  showStars: true,
  showMilkyWay: true,
  showConstellationLines: true,
  showConstellationNames: true,
  showStarLabels: false,
  showDSOLabels: true,
  showGrid: false,
  showPhotos: true,
  showPhotoOutlines: false,
  visibleLabels: {},
  maxStarCount: 500,
  maxDSOCount: 200,
  autoStarDensity: true,
  autoDSODensity: true,
  reduceDetailWhileMoving: true,
  skyOpacity: 0.7,
  backgroundOpacity: 0.5,
  showDSOs: true,
  showPois: true,
  visiblePois: {},
  dsoTypes: [...DSO_TYPES_ALL],
  dsoCatalogs: [...DSO_CATALOGS_DEFAULT_ON],
  showStarTooltips: true,
  showDSOTooltips: true,
  simplifiedDSOTooltips: false,
  hemisphere: 'north',
  borderLatDeg: 45,
  mapRotationDeg: 0,
  constellationStyle: 'western',
};

export function normalizeRotationDeg(deg: number): number {
  let normalized = ((deg % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

/**
 * A saved catalogue selection with the retired 'LPN' family replaced by 'Other', which now
 * holds those objects (they were never a real catalogue).
 */
export function renameLegacyCatalogs(catalogs: string[]): string[] {
  if (!catalogs.includes('LPN')) return catalogs;
  return [...new Set(catalogs.map((c) => (c === 'LPN' ? 'Other' : c)))];
}

/**
 * A saved type selection with 'PPN' (protoplanetary nebulae, added later) ticked after 'PN' when the user had planetary
 * nebulae ticked. Callers run it only on a record saved without the `ppnTypeAdded` mark (written by every save from
 * this version on), so a later untick is kept.
 */
export function addProtoplanetaryType(types: string[]): string[] {
  if (types.includes('PPN') || !types.includes('PN')) return types;
  const next = [...types];
  next.splice(next.indexOf('PN') + 1, 0, 'PPN');
  return next;
}

/**
 * A saved type selection with 'GxL' (lenticular galaxies, formerly counted as elliptical) ticked after 'GxE' when the
 * user had elliptical galaxies ticked. Callers run it only on a record saved without the `gxlTypeAdded` mark.
 */
export function addLenticularType(types: string[]): string[] {
  if (types.includes('GxL') || !types.includes('GxE')) return types;
  const next = [...types];
  next.splice(next.indexOf('GxE') + 1, 0, 'GxL');
  return next;
}

export function loadSettings(): DisplaySettings {
  try {
    const raw = storage().get(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);

      // Migration: convert old showTooltips to separate star/DSO tooltips
      if ('showTooltips' in parsed && !('showStarTooltips' in parsed)) {
        parsed.showStarTooltips = parsed.showTooltips;
        parsed.showDSOTooltips = parsed.showTooltips;
        delete parsed.showTooltips;
      }

      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      if (!settings.dsoTypes.includes('?')) {
        settings.dsoTypes.push('?');
      }
      // Migration: expand legacy 'Gx' to the three subtypes — only when none of the
      // subtypes are present (old-format data). If any subtype exists, the user is on
      // the new format and may have intentionally deselected some subtypes.
      if (
        settings.dsoTypes.includes('Gx') &&
        !settings.dsoTypes.includes('GxS') &&
        !settings.dsoTypes.includes('GxE') &&
        !settings.dsoTypes.includes('GxI')
      ) {
        const i = settings.dsoTypes.indexOf('Gx');
        settings.dsoTypes.splice(i, 0, 'GxS', 'GxE', 'GxI');
      }
      // Migration: tick the protoplanetary nebulae once for users who see planetary nebulae
      if (!parsed.ppnTypeAdded) settings.dsoTypes = addProtoplanetaryType(settings.dsoTypes);
      delete settings.ppnTypeAdded;
      // Migration: tick the lenticular galaxies once for users who see elliptical galaxies
      if (!parsed.gxlTypeAdded) settings.dsoTypes = addLenticularType(settings.dsoTypes);
      delete settings.gxlTypeAdded;
      // Migration: the former 'LPN' family is now part of 'Other'
      settings.dsoCatalogs = renameLegacyCatalogs(settings.dsoCatalogs);
      settings.mapRotationDeg = normalizeRotationDeg(Number(settings.mapRotationDeg) || 0);
      return pinAutoStarBudget(settings);
    }
  } catch {
    /* ignore */
  }
  // First launch (no saved settings): seed the density budgets from a rough hardware
  // guess so the very first render is reasonable. Auto-tuning refines it immediately.
  const seed = detectInitialDensity(deviceHints());
  return pinAutoStarBudget({ ...DEFAULT_SETTINGS, maxStarCount: seed.star, maxDSOCount: seed.dso });
}

/** In star-auto mode the star budget is fixed (constellations + bright stars); pin it so the
 * renderer and the disabled slider always agree, ignoring any stale stored value. */
function pinAutoStarBudget(settings: DisplaySettings): DisplaySettings {
  if (settings.autoStarDensity) settings.maxStarCount = AUTO_STAR_BUDGET;
  return settings;
}

export function saveSettings(settings: DisplaySettings): void {
  // The marks tell loadSettings this record already knows the 'PPN' and 'GxL' types, so they are not ticked again.
  storage().set(
    SETTINGS_KEY,
    JSON.stringify({ ...settings, ppnTypeAdded: true, gxlTypeAdded: true }),
  );
}
