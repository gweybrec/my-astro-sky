import { t, getLang, setLang } from '../i18n';
import type { Lang } from '../i18n';

export function useI18n() {
  return { t, lang: getLang() as Lang, setLang };
}
