import type { StarMultiplicity } from '../types';

/** i18n key for a system's type name, by star count (2 = binary … 8 = octuple). */
const MULTIPLE_KEY_BY_COUNT: Record<number, string> = {
  2: 'stars.multiple.binary',
  3: 'stars.multiple.triple',
  4: 'stars.multiple.quadruple',
  5: 'stars.multiple.quintuple',
  6: 'stars.multiple.sextuple',
  7: 'stars.multiple.septuple',
  8: 'stars.multiple.octuple',
};

/** Localised display string for a star's multiplicity, e.g. "Binary · 34.3″"; `translate` is the app's `t`. */
export function formatMultiplicity(
  m: StarMultiplicity,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  const key = MULTIPLE_KEY_BY_COUNT[m.components];
  const typeName = key ? translate(key) : translate('stars.multiple.system', { n: m.components });
  return m.sep ? `${typeName} · ${m.sep}″` : typeName;
}
