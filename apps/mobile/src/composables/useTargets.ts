import { reactive, toRaw } from 'vue';
import {
  loadTargetsPrefs,
  saveTargetsPrefs,
  type TargetsPrefs,
} from '@myastrosky/core/targets/prefs';

/**
 * The Targets tab's preferences, shared by the list, its two sheets and the regions page. They are the desktop's
 * record (`targets-prefs-v3`): a change is written at once, merged over what is stored so that the location written by
 * the Réglages screens in the meantime is kept.
 */
export const targetsPrefs = reactive<TargetsPrefs>(loadTargetsPrefs());

function replacePrefs(next: TargetsPrefs): void {
  for (const key of Object.keys(targetsPrefs))
    delete (targetsPrefs as Record<string, unknown>)[key];
  Object.assign(targetsPrefs, next);
}

/** Reads the stored record again (the location may have changed in Réglages). */
export function reloadTargetsPrefs(): void {
  replacePrefs(loadTargetsPrefs());
}

/** Applies and stores a change; a key set to `undefined` is removed. */
export function updateTargetsPrefs(patch: Partial<TargetsPrefs>): void {
  const next = { ...loadTargetsPrefs(), ...toRaw(patch) } as TargetsPrefs;
  for (const key of Object.keys(next) as (keyof TargetsPrefs)[]) {
    if (next[key] === undefined) delete next[key];
  }
  saveTargetsPrefs(next);
  replacePrefs(next);
}

/** The filters the "Réinitialiser" button of the filters sheet puts back to the desktop's defaults (the keys it removes). */
export const FILTER_PREF_KEYS = [
  'horizonDirs',
  'skyRegionId',
  'minAltDeg',
  'maxAltDeg',
  'obsStartTime',
  'obsEndTime',
  'enabledRatings',
  'enabledDifficulties',
  'enabledCatalogs',
  'enabledConstellations',
  'includeOversized',
  'excludePhotographed',
  'respectHorizon',
] as const satisfies readonly (keyof TargetsPrefs)[];
