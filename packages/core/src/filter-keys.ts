const KNOWN_FILTER_CSS_KEYS = new Set([
  'ha',
  'oiii',
  'sii',
  'l',
  'r',
  'g',
  'b',
  'rgb',
  'dual-band',
]);

/**
 * Maps a filter name to its CSS token key: a known filter → its own key
 * (e.g. 'Ha' → 'ha'), anything else → 'custom'. Both `.filter-{key}` classes
 * and the `--filter-{key}` colour tokens follow this key.
 */
export function filterCssKey(name: string | null | undefined): string {
  const key = (name ?? '').toLowerCase();
  return KNOWN_FILTER_CSS_KEYS.has(key) ? key : 'custom';
}
