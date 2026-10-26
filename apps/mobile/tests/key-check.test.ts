import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setBackend } from '@myastrosky/app-state/backend';

const confirm = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

import { checkAstrometryKey } from '../src/key-check';
import { requestPersistentStorage } from '../src/platform-init';

const readPublic = vi.fn();

describe('the start-up check of the astrometry.net key', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    confirm.mockReset();
    readPublic.mockReset();
    setBackend({ settings: { readPublic } } as never);
  });

  it('says a key that can no longer be read must be entered again, and opens its screen', async () => {
    readPublic.mockResolvedValue({ apiKeySet: false, apiKeyUnreadable: true });
    confirm.mockResolvedValue(true);
    const open = vi.fn();
    await checkAstrometryKey(open);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Clé astrometry.net illisible',
      message:
        'La clé astrometry.net enregistrée ne peut plus être lue. Saisissez-la à nouveau pour résoudre vos photos en ligne.',
      confirmLabel: 'Saisir la clé',
    });
    expect(open).toHaveBeenCalledOnce();
  });

  it('stays where it is when the dialog is cancelled', async () => {
    readPublic.mockResolvedValue({ apiKeySet: false, apiKeyUnreadable: true });
    confirm.mockResolvedValue(false);
    const open = vi.fn();
    await checkAstrometryKey(open);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['a readable key', { apiKeySet: true, apiKeyUnreadable: false }],
    ['no key', { apiKeySet: false, apiKeyUnreadable: false }],
  ])('says nothing with %s', async (_name, settings) => {
    readPublic.mockResolvedValue(settings);
    await checkAstrometryKey(vi.fn());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says nothing when the settings cannot be read', async () => {
    readPublic.mockRejectedValue(new Error('boom'));
    await expect(checkAstrometryKey(vi.fn())).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the request to keep the WebView storage', () => {
  it('asks once and ignores a refusal or a failure', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('no'));
    requestPersistentStorage({ persist });
    expect(persist).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it('does nothing where there is no storage manager', () => {
    expect(() => requestPersistentStorage(undefined)).not.toThrow();
    expect(() => requestPersistentStorage({} as StorageManager)).not.toThrow();
  });
});
