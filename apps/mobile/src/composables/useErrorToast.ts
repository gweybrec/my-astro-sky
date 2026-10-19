import { toastController } from '@ionic/vue';

const DURATION_MS = 4000;

/**
 * The toast at the bottom: `showError` is the red one (the desktop's `.toast-error`, board "Lieu lorsque l'horizon est
 * indisponible") with the error's message, `showNotice` the plain one (the desktop's `.toast`: what was just done).
 */
export function useErrorToast() {
  async function present(message: string, error: boolean): Promise<void> {
    const toast = await toastController.create({
      message,
      duration: DURATION_MS,
      position: 'bottom',
      cssClass: error ? ['mob-toast', 'mob-toast-error'] : 'mob-toast',
      htmlAttributes: { role: error ? 'alert' : 'status' },
    });
    await toast.present();
  }
  const showError = (error: unknown) =>
    present(error instanceof Error ? error.message : String(error), true);
  const showNotice = (message: string) => present(message, false);
  return { showError, showNotice };
}
