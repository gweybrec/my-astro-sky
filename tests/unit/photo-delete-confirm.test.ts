/** Tests for the "Open with" choice in src/photo-delete-confirm.ts: show the photo already added, or add the file. */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

import { chooseExistingOrNew } from '../../src/photo-delete-confirm';

const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.dialog button'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('chooseExistingOrNew', () => {
  it('offers Cancel, Add as new and Show in the sky in three colours, and resolves with the button pressed', async () => {
    const choice = chooseExistingOrNew('M101', true);
    expect(buttons().map((b) => b.textContent)).toEqual([
      'gallery.cancelEdit',
      'batch.openWithAddNew',
      'batch.openWithShowSky',
    ]);
    expect(document.querySelector('.dialog-message')?.textContent).toBe('batch.openWithMessage');
    // Adding (green) and showing (accent) never look like cancelling.
    expect(buttons().map((b) => b.className)).toEqual(['btn-cancel', 'btn-confirm', 'btn-action']);
    buttons()[2].click();
    await expect(choice).resolves.toBe('show');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('offers the gallery for a photo not placed', async () => {
    const choice = chooseExistingOrNew('M31', false);
    expect(buttons()[2].textContent).toBe('batch.openWithShowGallery');
    expect(document.querySelector('.dialog-message')?.textContent).toBe(
      'batch.openWithMessageGallery',
    );
    buttons()[1].click();
    await expect(choice).resolves.toBe('add');
  });

  it('cancels on Escape and on a click outside', async () => {
    const first = chooseExistingOrNew('M101', true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(first).resolves.toBe('cancel');

    const second = chooseExistingOrNew('M101', true);
    document.querySelector<HTMLElement>('.dialog-overlay')!.click();
    await expect(second).resolves.toBe('cancel');
  });
});
