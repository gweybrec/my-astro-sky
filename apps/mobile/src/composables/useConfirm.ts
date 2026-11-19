import { alertController } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** The label of the confirming button (the board "Plan, confirmer la suppression": "Supprimer le plan"). */
  confirmLabel: string;
  /** Red filled confirm button: the sole destructive choice of the dialog (every delete). */
  destructive?: boolean;
  /** A line under the message in the danger colour (board "Réglages, confirmer la suppression": cannot be undone). */
  warning?: string;
}

/** The dialog of the board "Plan, confirmer la suppression": a title, a message, then Annuler and the confirm button. */
export function useConfirm() {
  async function confirm(options: ConfirmOptions): Promise<boolean> {
    const alert = await alertController.create({
      header: options.title,
      // Ionic draws the sub-title in the head; the class moves it under the message.
      subHeader: options.warning,
      message: options.message,
      cssClass: options.warning
        ? ['mob-dialog-alert', 'mob-dialog-alert--warning']
        : 'mob-dialog-alert',
      backdropDismiss: true,
      buttons: [
        { text: t('modal.cancel'), role: 'cancel', cssClass: 'mob-btn mob-btn--lg m-body' },
        {
          text: options.confirmLabel,
          role: 'confirm',
          cssClass: `mob-btn mob-btn--lg m-body-strong ${options.destructive ? 'mob-btn--danger-fill' : 'mob-btn--confirm'}`,
        },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
  return { confirm };
}

/** The small dialog behind an "i" button (board "Identification, explication ouverte"): a title, the text, Fermer. */
export async function showInfo(title: string, message: string): Promise<void> {
  const alert = await alertController.create({
    header: title,
    message,
    cssClass: 'mob-dialog-alert mob-dialog-alert--single',
    backdropDismiss: true,
    buttons: [{ text: t('modal.close'), role: 'cancel', cssClass: 'mob-btn mob-btn--lg m-body' }],
  });
  await alert.present();
  await alert.onDidDismiss();
}

/** An invisible character that forbids a line break beside it. */
const WORD_JOINER = String.fromCharCode(0x2060);

/**
 * The board "Ouvrir avec, nom déjà utilisé": a file opened from another app has the name of one of the user's photos.
 * Voir dans le ciel (or Voir dans la galerie for a photo not placed yet), Ajouter comme nouvelle photo, or Annuler.
 */
export async function chooseExistingOrNew(
  name: string,
  placed: boolean,
): Promise<'show' | 'add' | 'cancel'> {
  // A word joiner after each hyphen keeps the name on one line.
  const shown = name.replace(/-/g, '-' + WORD_JOINER);
  const alert = await alertController.create({
    header: t('batch.openWithTitle'),
    message: t(placed ? 'batch.openWithMessage' : 'batch.openWithMessageGallery', { name: shown }),
    cssClass: 'mob-dialog-alert',
    backdropDismiss: true,
    // The group wraps in reverse: the last button is drawn on top.
    buttons: [
      { text: t('modal.cancel'), role: 'cancel', cssClass: 'mob-btn mob-btn--lg m-body' },
      {
        text: t('batch.openWithAddNew'),
        role: 'add',
        cssClass: 'mob-btn mob-btn--lg m-body-strong mob-btn--confirm',
      },
      {
        text: t(placed ? 'batch.openWithShowSky' : 'batch.openWithShowGallery'),
        role: 'show',
        cssClass: 'mob-btn mob-btn--lg m-body-strong mob-btn--action',
      },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'show' || role === 'add' ? role : 'cancel';
}

/** A bullet and a non-breaking space, before each reason of a list in a dialog. */
const BULLET = String.fromCharCode(0x2022, 0xa0);

/**
 * The board "Photo, est-ce le bon fichier ?": the reasons the file may not be this photo's, then Annuler and
 * "Continuer quand même". Resolves true when the user goes on.
 */
export async function confirmWcsWarnings(filename: string, warnings: string[]): Promise<boolean> {
  const alert = await alertController.create({
    header: t('modal.wcsWarningsTitle'),
    // The dialog's message is plain text: one reason per line, after a bullet and a non-breaking space.
    message: [
      t('modal.wcsWarningsIntro', { filename }),
      ...warnings.map((w) => `${BULLET}${w}`),
    ].join('\n'),
    cssClass: 'mob-dialog-alert',
    backdropDismiss: true,
    buttons: [
      { text: t('modal.cancel'), role: 'cancel', cssClass: 'mob-btn mob-btn--lg m-body' },
      {
        text: t('modal.wcsContinueAnyway'),
        role: 'confirm',
        cssClass: 'mob-btn mob-btn--lg m-body-strong mob-btn--confirm',
      },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}
