import { parseTheme, THEME_CHANGED_EVENT, THEME_KEY, type Theme } from '@myastrosky/core/theme';

export function loadTheme(): Theme {
  return parseTheme(localStorage.getItem(THEME_KEY));
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === 'warm' ? '' : theme;
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
}
