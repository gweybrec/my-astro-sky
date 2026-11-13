import { t } from './i18n';

function confirmDeleteDialog(
  title: string,
  message: string,
  actionLabel: string,
  /** `btn-confirm` for a choice that destroys nothing. */
  actionClass: 'btn-danger' | 'btn-confirm' = 'btn-danger',
): Promise<boolean> {
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
    confirmBtn.className = actionClass;
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

/**
 * Generic "you have unsaved changes — close without saving?" confirmation.
 * Shared by the gallery metadata editor and the POI types editor. Resolves true
 * when the user chooses to discard.
 */
export function confirmUnsavedChanges(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.addEventListener('click', (e) => e.stopPropagation());

    const message = document.createElement('p');
    message.className = 'dialog-message';
    message.textContent = t('gallery.unsavedChanges');

    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel';
    cancelBtn.textContent = t('gallery.cancelEdit');

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'btn-danger';
    discardBtn.textContent = t('gallery.closeWithoutSaving');

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
    discardBtn.addEventListener('click', () => closeWith(true));

    buttons.appendChild(cancelBtn);
    buttons.appendChild(discardBtn);
    dialog.appendChild(message);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => cancelBtn.focus());
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

export function confirmSharedSkyDelete(name: string, photoCount: number): Promise<boolean> {
  return confirmDeleteDialog(
    t('sharedSky.deleteTitle'),
    t('sharedSky.deleteMessage', { name, count: String(photoCount) }),
    t('photos.delete'),
  );
}

export function confirmSetupDelete(name: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('fovOverlay.deleteSetupTitle'),
    t('fovOverlay.deleteSetupConfirm', { name }),
    t('photos.delete'),
  );
}

export function confirmSkyRegionDelete(name: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('targets.skyRegion.deleteConfirmTitle'),
    t('targets.skyRegion.deleteConfirmMessage', { name }),
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

/**
 * Free (ad-hoc) mosaics aren't part of a plan, so the message must not mention
 * one — unlike {@link confirmPlanEntryDelete}, which is for plan items.
 */
export function confirmMosaicDelete(mosaicName: string): Promise<boolean> {
  return confirmDeleteDialog(
    t('fovOverlay.deleteMosaic'),
    t('fovOverlay.deleteMosaicConfirmFree', { name: mosaicName }),
    t('fovOverlay.deleteMosaic'),
  );
}

export function confirmDiscardUnsavedSolves(count: number): Promise<boolean> {
  return confirmDeleteDialog(
    t('batch.confirmCloseTitle'),
    t('batch.confirmCloseMessage', { count: String(count) }),
    t('batch.confirmCloseAction'),
  );
}

/**
 * A solved file whose picture does not have the photo's proportions is probably another photo's: the same warning as
 * when adding a photo, with Cancel / Continue anyway. Resolves true to continue.
 */
export function confirmWcsDimensionMismatch(warning: {
  sourceW: number;
  sourceH: number;
  targetW: number;
  targetH: number;
}): Promise<boolean> {
  return confirmDeleteDialog(
    t('modal.wcsDimensionMismatchTitle'),
    t('modal.wcsDimensionMismatchBody', {
      fitsW: String(warning.sourceW),
      fitsH: String(warning.sourceH),
      jpegW: String(warning.targetW),
      jpegH: String(warning.targetH),
    }),
    t('modal.wcsContinueAnyway'),
    'btn-confirm',
  );
}
