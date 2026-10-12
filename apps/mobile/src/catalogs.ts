/**
 * The catalogues the Réglages screens (and the later ones) need: the gear lists, the star registry and the
 * deep-sky registry, loaded as the desktop's start-up does. `main.ts` starts the load after the first screen is
 * shown, so start-up stays fast; a screen that needs the data awaits `catalogsReady()`.
 */
import { getLang, t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import {
  getAccessories,
  getCameras,
  getFilters,
  getTelescopes,
} from '@myastrosky/core/gear-catalog';
import { getDsoOverrides, getStarCatalogUrl } from '@myastrosky/app-state/api';
import {
  loadConstellationStyleData,
  loadDsoCatalogData,
  loadStarCatalogData,
  type StarLoaderOptions,
} from '@myastrosky/app-state/catalog-loaders';
import type { ConstellationStyle } from '@myastrosky/core/types';

let loading: Promise<void> | null = null;

function starLoaderOptions(): StarLoaderOptions {
  return {
    lang: getLang(),
    starCatalogUrl: getStarCatalogUrl,
    loadError: (url, status, statusText) => t('errors.catalogLoad', { url, status, statusText }),
  };
}

/** Loads the lines of one constellation style (the sky map calls it when the style changes). */
export function loadConstellationStyle(style: ConstellationStyle): Promise<void> {
  return loadConstellationStyleData(style, starLoaderOptions());
}

/** Starts the load (once) and returns the promise every screen waits on. */
export function catalogsReady(): Promise<void> {
  loading ??= (async () => {
    try {
      await Promise.all([
        getTelescopes(),
        getCameras(),
        getAccessories(),
        getFilters(),
        loadStarCatalogData(starLoaderOptions()),
        loadDsoCatalogData({ lang: getLang(), getOverrides: getDsoOverrides }),
      ]);
    } catch (error) {
      reportError('catalogs.load', error);
      loading = null; // a later screen may try again
      throw error;
    }
  })();
  return loading;
}
