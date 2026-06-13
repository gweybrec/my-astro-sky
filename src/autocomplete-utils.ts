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
    .filter(l => !excluded.has(l) && (!q || l.toLowerCase().includes(q)))
    .slice(0, maxResults);
}
