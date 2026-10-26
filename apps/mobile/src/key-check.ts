/**
 * At start-up, when the stored astrometry.net key can no longer be read (the WebView's storage that held its
 * encryption key was cleared, or the key came from elsewhere): a dialog says so and offers the key's screen, to
 * enter it again. Shown once per start; the key's screen says it too until the key is entered again or deleted.
 */
import { t } from '@myastrosky/core/i18n/index';
import { loadServerSettings } from '@myastrosky/app-state/api';
import { useConfirm } from './composables/useConfirm';

/** `openKeyScreen` is called when the user chooses to enter the key again. */
export async function checkAstrometryKey(openKeyScreen: () => unknown): Promise<void> {
  let unreadable: boolean;
  try {
    unreadable = (await loadServerSettings()).apiKeyUnreadable;
  } catch {
    return; // the settings screens report a failed read themselves
  }
  if (!unreadable) return;
  const enterAgain = await useConfirm().confirm({
    title: t('mobile.settings.keyUnreadableTitle'),
    message: t('mobile.settings.keyUnreadable'),
    confirmLabel: t('mobile.settings.keyEnterAgain'),
  });
  if (enterAgain) openKeyScreen();
}
