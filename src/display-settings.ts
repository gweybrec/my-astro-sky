import type { ConstellationStyle } from './types';

export const SETTINGS_KEY = 'display-settings';

export const DSO_TYPES_ALL = ['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?'];
export const DSO_CATALOGS_DEFAULT_ON = new Set(['M', 'NGC', 'IC', 'SH2']);

export interface DisplaySettings {
  showStars: boolean;
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
  skyOpacity: number;
  backgroundOpacity: number;
  showDSOs: boolean;
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
  showConstellationLines: true,
  showConstellationNames: false,
  showStarLabels: false,
  showDSOLabels: true,
  showGrid: false,
  showPhotos: true,
  showPhotoOutlines: false,
  visibleLabels: {},
  maxStarCount: 500,
  maxDSOCount: 200,
  skyOpacity: 0.7,
  backgroundOpacity: 0.5,
  showDSOs: true,
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

export function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
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
      settings.mapRotationDeg = normalizeRotationDeg(Number(settings.mapRotationDeg) || 0);
      return settings;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: DisplaySettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
