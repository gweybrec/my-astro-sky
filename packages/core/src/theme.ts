/**
 * The app's colour themes: the list in the order the settings offer them, the default, the key the choice is saved
 * under, and the label of each. Applying a theme touches the page, so each app does it itself.
 */
export type Theme = 'cold-blue-v2' | 'warm' | 'cold-blue';

export const THEMES: readonly Theme[] = ['cold-blue-v2', 'warm', 'cold-blue'];

export const DEFAULT_THEME: Theme = 'cold-blue-v2';

/** The storage key of the chosen theme. */
export const THEME_KEY = 'app-theme';

/** The event each app sends on `window` once a new theme is applied (the sky map redraws on it). */
export const THEME_CHANGED_EVENT = 'app-theme-changed';

export const THEME_LABEL_KEYS: Record<Theme, string> = {
  'cold-blue-v2': 'settings.themeColdBlueV2',
  warm: 'settings.themeWarm',
  'cold-blue': 'settings.themeColdBlue',
};

/** A saved value as a theme; anything unknown (or nothing saved) is the default. */
export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
}
