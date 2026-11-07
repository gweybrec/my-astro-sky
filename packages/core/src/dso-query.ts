/**
 * Slips of the keyboard read as the catalogue meant: a search typed with one of these prefixes also finds what the
 * same text with the catalogue's real prefix finds ("ngv 7000" and "nhc7000" find NGC 7000). None of them is a
 * catalogue, a designation or a name in the data, so nothing is hidden by them.
 */
const TYPO_PREFIXES: readonly [RegExp, string][] = [
  [/^ngv/i, 'ngc'],
  [/^nhc/i, 'ngc'],
];

/**
 * The texts an object search is matched with: the typed text first, then its reading with a mistyped catalogue
 * prefix corrected, when it starts with one (leading spaces ignored).
 */
export function dsoQueryVariants(query: string): string[] {
  const text = query.trimStart();
  for (const [typo, meant] of TYPO_PREFIXES) {
    if (typo.test(text)) return [query, text.replace(typo, meant)];
  }
  return [query];
}
