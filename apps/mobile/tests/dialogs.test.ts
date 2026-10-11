import { describe, it, expect, vi, beforeEach } from 'vitest';

const present = vi.fn();
const onDidDismiss = vi.fn();
const alertCreate = vi.fn();
const toastCreate = vi.fn();
vi.mock('@ionic/vue', () => ({
  alertController: { create: (o: unknown) => alertCreate(o) },
  toastController: { create: (o: unknown) => toastCreate(o) },
}));

import { useConfirm, showInfo } from '../src/composables/useConfirm';
import { useErrorToast } from '../src/composables/useErrorToast';

describe('the confirmation dialog', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    present.mockReset();
    onDidDismiss.mockReset();
    alertCreate.mockReset().mockResolvedValue({ present, onDidDismiss });
  });

  const options = {
    title: 'Supprimer le plan',
    message: 'Supprimer le plan « Nuit » ?',
    confirmLabel: 'Supprimer le plan',
    destructive: true,
  };

  it('asks with Annuler then the confirm button, and answers yes on confirm', async () => {
    onDidDismiss.mockResolvedValue({ role: 'confirm' });
    expect(await useConfirm().confirm(options)).toBe(true);
    const arg = alertCreate.mock.calls[0][0];
    expect(arg.header).toBe('Supprimer le plan');
    expect(arg.message).toBe('Supprimer le plan « Nuit » ?');
    expect(arg.buttons.map((b: { text: string }) => b.text)).toEqual([
      'Annuler',
      'Supprimer le plan',
    ]);
    expect(arg.buttons[1].cssClass).toContain('mob-btn--danger-fill');
    expect(present).toHaveBeenCalledOnce();
  });

  it('answers no on cancel and when dismissed from the backdrop', async () => {
    onDidDismiss.mockResolvedValue({ role: 'cancel' });
    expect(await useConfirm().confirm(options)).toBe(false);
    onDidDismiss.mockResolvedValue({ role: 'backdrop' });
    expect(await useConfirm().confirm(options)).toBe(false);
  });

  it('the information dialog has one Fermer button', async () => {
    onDidDismiss.mockResolvedValue({ role: 'cancel' });
    await showInfo('Titre', 'Texte');
    const arg = alertCreate.mock.calls[0][0];
    expect(arg.buttons).toHaveLength(1);
    expect(arg.buttons[0].text).toBe('Fermer');
  });
});

describe('the error toast', () => {
  beforeEach(() => {
    toastCreate.mockReset().mockResolvedValue({ present });
    present.mockReset();
  });

  it('shows the error message in a red toast at the bottom', async () => {
    await useErrorToast().showError(new Error('Impossible de calculer'));
    const arg = toastCreate.mock.calls[0][0];
    expect(arg.message).toBe('Impossible de calculer');
    expect(arg.position).toBe('bottom');
    expect(arg.cssClass).toBe('mob-toast-error');
    expect(present).toHaveBeenCalledOnce();
  });

  it('shows the text of something that is not an Error', async () => {
    await useErrorToast().showError('boom');
    expect(toastCreate.mock.calls[0][0].message).toBe('boom');
  });
});
