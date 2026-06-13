import { t } from './i18n';

export function confirmPhotoDelete(photoName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = t('photos.deleteConfirmTitle');

    const message = document.createElement('p');
    message.className = 'dialog-message';
    message.textContent = t('photos.deleteConfirmMessage', { name: photoName });

    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel';
    cancelBtn.textContent = t('gallery.cancelEdit');

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-danger';
    confirmBtn.textContent = t('photos.deleteConfirmAction');

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
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => confirmBtn.focus());
  });
}