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
import { loadDsoCatalogData, loadStarCatalogData } from '@myastrosky/app-state/catalog-loaders';

let loading: Promise<void> | null = null;

/** Starts the load (once) and returns the promise every screen waits on. */
export function catalogsReady(): Promise<void> {
  loading ??= (async () => {
    try {
      await Promise.all([
        getTelescopes(),
        getCameras(),
        getAccessories(),
        getFilters(),
        loadStarCatalogData({
          lang: getLang(),
          starCatalogUrl: getStarCatalogUrl,
          loadError: (url, status, statusText) =>
            t('errors.catalogLoad', { url, status, statusText }),
        }),
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
