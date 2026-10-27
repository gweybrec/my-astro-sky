/**
 * The phone's colour theme: read from the device storage, set as `data-theme` on `<html>` (the tokens switch at once,
 * no reload). Unlike the desktop, every theme sets its own id: the phone's `:root` holds the default theme.
 */
import { ref } from 'vue';
import { storage } from '@myastrosky/core/platform/storage';
import { parseTheme, THEME_CHANGED_EVENT, THEME_KEY, type Theme } from '@myastrosky/core/theme';

/** The theme on screen, for the rows that show its name. */
export const currentTheme = ref<Theme>(parseTheme(null));

function setOnPage(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  currentTheme.value = theme;
}

/** At start-up, before the first screen: the saved theme, else the default. */
export function applySavedTheme(): void {
  setOnPage(parseTheme(storage().get(THEME_KEY)));
}

/** The user's choice: applied at once and kept for the next start. */
export function chooseTheme(theme: Theme): void {
  setOnPage(theme);
  storage().set(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
}
