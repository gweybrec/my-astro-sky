import { alertController } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** The label of the confirming button (the board "Plan, confirmer la suppression": "Supprimer le plan"). */
  confirmLabel: string;
  /** Red filled confirm button: the sole destructive choice of the dialog (every delete). */
  destructive?: boolean;
}

/** The dialog of the board "Plan, confirmer la suppression": a title, a message, then Annuler and the confirm button. */
export function useConfirm() {
  async function confirm(options: ConfirmOptions): Promise<boolean> {
    const alert = await alertController.create({
      header: options.title,
      message: options.message,
      cssClass: 'mob-dialog-alert',
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
