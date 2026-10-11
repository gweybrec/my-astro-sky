import type { StarMultiplicity, ConstellationStyle } from '@myastrosky/core/types';
import { formatMultiplicity as formatMultiplicityWith } from '@myastrosky/core/targets/multiplicity';
import { getLang, t } from './i18n';
import { getStarCatalogUrl } from './api';
import { normalizeRA } from '@myastrosky/core/angles';
import { customLocationLabelOr } from '@myastrosky/core/targets/plan';
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

/** Localised display string for a star's multiplicity, e.g. "Binary · 34.3″". */
export function formatMultiplicity(m: StarMultiplicity): string {
  return formatMultiplicityWith(m, t);
}

/**
 * Display label for a custom-location frame (no DSO): the nearest named star, or the
 * generic "custom location" string when none is close. Display-only — the frame's
 * anchor (dsoId) is unaffected.
 */
export function customLocationLabel(ra: number, dec: number): string {
  return customLocationLabelOr(ra, dec, t('fovOverlay.customLocation'));
}
