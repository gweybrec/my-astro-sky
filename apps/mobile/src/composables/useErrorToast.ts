import { toastController } from '@ionic/vue';

const DURATION_MS = 4000;

/** Long enough to read a sentence of explanation (an unsolved file, a greyed-out button). */
export const LONG_TOAST_MS = 8000;

/**
 * The toast at the bottom (with `above`, above the element of that id): `showError` is the red one (the desktop's `.toast-error`, board "Lieu lorsque l'horizon est
 * indisponible") with the error's message, `showNotice` the plain one (the desktop's `.toast`: what was just done) and
 * `showWarning` the amber one (the desktop's `.toast-warning`, board "Photo, fichier non résolu": done, but not all).
 */
export function useErrorToast(options: { above?: string } = {}) {
  async function present(
    message: string,
    kind: 'error' | 'notice' | 'warning',
    duration = DURATION_MS,
  ): Promise<void> {
    const toast = await toastController.create({
      message,
      duration,
      position: 'bottom',
      // On a page with a footer (a form's Annuler / Enregistrer), the toast sits above it, never over its buttons.
      ...(options.above ? { positionAnchor: options.above } : {}),
      cssClass: [
        'mob-toast',
        ...(kind === 'error'
          ? ['mob-toast-error']
          : kind === 'warning'
            ? ['mob-toast-warning']
            : []),
        ...(options.above ? ['mob-toast--above'] : []),
      ],
      htmlAttributes: { role: kind === 'error' ? 'alert' : 'status' },
    });
    await toast.present();
  }
  /** `duration` (ms) for a long message, such as the explanation of an unsolved file. */
  const showError = (error: unknown, duration?: number) =>
    present(error instanceof Error ? error.message : String(error), 'error', duration);
  const showNotice = (message: string, duration?: number) => present(message, 'notice', duration);
  const showWarning = (message: string, duration = LONG_TOAST_MS) =>
    present(message, 'warning', duration);
  return { showError, showNotice, showWarning };
}
