import { toastController } from '@ionic/vue';
import { Capacitor } from '@capacitor/core';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import {
  errorReportText,
  needsErrorRef,
  userMessage,
  type ErrorTicket,
} from '@myastrosky/core/platform/error-report';
import copyIcon from '@icons/copy.svg?raw';

const DURATION_MS = 4000;

/** Long enough to read a sentence of explanation (an unsolved file, a greyed-out button). */
export const LONG_TOAST_MS = 8000;

/** The text shown when an error has none of its own for the user. */
const GENERIC_ERROR_KEY = 'serverErrors.INTERNAL_ERROR';

// Ionic's icon takes an SVG file as a base64 data address.
const COPY_ICON = `data:image/svg+xml;base64,${btoa(copyIcon)}`;

/** How an error is shown: its fallback text, its name in the log, or a text that replaces its own. */
export interface ShowErrorOptions {
  /** The text when the error has none written for the user (a bug, a plugin's failure). */
  fallbackKey?: string;
  /** Names the error in the log; the fallback key when absent. */
  category?: string;
  /** The text to show instead of the error's own, already translated (the board's fixed wording). */
  message?: string;
  duration?: number;
}

/**
 * The toast at the bottom (with `above`, above the element of that id): `showError` is the red one (the desktop's
 * `.toast-error`, board "Lieu, horizon indisponible"), `showNotice` the plain one (the desktop's `.toast`: what was
 * just done) and `showWarning` the amber one (the desktop's `.toast-warning`, board "Photo, fichier non résolu": done,
 * but not all).
 *
 * `showError` takes a caught error or a text already translated. An error shows its text written for the user, else the
 * fallback, never the raw message of a bug; a failure of the app, a server or the network is logged and shows its
 * code and reference under the text, with a button that copies them for a bug report.
 */
export function useErrorToast(options: { above?: string } = {}) {
  async function present(
    message: string,
    kind: 'error' | 'notice' | 'warning',
    duration = DURATION_MS,
    ticket?: ErrorTicket,
  ): Promise<void> {
    const toast = await toastController.create({
      // With a reference, the text is the toast's header and the reference its message, under it.
      ...(ticket
        ? { header: message, message: `${t('errors.reference')} ${ticket.code} · ${ticket.ref}` }
        : { message }),
      duration,
      position: 'bottom',
      // On a page with a footer (a form's Annuler / Enregistrer), the toast sits above it, never over its buttons.
      ...(options.above ? { positionAnchor: options.above } : {}),
      ...(ticket
        ? {
            buttons: [
              {
                icon: COPY_ICON,
                side: 'end' as const,
                htmlAttributes: { 'aria-label': t('errors.copyDetails') },
                handler: () => {
                  void copyDetails(ticket);
                  return false; // The toast stays: the reference is still there to read.
                },
              },
            ],
          }
        : {}),
      cssClass: [
        'mob-toast',
        ...(kind === 'error'
          ? ['mob-toast-error']
          : kind === 'warning'
            ? ['mob-toast-warning']
            : []),
        ...(ticket ? ['mob-toast--ref'] : []),
        ...(options.above ? ['mob-toast--above'] : []),
      ],
      htmlAttributes: { role: kind === 'error' ? 'alert' : 'status' },
    });
    await toast.present();
  }

  async function copyDetails(ticket: ErrorTicket): Promise<void> {
    const text = errorReportText(ticket, {
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
      platform: Capacitor.getPlatform(),
    });
    try {
      await navigator.clipboard.writeText(text);
      await present(t('errors.detailsCopied'), 'notice', 2000);
    } catch (err) {
      reportError('toast: copy error details', err);
    }
  }

  /** A caught error or a translated text; the second argument is a duration (ms) or the options. */
  const showError = (error: unknown, opts: number | ShowErrorOptions = {}) => {
    const o: ShowErrorOptions = typeof opts === 'number' ? { duration: opts } : opts;
    const fallbackKey = o.fallbackKey ?? GENERIC_ERROR_KEY;
    const message = o.message ?? userMessage(error, fallbackKey);
    const ticket = needsErrorRef(error) ? reportError(o.category ?? fallbackKey, error) : undefined;
    return present(message, 'error', o.duration ?? (ticket ? LONG_TOAST_MS : DURATION_MS), ticket);
  };
  const showNotice = (message: string, duration?: number) => present(message, 'notice', duration);
  const showWarning = (message: string, duration = LONG_TOAST_MS) =>
    present(message, 'warning', duration);
  return { showError, showNotice, showWarning };
}
