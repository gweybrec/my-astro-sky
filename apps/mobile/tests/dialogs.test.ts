import { describe, it, expect, vi, beforeEach } from 'vitest';

const present = vi.fn();
const onDidDismiss = vi.fn();
const alertCreate = vi.fn();
const toastCreate = vi.fn();
vi.mock('@ionic/vue', () => ({
  alertController: { create: (o: unknown) => alertCreate(o) },
  toastController: { create: (o: unknown) => toastCreate(o) },
}));

import {
  useConfirm,
  showInfo,
  confirmWcsWarnings,
  chooseExistingOrNew,
} from '../src/composables/useConfirm';
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

describe('the dialog of a file named like a photo', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    onDidDismiss.mockReset();
    alertCreate.mockReset().mockResolvedValue({ present, onDidDismiss });
  });

  it('offers Annuler, Ajouter comme nouvelle photo (green) and Voir dans le ciel (accent), drawn on top', async () => {
    onDidDismiss.mockResolvedValue({ role: 'show' });
    expect(await chooseExistingOrNew('M45_2024-11-02_RGB', true)).toBe('show');
    const arg = alertCreate.mock.calls[0][0];
    expect(arg.header).toBe('Une photo porte déjà ce nom');
    // The name stays on one line: a word joiner follows each hyphen.
    const J = String.fromCharCode(0x2060);
    expect(arg.message).toContain('M45_2024-' + J + '11-' + J + '02_RGB');
    expect(arg.buttons.map((b: { text: string }) => b.text)).toEqual([
      'Annuler',
      'Ajouter comme nouvelle photo',
      'Voir dans le ciel',
    ]);
    expect(arg.buttons[1].cssClass).toContain('mob-btn--confirm');
    expect(arg.buttons[2].cssClass).toContain('mob-btn--action');
  });

  it('offers the gallery for a photo not placed, and answers add or cancel', async () => {
    onDidDismiss.mockResolvedValue({ role: 'add' });
    expect(await chooseExistingOrNew('M31', false)).toBe('add');
    expect(alertCreate.mock.calls[0][0].buttons[2].text).toBe('Voir dans la galerie');
    onDidDismiss.mockResolvedValue({ role: 'backdrop' });
    expect(await chooseExistingOrNew('M31', false)).toBe('cancel');
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
    expect(arg.cssClass).toEqual(['mob-toast', 'mob-toast-error']);
    expect(arg.htmlAttributes.role).toBe('alert');
    expect(present).toHaveBeenCalledOnce();
  });

  it('shows a notice in the plain toast', async () => {
    await useErrorToast().showNotice('M42 ajouté(s) aux points d’intérêt');
    const arg = toastCreate.mock.calls[0][0];
    expect(arg.message).toBe('M42 ajouté(s) aux points d’intérêt');
    expect(arg.cssClass).toEqual(['mob-toast']);
    expect(arg.htmlAttributes.role).toBe('status');
  });

  it('shows the text of something that is not an Error', async () => {
    await useErrorToast().showError('boom');
    expect(toastCreate.mock.calls[0][0].message).toBe('boom');
  });

  it('shows a warning in the amber toast, long enough to read a sentence', async () => {
    await useErrorToast().showWarning('M2.fit n’est pas résolu astrométriquement');
    const arg = toastCreate.mock.calls[0][0];
    expect(arg.cssClass).toEqual(['mob-toast', 'mob-toast-warning']);
    expect(arg.htmlAttributes.role).toBe('status');
    expect(arg.duration).toBe(8000);
  });

  it("sits above a page's footer when given its id, and at the bottom otherwise", async () => {
    await useErrorToast({ above: 'photo-edit-footer' }).showNotice('ok');
    await useErrorToast().showNotice('ok');
    expect(toastCreate.mock.calls[0][0]).toMatchObject({
      positionAnchor: 'photo-edit-footer',
      cssClass: ['mob-toast', 'mob-toast--above'],
    });
    expect(toastCreate.mock.calls[1][0]).not.toHaveProperty('positionAnchor');
    expect(toastCreate.mock.calls[1][0].cssClass).toEqual(['mob-toast']);
  });
});

describe('the warnings of a file read for a photo ("Photo, est-ce le bon fichier ?")', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    present.mockReset();
    onDidDismiss.mockReset();
    alertCreate.mockReset().mockResolvedValue({ present, onDidDismiss });
  });

  it('lists the reasons under the file name, then Annuler and "Continuer quand même"', async () => {
    onDidDismiss.mockResolvedValue({ role: 'confirm' });
    const go = await confirmWcsWarnings('M42.fit', ['Le centre est en dehors.', 'Autre objet.']);
    const arg = alertCreate.mock.calls[0][0];
    expect(arg.header).toBe('Est-ce le bon fichier ?');
    expect(arg.message.split('\n')).toEqual([
      'M42.fit ne semble pas correspondre à cette photo :',
      '\u2022\u00a0Le centre est en dehors.',
      '\u2022\u00a0Autre objet.',
    ]);
    expect(arg.buttons.map((b: { text: string }) => b.text)).toEqual([
      'Annuler',
      'Continuer quand même',
    ]);
    expect(arg.buttons[1].cssClass).toContain('mob-btn--confirm');
    expect(go).toBe(true);
  });

  it('takes nothing when cancelled or dismissed', async () => {
    onDidDismiss.mockResolvedValue({ role: 'cancel' });
    expect(await confirmWcsWarnings('M42.fit', ['x'])).toBe(false);
    onDidDismiss.mockResolvedValue({ role: 'backdrop' });
    expect(await confirmWcsWarnings('M42.fit', ['x'])).toBe(false);
  });
});
