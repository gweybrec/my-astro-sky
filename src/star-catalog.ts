import type { StarMultiplicity, ConstellationStyle } from '@myastrosky/core/types';
import { getLang, t } from './i18n';
import { getStarCatalogUrl } from './api';
import { normalizeRA } from '@myastrosky/core/angles';
import { nearestNamedStar, starDisplayName } from '@myastrosky/core/catalog/star-registry';
import {
  loadConstellationStyleData,
  loadStarCatalogData,
  type StarLoaderOptions,
} from '@myastrosky/app-state/catalog-loaders';

export * from '@myastrosky/core/catalog/star-registry';

export { normalizeRA };

/** What the shared loaders need from the desktop: its language, its backend's catalogue address and its message. */
function loaderOptions(): StarLoaderOptions {
  return {
    lang: getLang(),
    starCatalogUrl: getStarCatalogUrl,
    loadError: (url, status, statusText) => t('errors.catalogLoad', { url, status, statusText }),
  };
}

export async function loadCatalog(): Promise<void> {
  await loadStarCatalogData(loaderOptions());
}

export async function loadConstellationStyle(style: ConstellationStyle): Promise<void> {
  await loadConstellationStyleData(style, loaderOptions());
}

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

/** Localised display string for a star's multiplicity, e.g. "Binary · 34.3″". */
export function formatMultiplicity(m: StarMultiplicity): string {
  const key = MULTIPLE_KEY_BY_COUNT[m.components];
  const typeName = key ? t(key) : t('stars.multiple.system', { n: m.components });
  return m.sep ? `${typeName} · ${m.sep}″` : typeName;
}

/**
 * Display label for a custom-location frame (no DSO): the nearest named star, or the
 * generic "custom location" string when none is close. Display-only — the frame's
 * anchor (dsoId) is unaffected.
 */
export function customLocationLabel(ra: number, dec: number): string {
  const s = nearestNamedStar(ra, dec);
  return s ? starDisplayName(s) : t('fovOverlay.customLocation');
}
