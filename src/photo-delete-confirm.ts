import { t } from './i18n';

function confirmDeleteDialog(title: string, message: string, actionLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.addEventListener('click', (e) => e.stopPropagation());

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    const messageEl = document.createElement('p');
    messageEl.className = 'dialog-message';
    messageEl.textContent = message;

    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel';
    cancelBtn.textContent = t('gallery.cancelEdit');

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-danger';
    confirmBtn.textContent = actionLabel;

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
    };

    const closeWith = (confirmed: boolean) => {
      cleanup();
      resolve(confirmed);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeWith(false);
      }
    };

    overlay.addEventListener('click', () => closeWith(false));
    cancelBtn.addEventListener('click', () => closeWith(false));
    confirmBtn.addEventListener('click', () => closeWith(true));

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => confirmBtn.focus());
  });
}

export function confirmPhotoDelete(photoName: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('photos.deleteConfirmTitle'),
    t('photos.deleteConfirmMessage', { name: photoName }),
    t('photos.deleteConfirmAction'),
  );
}

export function confirmPlanDelete(planName: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('targets.plan.delete'),
    t('targets.plan.confirmDelete', { name: planName }),
    t('targets.plan.delete'),
  );
}

export function confirmSetupDelete(name: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('fovOverlay.deleteSetupTitle'),
    t('fovOverlay.deleteSetupConfirm', { name }),
    t('photos.delete'),
  );
}

export function confirmPlanEntryDelete(targetName: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('fovOverlay.deleteFrame'),
    t('fovOverlay.deleteFrameConfirm', { name: targetName }),
    t('fovOverlay.deleteFrame'),
  );
}

export function confirmDiscardUnsavedSolves(count: number): Promise<boolean> {
  return confirmDeleteDialog(
    t('batch.confirmCloseTitle'),
    t('batch.confirmCloseMessage', { count: String(count) }),
    t('batch.confirmCloseAction'),
  );
}
