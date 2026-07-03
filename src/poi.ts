import type { PointOfInterest, PoiCategory } from './types';
import { t } from './i18n';

/** Stable id for the synthetic group that holds POIs whose category was deleted. */
export const UNCATEGORIZED_ID = '__uncategorized__';

/** Muted token-driven colour for the Uncategorized group / orphan chips. */
export const UNCATEGORIZED_COLOR = '#888888';

/** The synthetic category shown for POIs whose `categoryId` no longer resolves. */
export function uncategorizedCategory(): PoiCategory {
  return {
    id: UNCATEGORIZED_ID,
    name: t('poi.uncategorized'),
    color: UNCATEGORIZED_COLOR,
    position: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Resolve a POI's categoryId to its category, falling back to the synthetic
 * "Uncategorized" category when the id is unknown (category deleted). Every surface
 * (chips, filters, map) calls this so orphans are treated identically everywhere.
 */
export function resolveCategory(categoryId: string, categories: PoiCategory[]): PoiCategory {
  return categories.find((c) => c.id === categoryId) ?? uncategorizedCategory();
}

export interface PoiGroup {
  category: PoiCategory;
  pois: PointOfInterest[];
}

/**
 * Group a photo's POIs by their resolved category, ordered by category position
 * (Uncategorized last). Categories with no matching POI are omitted.
 */
export function groupPoisByCategory(
  pois: PointOfInterest[],
  categories: PoiCategory[],
): PoiGroup[] {
  const byId = new Map<string, PoiGroup>();
  for (const poi of pois) {
    const cat = resolveCategory(poi.categoryId, categories);
    let group = byId.get(cat.id);
    if (!group) {
      group = { category: cat, pois: [] };
      byId.set(cat.id, group);
    }
    group.pois.push(poi);
  }
  return Array.from(byId.values()).sort((a, b) => a.category.position - b.category.position);
}

/**
 * Two-level catalogue across many photos: every category that appears in any POI,
 * with its distinct POI names and how many photos contain each name. Used by the
 * gallery and sky filters. Categories with no POIs across the set are omitted.
 */
export interface PoiFilterGroup {
  category: PoiCategory;
  /** Distinct POI names within this category, with per-photo counts. */
  names: Array<{ name: string; count: number }>;
}

export function buildPoiFilterGroups(
  photoPois: PointOfInterest[][],
  categories: PoiCategory[],
): PoiFilterGroup[] {
  // categoryId → (name → photo count)
  const counts = new Map<string, Map<string, number>>();
  for (const pois of photoPois) {
    // De-dupe within a single photo so one photo counts once per (category, name).
    const seen = new Set<string>();
    for (const poi of pois) {
      const cat = resolveCategory(poi.categoryId, categories);
      const key = `${cat.id}\u001f${poi.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let names = counts.get(cat.id);
      if (!names) {
        names = new Map();
        counts.set(cat.id, names);
      }
      names.set(poi.name, (names.get(poi.name) ?? 0) + 1);
    }
  }
  const groups: PoiFilterGroup[] = [];
  for (const [catId, names] of counts) {
    const category =
      catId === UNCATEGORIZED_ID
        ? uncategorizedCategory()
        : (categories.find((c) => c.id === catId) ?? uncategorizedCategory());
    groups.push({
      category,
      names: Array.from(names.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups.sort((a, b) => a.category.position - b.category.position);
}

/**
 * Drop selections that no longer exist in `groups`: categories that vanished, and
 * named selections whose name is gone. An empty name-set ("whole category") is kept
 * as long as the category still has any POIs. Returns a new Map; the input is untouched.
 *
 * Call this after rebuilding filter groups (photo/category change) so a stale
 * selection — e.g. a name whose only photo was deleted — can't keep filtering and
 * silently hide every remaining photo.
 */
export function prunePoiSelection(
  selected: Map<string, Set<string>>,
  groups: PoiFilterGroup[],
): Map<string, Set<string>> {
  const available = new Map<string, Set<string>>(
    groups.map((g) => [g.category.id, new Set(g.names.map((n) => n.name))]),
  );
  const pruned = new Map<string, Set<string>>();
  for (const [catId, names] of selected) {
    const avail = available.get(catId);
    if (!avail) continue; // category no longer present
    if (names.size === 0) {
      pruned.set(catId, new Set());
      continue;
    } // "whole category"
    const kept = new Set<string>();
    for (const n of names) if (avail.has(n)) kept.add(n);
    if (kept.size > 0) pruned.set(catId, kept); // drop entirely if no name survives
  }
  return pruned;
}

/**
 * Structural equality for two POI selections (categoryId → name set). Used to avoid
 * re-applying / re-rendering when a prune left the selection unchanged.
 */
export function poiSelectionsEqual(
  a: Map<string, Set<string>>,
  b: Map<string, Set<string>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv || bv.size !== av.size) return false;
    for (const n of av) if (!bv.has(n)) return false;
  }
  return true;
}

/**
 * Does `pois` satisfy a two-level filter? `selected` maps categoryId → set of
 * selected POI names within it (an empty set means "the whole category, any name").
 * A photo passes if it has ≥1 POI whose category is selected and whose name is in
 * that category's selected-name set (or the set is empty ⇒ all names).
 *
 * `selected === null` disables the filter (everything passes).
 */
export function poisMatchFilter(
  pois: PointOfInterest[],
  categories: PoiCategory[],
  selected: Map<string, Set<string>> | null,
): boolean {
  if (selected === null) return true;
  for (const poi of pois) {
    const catId = resolveCategory(poi.categoryId, categories).id;
    const names = selected.get(catId);
    if (!names) continue; // category not selected
    if (names.size === 0 || names.has(poi.name)) return true;
  }
  return false;
}
