/**
 * What the phone app sets up before its first screen, in this order: the device storage, the language, the
 * backend, then the hooks the shared code calls (error reporter, device hints, gear catalogue, star search, constellation lines).
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
import { configureConstellationStyleLoader } from '@myastrosky/core/platform/constellation-style';
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

/** The five top-level tabs: a hardware back press there leaves the app, whatever the tab history holds. */
const TOP_LEVEL_PATHS = [
  '/tabs/sky',
  '/tabs/gallery',
  '/tabs/targets',
  '/tabs/plans',
  '/tabs/settings',
];

/** True when the back button must leave the app: a top-level tab is showing (sub-pages are left to the router). */
export function shouldExitOnBack(path: string): boolean {
  return TOP_LEVEL_PATHS.includes(path.replace(/\/+$/, ''));
}

interface BackRouter {
  currentRoute: { value: { path: string } };
}
type BackRegister = (priority: number, handler: (processNext: () => void) => void) => void;

/** Above Ionic's router (0) and below its overlays and menu (99, 100): runs only when nothing else took the press. */
const BACK_BUTTON_PRIORITY = 1;

/**
 * Native only. Ionic's own handler only walks the history back and Capacitor's App plugin listener bypasses its
 * default exit, so on a top-level tab (with no sheet or dialog open: those register above this priority) the app
 * has to leave by itself; elsewhere the press goes on to the router.
 */
export function installBackButton(router: BackRouter): void {
  if (!isNativePlatform()) return;
  document.addEventListener('ionBackButton', (event) => {
    const { register } = (event as CustomEvent<{ register: BackRegister }>).detail;
    register(BACK_BUTTON_PRIORITY, (processNext) => {
      if (shouldExitOnBack(router.currentRoute.value.path)) {
        void import('@capacitor/app').then(({ App }) => App.exitApp());
      } else {
        processNext();
      }
    });
  });
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

  document.documentElement.lang = getLang();

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
  configureConstellationStyleLoader(async (style) =>
    (await import('./catalogs')).loadConstellationStyle(style),
  );
}
