import { toastController } from '@ionic/vue';

const DURATION_MS = 4000;

/** The red toast at the bottom (the desktop's `.toast-error`, board "Lieu lorsque l'horizon est indisponible"): the error's message. */
export function useErrorToast() {
  async function showError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const toast = await toastController.create({
      message,
      duration: DURATION_MS,
      position: 'bottom',
      cssClass: 'mob-toast-error',
      htmlAttributes: { role: 'alert' },
    });
    await toast.present();
  }
  return { showError };
}
