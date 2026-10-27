import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_LABEL_KEYS, parseTheme } from '@myastrosky/core/theme';
import { applyTheme, loadTheme } from '../../src/theme';
import fr from '@myastrosky/core/i18n/fr';

describe('the shared theme list', () => {
  it('offers the three themes in the order of the settings, the modern cold one first and by default', () => {
    expect(THEMES).toEqual(['cold-blue-v2', 'warm', 'cold-blue']);
    expect(DEFAULT_THEME).toBe('cold-blue-v2');
  });

  it('reads a saved value as a theme, and anything else as the default', () => {
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
    expect(parseTheme(null)).toBe('cold-blue-v2');
    expect(parseTheme(undefined)).toBe('cold-blue-v2');
    expect(parseTheme('night-red')).toBe('cold-blue-v2');
    expect(parseTheme('')).toBe('cold-blue-v2');
  });

  it('has a label in the translations for each theme', () => {
    const settings = (fr as { settings: Record<string, string> }).settings;
    expect(
      THEMES.map((theme) => settings[THEME_LABEL_KEYS[theme].replace('settings.', '')]),
    ).toEqual(['Froid moderne (défaut)', 'Chaud', 'Froid classique']);
  });
});

describe("the desktop's theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = '';
  });

  it('loads the saved theme, else the default', () => {
    expect(loadTheme()).toBe('cold-blue-v2');
    localStorage.setItem('app-theme', 'warm');
    expect(loadTheme()).toBe('warm');
    localStorage.setItem('app-theme', 'bogus');
    expect(loadTheme()).toBe('cold-blue-v2');
  });

  it('applies a theme on <html> (warm is the base styles), saves it and tells the sky map', () => {
    const changed = vi.fn();
    window.addEventListener('app-theme-changed', changed);
    applyTheme('cold-blue');
    expect(document.documentElement.dataset.theme).toBe('cold-blue');
    expect(localStorage.getItem('app-theme')).toBe('cold-blue');
    applyTheme('warm');
    expect(document.documentElement.dataset.theme).toBe('');
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener('app-theme-changed', changed);
  });
});
