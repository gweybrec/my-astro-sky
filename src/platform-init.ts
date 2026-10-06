import { configureI18n } from '@myastrosky/core/i18n/index';
import { configureStorage } from '@myastrosky/core/platform/storage';
import { configureErrorReporter } from '@myastrosky/core/platform/error-hook';
import { configureDeviceHints } from '@myastrosky/core/platform/device-hints';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { configureStarSearch } from '@myastrosky/core/platform/star-search';
import type { KeyValueStore } from '@myastrosky/core/ports/key-value-store';
import { createHttpBackend } from '@myastrosky/backend-http/http-backend';
import { setBackend } from '@myastrosky/app-state/backend';
import { getLang } from '@myastrosky/core/i18n/index';
import { reportUnknownRendererError } from './error-reporter';
import { downloadBlob } from './file-utils';

/** The browser's localStorage, which can throw (private window, blocked site data). */
export function createLocalStorageStore(): KeyValueStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

configureI18n({
  storedLang: () => localStorage.getItem('lang'),
  storeLang: (l) => localStorage.setItem('lang', l),
  preferredLanguages: () => navigator.languages,
  reload: () => location.reload(),
  onMissingKey: (k) => {
    if (import.meta.env.DEV) console.warn(`[i18n] Missing key: "${k}"`);
  },
});

configureStorage(createLocalStorageStore());
configureErrorReporter((context, error, details) =>
  reportUnknownRendererError(context, error, details),
);
configureDeviceHints(() => (typeof navigator !== 'undefined' ? navigator : {}));
// `src/api` is imported lazily so that start-up does not load it before a test's mock applies.
configureGearCatalogLoader(async (type) => (await import('./api')).getGearCatalog(type));
configureStarSearch(async (query, limit) => (await import('./api')).searchStarsAPI(query, limit));

// The desktop and the web build run on the HTTP backend; the phone installs its own at start-up.
setBackend(
  createHttpBackend({ lang: getLang, saveFile: (name, blob) => downloadBlob(blob, name) }),
);
