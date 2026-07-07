import type { DSO } from './types';
import type { PlanSortKey } from './api';

/** Minimal shape needed to order a plan's objects — satisfied by PlanTargetInfo. */
export interface PlanSortItem {
  entryId: string;
  dso: DSO;
  /** Max altitude (°) reached during the night window. */
  maxAltDeg: number;
  /** Culmination time within the night window (the default transit order). */
  bestTimeUtc: Date;
}

/**
 * Order a plan's resolved objects by the chosen sort key.
 *
 * Mirrors the Targets-search comparators (same nullish fallbacks) for the shared
 * keys, plus `window`: entries that have an observation window come first,
 * ascending by their earliest window start; entries without one sort last,
 * tie-broken by transit (today's default order). `firstWindowFrac` maps
 * `entryId → earliest startFrac` (absent ⇒ the entry has no window). Because all
 * entries in one plan share the same night window, ordering by `startFrac` is
 * chronological.
 */
export function sortPlanTargets<T extends PlanSortItem>(
  items: readonly T[],
  sortKey: PlanSortKey,
  firstWindowFrac: Map<string, number>,
): T[] {
  const arr = [...items];
  const byTransit = (a: T, b: T): number => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime();
  switch (sortKey) {
    case 'altitude':
      return arr.sort((a, b) => b.maxAltDeg - a.maxAltDeg);
    case 'magnitude':
      return arr.sort((a, b) => (a.dso.mag ?? 99) - (b.dso.mag ?? 99));
    case 'size':
      return arr.sort((a, b) => (b.dso.majAxis ?? 0) - (a.dso.majAxis ?? 0));
    case 'name':
      return arr.sort((a, b) =>
        (a.dso.catalogs[0] ?? a.dso.id).localeCompare(b.dso.catalogs[0] ?? b.dso.id, undefined, {
          numeric: true,
        }),
      );
    case 'rating':
      return arr.sort((a, b) => (b.dso.rating ?? 0) - (a.dso.rating ?? 0));
    case 'difficulty':
      return arr.sort((a, b) => (b.dso.difficulty ?? 0) - (a.dso.difficulty ?? 0));
    case 'window':
      return arr.sort((a, b) => {
        const fa = firstWindowFrac.get(a.entryId) ?? Infinity;
        const fb = firstWindowFrac.get(b.entryId) ?? Infinity;
        if (fa !== fb) return fa - fb;
        return byTransit(a, b);
      });
    case 'transit':
    default:
      return arr.sort(byTransit);
  }
}

/**
 * Build the `entryId → earliest observation-window startFrac` map that
 * `sortPlanTargets('window', …)` consumes. Entries without any window are simply
 * omitted (treated as `Infinity` = sorted last).
 */
export function firstWindowFracByEntry(
  entries: ReadonlyArray<{ id: string; observationWindows?: Array<{ startFrac: number }> }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const windows = e.observationWindows ?? [];
    if (windows.length === 0) continue;
    map.set(
      e.id,
      windows.reduce((min, w) => Math.min(min, w.startFrac), Infinity),
    );
  }
  return map;
}
