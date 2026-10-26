import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StartupError from '../src/components/StartupError.vue';

describe('the start-up error screen', () => {
  const reload = vi.fn();
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says the app could not start, shows the error text and a Réessayer button that starts again', async () => {
    const wrapper = mount(StartupError, { props: { message: 'database is locked' } });
    const lines = wrapper.findAll('p').map((p) => p.text());
    expect(lines).toEqual(["L'application n'a pas pu démarrer.", 'database is locked']);
    const button = wrapper.find('button');
    expect(button.text()).toBe('Réessayer');
    await button.trigger('click');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('after a failed database update, says the data is intact and saves a backup, or says why it could not', async () => {
    let fail = false;
    const saveBackup = vi.fn(async () => {
      if (fail) throw new Error('disk full');
    });
    const wrapper = mount(StartupError, {
      props: { message: 'The database update failed: boom', saveBackup },
    });
    const lines = () => wrapper.findAll('p').map((p) => p.text());
    expect(lines()).toEqual([
      "L'application n'a pas pu mettre à jour sa base de données. Vos données sont intactes.",
      "Installez une version plus récente de l'application. En attendant, vous pouvez enregistrer une sauvegarde complète.",
      'The database update failed: boom',
    ]);
    const buttons = wrapper.findAll('button');
    expect(buttons.map((b) => b.text())).toEqual(['Enregistrer une sauvegarde', 'Réessayer']);

    await buttons[0].trigger('click');
    await flushPromises();
    expect(saveBackup).toHaveBeenCalledOnce();
    expect(lines()).toHaveLength(3);

    fail = true;
    await buttons[0].trigger('click');
    await flushPromises();
    expect(lines()[3]).toBe('La sauvegarde a échoué : disk full');
    expect(buttons[0].attributes('disabled')).toBeUndefined();
  });
});
