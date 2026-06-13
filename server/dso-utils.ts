/**
 * Shared DSO alias normalization used by both solve-field and astrometry.net parsers.
 *
 * Both sources return object names with slash-separated aliases and spaces:
 *   solve-field stdout: "NGC 5457 / M 101"
 *   astrometry.net API: ["NGC 6205", "M 13", "Hercules Globular Cluster"]
 *
 * This function normalizes them to compact IDs with spaces removed:
 *   ["NGC5457", "M101"]
 */
export function normalizeDSOAliases(rawEntries: string[]): string[] {
  return rawEntries.flatMap(entry =>
    entry.split(' / ').map(alias => alias.trim().replace(/\s+/g, '')).filter(Boolean)
  );
}
