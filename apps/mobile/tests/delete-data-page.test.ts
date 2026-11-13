import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { FULL_BACKUP_OPTIONS } from '@myastrosky/core/backup-selection';
import { setBackend } from '@myastrosky/app-state/backend';
import { ionicStubs } from './helpers';

const showError = vi.fn();
const showNotice = vi.fn();
const confirm = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice }),
}));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

import DeleteDataPage from '../src/pages/DeleteDataPage.vue';

const photo = (id: string, originalName: string, fileSize: number) => ({
  id,
  originalName,
  fileSize,
  dsoIds: [],
});

const calls: string[] = [];
const track =
  (name: string, result: unknown = 0) =>
  (...args: unknown[]) => {
    calls.push(args.length ? `${name}(${JSON.stringify(args[0])})` : name);
    return Promise.resolve(result);
  };

const backend = {
  photos: { listWithSizes: vi.fn(), removeAll: vi.fn(), removeMany: vi.fn() },
  dsoOverrides: { removeAll: vi.fn(), getAll: vi.fn() },
  gear: { removeAllCustom: vi.fn(), removeAllSetups: vi.fn() },
  backup: { exportToUser: vi.fn() },
  sharedSkies: { list: vi.fn(), listPhotos: vi.fn(), remove: vi.fn() },
};

async function open() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/tabs/settings');
  await router.push('/settings/delete');
  const w = mount(DeleteDataPage, {
    global: { stubs: ionicStubs, plugins: [router, createPinia()] },
  });
  await flushPromises();
  return { w, router };
}

const button = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll('button').find((b) => b.text() === label)!;
/** The tick boxes of the page (the four kinds of data), then of the photos sheet. */
const pageBoxes = (w: ReturnType<typeof mount>) =>
  w.findAll('.mob-list')[0].findAll('[role="checkbox"]');
const sheetBoxes = (w: ReturnType<typeof mount>) =>
  w.findAll('.mob-list').at(-1)!.findAll('[role="checkbox"]');

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  vi.clearAllMocks();
  calls.length = 0;
  backend.photos.listWithSizes.mockResolvedValue([
    photo('p3', 'Lune.jpg', 3000),
    photo('p2', 'NGC7000.tif', 2000),
    photo('p1', 'M31.jpg', 1000),
  ]);
  backend.photos.removeAll.mockImplementation(track('photos.removeAll', 3));
  backend.photos.removeMany.mockImplementation(track('photos.removeMany'));
  backend.dsoOverrides.removeAll.mockImplementation(track('dsoOverrides.removeAll'));
  backend.dsoOverrides.getAll.mockImplementation(track('dsoOverrides.getAll', {}));
  backend.gear.removeAllCustom.mockImplementation(track('gear.removeAllCustom'));
  backend.gear.removeAllSetups.mockImplementation(track('gear.removeAllSetups'));
  backend.backup.exportToUser.mockResolvedValue(undefined);
  backend.sharedSkies.list.mockResolvedValue([]);
  backend.sharedSkies.listPhotos.mockResolvedValue([]);
  backend.sharedSkies.remove.mockImplementation(track('sharedSkies.remove', { bytesFreed: 1 }));
  setBackend(backend as never);
});

describe('the delete data page', () => {
  it('shows the desktop rows, nothing ticked, and Supprimer greyed until something is', async () => {
    const { w } = await open();
    const text = w.text();
    expect(text).toContain('Supprimer des données');
    expect(text).toContain('Recommandé : créez une sauvegarde de vos données avant de supprimer.');
    expect(text).toContain('Supprimer les métadonnées des photos');
    expect(text).toContain('Supprimer les modifications DSO');
    expect(text).toContain('Supprimer le matériel personnalisé');
    expect(text).toContain('Supprimer les setups');
    expect(text).toContain('0 / 3');
    expect(button(w, 'Supprimer').attributes('disabled')).toBeDefined();
    await pageBoxes(w)[3].trigger('click');
    expect(button(w, 'Supprimer').attributes('disabled')).toBeUndefined();
  });

  it('backs up every photo and everything the page can delete', async () => {
    const { w } = await open();
    await button(w, 'Créer une sauvegarde (ZIP)').trigger('click');
    await flushPromises();
    expect(backend.backup.exportToUser).toHaveBeenCalledWith(
      expect.objectContaining({ options: FULL_BACKUP_OPTIONS, ids: ['p1', 'p2', 'p3'] }),
    );
  });

  it("lists the photos in the gallery's order and ticks all of them with Tout sélectionner", async () => {
    const { w } = await open();
    const titles = w.findAll('.mob-list').at(-1)!.findAll('.mob-row-title');
    expect(titles.map((r) => r.text())).toEqual([
      'Tout sélectionner',
      'M31.jpg',
      'NGC7000.tif',
      'Lune.jpg',
    ]);
    await sheetBoxes(w)[0].trigger('click');
    expect(w.text()).toContain('3 / 3');
    await sheetBoxes(w)[0].trigger('click');
    expect(w.text()).toContain('0 / 3');
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    const { w } = await open();
    await pageBoxes(w)[3].trigger('click');
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('confirms with the summary, deletes what is ticked in order, then goes back with a notice', async () => {
    confirm.mockResolvedValueOnce(true);
    const { w, router } = await open();
    for (const i of [1, 2, 3]) await pageBoxes(w)[i].trigger('click');
    await sheetBoxes(w)[1].trigger('click');
    await sheetBoxes(w)[3].trigger('click');
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith({
      title: 'Confirmer la suppression définitive',
      message:
        '• Toutes les modifications DSO\n• Tout le matériel personnalisé\n• Tous les setups\n• 2 sur 3 photo(s)',
      warning: 'Cette action est permanente et ne peut pas être annulée.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    expect(calls).toEqual([
      'photos.removeMany(["p1","p3"])',
      'dsoOverrides.removeAll',
      'dsoOverrides.getAll',
      'gear.removeAllCustom',
      'gear.removeAllSetups',
    ]);
    expect(showNotice).toHaveBeenCalledWith('Données supprimées avec succès');
    expect(router.currentRoute.value.path).toBe('/tabs/settings');
  });

  it('offers to delete the visited skies once there are some, and deletes each of them', async () => {
    const visit = (id: string) => ({ id, senderName: id, poiCategories: [] });
    const none = await open();
    expect(none.w.text()).not.toContain('Supprimer les ciels visités');
    expect(pageBoxes(none.w)).toHaveLength(4);

    backend.sharedSkies.list.mockResolvedValue([visit('sky-marie'), visit('sky-club')]);
    confirm.mockResolvedValueOnce(true);
    const { w } = await open();
    expect(w.text()).toContain('Supprimer les ciels visités');
    // Unticked at first, like the other kinds of data.
    expect(button(w, 'Supprimer').attributes('disabled')).toBeDefined();
    backend.sharedSkies.list.mockResolvedValue([]);
    await pageBoxes(w)[4].trigger('click');
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[0][0].message).toBe('• Tous les ciels visités (2)');
    expect(calls).toEqual(['sharedSkies.remove("sky-marie")', 'sharedSkies.remove("sky-club")']);
  });

  it('deletes every photo at once when the photo metadata is ticked', async () => {
    confirm.mockResolvedValueOnce(true);
    const { w } = await open();
    await pageBoxes(w)[0].trigger('click');
    await sheetBoxes(w)[1].trigger('click');
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['photos.removeAll']);
  });

  it('shows the error and stays on the page when a delete fails', async () => {
    confirm.mockResolvedValueOnce(true);
    backend.gear.removeAllSetups.mockRejectedValueOnce(new Error('boom'));
    const { w, router } = await open();
    await pageBoxes(w)[3].trigger('click');
    await button(w, 'Supprimer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showNotice).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/settings/delete');
  });
});
