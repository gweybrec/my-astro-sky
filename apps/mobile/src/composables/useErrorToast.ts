import { toastController } from '@ionic/vue';

const DURATION_MS = 4000;

/**
 * The toast at the bottom: `showError` is the red one (the desktop's `.toast-error`, board "Lieu lorsque l'horizon est
 * indisponible") with the error's message, `showNotice` the plain one (the desktop's `.toast`: what was just done).
 */
export function useErrorToast() {
  async function present(message: string, error: boolean, duration = DURATION_MS): Promise<void> {
    const toast = await toastController.create({
      message,
      duration,
      position: 'bottom',
      cssClass: error ? ['mob-toast', 'mob-toast-error'] : 'mob-toast',
      htmlAttributes: { role: error ? 'alert' : 'status' },
    });
    await toast.present();
  }
  /** `duration` (ms) for a long message, such as the explanation of an unsolved file. */
  const showError = (error: unknown, duration?: number) =>
    present(error instanceof Error ? error.message : String(error), true, duration);
  const showNotice = (message: string) => present(message, false);
  return { showError, showNotice };
}
