import { configureI18n } from '@myastrosky/core/i18n/index';

configureI18n({
  storedLang: () => localStorage.getItem('lang'),
  storeLang: (l) => localStorage.setItem('lang', l),
  preferredLanguages: () => navigator.languages,
  reload: () => location.reload(),
  onMissingKey: (k) => {
    if (import.meta.env.DEV) console.warn(`[i18n] Missing key: "${k}"`);
  },
});
