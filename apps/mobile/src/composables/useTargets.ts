import { reactive, toRaw } from 'vue';
import {
  loadTargetsPrefs,
  saveTargetsPrefs,
  type SortKey,
  type TargetsPrefs,
} from '@myastrosky/core/targets/prefs';

/**
 * The Targets tab's preferences, shared by the list, its sheets and the regions page. They are the desktop's
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

/**
 * What "Réinitialiser" of the search settings sheet puts back to the desktop's defaults (the keys it removes), with
 * the filters below: the sky, the observation window and the three switches. The sort, the night and the location are
 * kept.
 */
export const SEARCH_PREF_KEYS = [
  'horizonDirs',
  'skyRegionId',
  'minAltDeg',
  'maxAltDeg',
  'obsStartTime',
  'obsEndTime',
  'includeOversized',
  'excludePhotographed',
  'respectHorizon',
] as const satisfies readonly (keyof TargetsPrefs)[];

/** The four filters on the objects, which "Réinitialiser" of the search settings sheet removes too. */
export const FILTER_PREF_KEYS = [
  'enabledRatings',
  'enabledDifficulties',
  'enabledCatalogs',
  'enabledConstellations',
] as const satisfies readonly (keyof TargetsPrefs)[];

/** The desktop's sorts of the targets list, in its order, with the key of each one's name. */
export const TARGET_SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'rating', label: 'targets.sort.rating' },
  { key: 'score', label: 'targets.sort.score' },
  { key: 'altitude', label: 'targets.sort.altitude' },
  { key: 'transit', label: 'targets.sort.transit' },
  { key: 'magnitude', label: 'targets.sort.magnitude' },
  { key: 'size', label: 'targets.sort.size' },
  { key: 'fov-fit', label: 'targets.sort.fovFit' },
  { key: 'name', label: 'targets.sort.name' },
  { key: 'difficulty', label: 'targets.sort.difficulty' },
];
