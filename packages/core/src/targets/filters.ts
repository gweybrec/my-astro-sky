import type { DSO } from '../types';
import { getDSOCatalog } from '../catalog/dso-registry';

/** Every object type the recommendation can propose, in the order of the type filter. */
export const ALL_DSO_TYPES = [
  'GxS',
  'GxE',
  'GxI',
  'Gx',
  'OC',
  'GC',
  'EN',
  'RN',
  'PN',
  'SNR',
  'DN',
  'PS',
  'MS',
] as const;

export interface DSOFilterOptions {
  enabledTypes: Set<string>;
  enabledRatings: Set<number>;
  enabledDifficulties: Set<number>;
  enabledCatalogs: Set<string>;
  photographedIds: Set<string> | null;
  enabledConstellations: Set<string> | null;
}

export function filterTargetDSOs(dsos: DSO[], opts: DSOFilterOptions): DSO[] {
  return dsos.filter((d) => {
    if (!opts.enabledTypes.has(d.type as string)) return false;
    if (d.rating !== null && !opts.enabledRatings.has(d.rating)) return false;
    if (d.difficulty !== null && !opts.enabledDifficulties.has(d.difficulty)) return false;
    const cat = getDSOCatalog(d.id);
    if (cat !== null && !opts.enabledCatalogs.has(cat)) return false;
    if (opts.photographedIds !== null && opts.photographedIds.has(d.id)) return false;
    if (
      opts.enabledConstellations !== null &&
      d.constellation !== null &&
      !opts.enabledConstellations.has(d.constellation)
    )
      return false;
    return true;
  });
}
