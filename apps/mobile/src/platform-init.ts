/**
 * What the phone app sets up before its first screen, in this order: the device storage, the language, the
 * backend, then the hooks the shared code calls (error reporter, device hints, gear catalogue, star search).
 * Awaited by `main.ts` before the app is mounted. In a desktop browser (not a native platform) the same steps run
 * on the HTTP backend of the desktop's server and on `localStorage`, so a screen can be developed in a
 * phone-sized browser window.
 */
import { Capacitor } from '@capacitor/core';
import { configureI18n, getLang } from '@myastrosky/core/i18n/index';
import { configureStorage, storage } from '@myastrosky/core/platform/storage';
import { configureErrorReporter } from '@myastrosky/core/platform/error-hook';
import { configureDeviceHints } from '@myastrosky/core/platform/device-hints';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { configureStarSearch } from '@myastrosky/core/platform/star-search';
import type { KeyValueStore } from '@myastrosky/core/ports/key-value-store';
import { setBackend } from '@myastrosky/app-state/backend';
import { createHttpBackend } from '@myastrosky/backend-http/http-backend';
import { createPreferencesStore } from '@myastrosky/backend-local/preferences-store';

/** The one place that decides which platform the app runs on. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

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

async function createDeviceStorage(): Promise<KeyValueStore> {
  if (!isNativePlatform()) return createLocalStorageStore();
  const { Preferences } = await import('@capacitor/preferences');
  return createPreferencesStore(Preferences, (error) =>
    console.error('Preferences write failed', error),
  );
}

async function createBackend() {
  if (!isNativePlatform()) {
    return createHttpBackend({
      lang: getLang,
      saveFile: (name, blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }
  const { createNativePhoneBackend } = await import('./phone-backend');
  return createNativePhoneBackend();
}

export async function initPlatform(): Promise<void> {
  // 1. The device storage.
  configureStorage(await createDeviceStorage());

  // 2. The language: the stored one, else the phone's preferred languages; a change reloads the page.
  configureI18n({
    storedLang: () => storage().get('lang'),
    storeLang: (l) => storage().set('lang', l),
    preferredLanguages: () => navigator.languages,
    reload: () => location.reload(),
    onMissingKey: (k) => {
      if (import.meta.env.DEV) console.warn(`[i18n] Missing key: "${k}"`);
    },
  });

  // 3. The backend.
  setBackend(await createBackend());

  // 4. The hooks of the shared code, as the desktop's start-up sets them (the error reporter writes to the console).
  configureErrorReporter((context, error, details) => {
    if (details === undefined) console.error(context, error);
    else console.error(context, error, details);
  });
  configureDeviceHints(() => (typeof navigator !== 'undefined' ? navigator : {}));
  configureGearCatalogLoader(async (type) =>
    (await import('@myastrosky/app-state/api')).getGearCatalog(type),
  );
  configureStarSearch(async (query, limit) =>
    (await import('@myastrosky/app-state/api')).searchStarsAPI(query, limit),
  );
}
