export type Theme = 'warm' | 'cold-blue' | 'cold-blue-v2';

const VALID: Theme[] = ['cold-blue-v2', 'warm', 'cold-blue'];
const KEY = 'app-theme';

export function loadTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return (VALID.includes(v as Theme) ? v : 'cold-blue-v2') as Theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === 'warm' ? '' : theme;
  localStorage.setItem(KEY, theme);
  window.dispatchEvent(new CustomEvent('app-theme-changed'));
}
