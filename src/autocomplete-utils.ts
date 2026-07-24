/**
 * Returns display labels from knownFilterMap whose name contains `query` (case-insensitive).
 * An empty query returns all entries. Results are capped at `maxResults`.
 */
export function filterFilterCandidates(
  knownFilterMap: Map<string, string>,
  query: string,
  maxResults = 8,
): string[] {
  const q = query.trim().toLowerCase();
  const results: string[] = [];
  for (const [, label] of knownFilterMap.entries()) {
    if (q && !label.toLowerCase().includes(q)) continue;
    results.push(label);
    if (results.length >= maxResults) break;
  }
  return results;
}

/** One entry of a filter autocomplete dropdown. */
export interface FilterCandidate {
  /** The value written into the integration row / observation window. */
  label: string;
  /** Catalog badge colour (`#rrggbb`), or null for a generic band name. */
  color: string | null;
  /** Short spec line shown under the badge, e.g. "Ha · 656.3nm / 3nm". */
  detail: string | null;
}

/** The subset of a catalog filter this module needs — keeps it free of gear-catalog imports. */
export interface FilterCatalogEntry {
  label: string;
  color: string;
  detail: string | null;
  brand: string;
  model: string;
  series: string | null;
  subtype: string;
}

/**
 * Candidates for a filter field, drawn from two sources in priority order:
 *
 *   1. `knownFilterMap` — the generic band names (L/R/G/B/Ha/OIII/SII/RGB) plus
 *      whatever the user has already typed on other photos. These stay first so
 *      typing "ha" still offers the plain `Ha` before any product named after it.
 *   2. `catalog` — real filter products. Callers pass the visible set (hidden
 *      filters already removed), so curating "my filters" narrows the dropdown.
 *
 * A catalog entry matches on its brand, model, series, subtype **or** its display
 * label, because the label frequently differs from the model ("Antlia Pro
 * Luminance" vs "Pro LRGB – L") and either should find it. Results are
 * de-duplicated case-insensitively by label.
 *
 * By default the list is **uncapped** (`Infinity`): on an empty query the field
 * offers the whole catalog for browsing, and it narrows down as the user types.
 * The dropdown itself scrolls (`.tag-suggest` is `overflow-y: auto`). Pass a
 * finite `maxResults` to cap it.
 */
export function filterCandidatesWithCatalog(
  knownFilterMap: Map<string, string>,
  catalog: FilterCatalogEntry[],
  query: string,
  maxResults = Infinity,
): FilterCandidate[] {
  const q = query.trim().toLowerCase();
  const results: FilterCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: FilterCandidate): boolean => {
    const key = candidate.label.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    results.push(candidate);
    return results.length >= maxResults;
  };

  for (const label of filterFilterCandidates(knownFilterMap, query, maxResults)) {
    if (push({ label, color: null, detail: null })) return results;
  }

  for (const entry of catalog) {
    const matches =
      !q ||
      entry.label.toLowerCase().includes(q) ||
      entry.brand.toLowerCase().includes(q) ||
      entry.model.toLowerCase().includes(q) ||
      (entry.series?.toLowerCase().includes(q) ?? false) ||
      entry.subtype.toLowerCase().includes(q);
    if (!matches) continue;
    if (push({ label: entry.label, color: entry.color, detail: entry.detail })) return results;
  }

  return results;
}

/**
 * Returns labels from `knownLabels` that:
 *   - are not already in `currentLabels` (excluded from suggestions)
 *   - contain `query` as a substring (case-insensitive); all pass when query is empty
 * Results are capped at `maxResults`.
 */
export function filterLabelCandidates(
  knownLabels: string[],
  currentLabels: string[],
  query: string,
  maxResults = 8,
): string[] {
  const excluded = new Set(currentLabels);
  const q = query.trim().toLowerCase();
  return knownLabels
    .filter((l) => !excluded.has(l) && (!q || l.toLowerCase().includes(q)))
    .slice(0, maxResults);
}
