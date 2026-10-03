import fr from './fr';
import en from './en';
import es from './es';
import de from './de';

export type Lang = 'fr' | 'en' | 'es' | 'de';

const translations: Record<Lang, typeof fr> = { fr, en, es, de };

/** Everything i18n needs from the host; injected so core stays free of DOM/Vite globals. */
export interface I18nPlatform {
  storedLang(): string | null;
  storeLang(l: Lang): void;
  preferredLanguages(): readonly string[];
  reload(): void;
  onMissingKey?(k: string): void;
}

const defaultPlatform: I18nPlatform = {
  storedLang: () => null,
  storeLang: () => {},
  preferredLanguages: () => [],
  reload: () => {},
};

let platform: I18nPlatform = defaultPlatform;
let currentLang: Lang | null = null;

export function configureI18n(p: I18nPlatform): void {
  platform = p;
  currentLang = null;
}

function detectLang(): Lang {
  // 1. stored preference
  const stored = platform.storedLang();
  if (stored === 'fr' || stored === 'en' || stored === 'es' || stored === 'de') return stored;

  // 2. preferred languages
  for (const lang of platform.preferredLanguages()) {
    const code = lang.split('-')[0].toLowerCase();
    if (code === 'fr') return 'fr';
    if (code === 'en') return 'en';
    if (code === 'es') return 'es';
    if (code === 'de') return 'de';
  }

  // 3. fallback
  return 'fr';
}

export function getLang(): Lang {
  if (!currentLang) {
    currentLang = detectLang();
  }
  return currentLang;
}

export function setLang(lang: Lang): void {
  platform.storeLang(lang);
  platform.reload();
}

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  let value = getNestedValue(translations[lang], key);

  if (value === undefined) {
    // Fallback to French
    value = getNestedValue(translations.fr, key);
    if (value === undefined) {
      platform.onMissingKey?.(key);
      return key;
    }
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return value;
}
