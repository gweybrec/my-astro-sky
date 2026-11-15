import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const loadServerSettings = vi.fn();
const submitPlateSolve = vi.fn();
const uploadPhoto = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  loadServerSettings: () => loadServerSettings(),
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  // The job never answers here.
  pollPlateSolve: () => new Promise(() => {}),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  setPhotoFitsHeaders: () => Promise.resolve(),
}));
vi.mock('@myastrosky/app-state/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({ categories: [], ensureLoaded: () => Promise.resolve() }),
}));

const route = { params: { id: '' } };
const replace = vi.fn();
const back = vi.fn();
const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, back, push }),
  useRoute: () => route,
}));
const confirm = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  confirmWcsWarnings: vi.fn(),
}));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice: vi.fn(), showWarning: vi.fn() }),
  LONG_TOAST_MS: 8000,
}));
vi.mock('../src/composables/useBackClose', () => ({ useBackClose: vi.fn() }));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));

import PendingPhotoPage from '../src/pages/PendingPhotoPage.vue';
import PhoneBackButton from '../src/components/PhoneBackButton.vue';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  holdPendingPlacement,
  pendingDraft,
  pendingPhotos,
  setPendingState,
} from '../src/pending-photos';
import { shownPendingId } from '../src/pending-solve';
import { unsavedDrafts } from '../src/pending-display';
import { skyPlacement } from '../src/sky-modes';

/** The boards "Photo à ajouter" and "…, placée". */
enableAutoUnmount(afterEach);

const corr = [{ pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '' }];
const mountPage = async (id: string) => {
  route.params.id = id;
  const w = mount(PendingPhotoPage, { global: { stubs: ionicStubs } });
  await flushPromises();
  return w;
};
type Page = Awaited<ReturnType<typeof mountPage>>;
const rowWith = (w: Page, text: string) =>
  w.findAll('.mob-row').find((r) => r.text().includes(text))!;
const button = (w: Page, text: string) =>
  w.findAll('footer button').find((b) => b.text() === text)!;
const nameField = (w: Page) => w.find('input[aria-label="Nom du fichier"]');

describe('the page "Photo à ajouter"', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configurePendingStore(createMemoryPendingStore());
    unsavedDrafts.clear();
    vi.clearAllMocks();
    getPhotos.mockResolvedValue([{ id: 'x', labels: ['Galaxies'] }]);
    getGearSetups.mockResolvedValue([]);
    loadServerSettings.mockResolvedValue({ apiKeySet: true });
    submitPlateSolve.mockResolvedValue({ jobId: 'job-1' });
    skyPlacement.value = null;
  });

  it('shows the file and where it stands, the placement methods and the metadata, filled from the file', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M45_RGB.jpg', {
      observationDate: '2024-11-02T21:00:00.000Z',
    });
    const w = await mountPage(photo.id);
    expect(w.find('h1').text()).toBe('Photo à ajouter');
    const file = rowWith(w, 'M45_RGB.jpg');
    expect(file.find('.mob-row-sub').text()).toBe('À placer');
    expect(w.text()).toContain('Choisir une méthode de placement');
    for (const method of [
      'Résoudre en ligne',
      'Réutiliser une solution astrometry.net',
      'Identifier 3 étoiles',
      'Placer à la main',
    ])
      expect(rowWith(w, method).exists()).toBe(true);
    expect((nameField(w).element as HTMLInputElement).value).toBe('M45_RGB');
    expect(w.find('button[aria-label="Supprimer cette photo"]').exists()).toBe(true);
    expect(shownPendingId.value).toBe(photo.id);
    w.unmount();
    expect(shownPendingId.value).toBeNull();
  });

  it('says how a placed photo was placed', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M45.jpg');
    await holdPendingPlacement(photo.id, { correspondences: corr, dsoIds: [], by: 'stars' });
    const w = await mountPage(photo.id);
    const sub = rowWith(w, 'M45.jpg').find('.mob-row-sub');
    expect(sub.text()).toBe('✓ Placée par 1 étoiles');
    expect(sub.classes()).toContain('mob-status--success');
  });

  it('sends the photo to the online solver and greys the methods out while it is solved', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'NGC7000.tif');
    const w = await mountPage(photo.id);
    await rowWith(w, 'Résoudre en ligne').trigger('click');
    await flushPromises();
    expect(submitPlateSolve.mock.calls[0][0].name).toBe('NGC7000.tif');
    expect(rowWith(w, 'NGC7000.tif').find('.mob-row-sub').text()).toBe('Résolution');
    expect(rowWith(w, 'Placer à la main').classes()).toContain('mob-row--disabled');
  });

  it('greys out the online solve and the reuse without a connection or without the key', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'NGC7000.tif');
    loadServerSettings.mockResolvedValue({ apiKeySet: false });
    const w = await mountPage(photo.id);
    const online = rowWith(w, 'Résoudre en ligne');
    expect(online.classes()).toContain('mob-row--disabled');
    expect(online.text()).toContain('Clé API non configurée');
    await online.trigger('click');
    await rowWith(w, 'Réutiliser une solution astrometry.net').trigger('click');
    expect(submitPlateSolve).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('opens each method, keeping what was typed for when the page opens again', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    const w = await mountPage(photo.id);
    await nameField(w).setValue('Galaxie du Moulinet');
    await rowWith(w, 'Placer à la main').trigger('click');
    expect(skyPlacement.value).toEqual({ pendingId: photo.id });
    expect(push).toHaveBeenLastCalledWith('/tabs/sky');
    await rowWith(w, 'Identifier 3 étoiles').trigger('click');
    expect(push).toHaveBeenLastCalledWith(`/gallery/identify/${photo.id}`);
    await rowWith(w, 'Réutiliser une solution astrometry.net').trigger('click');
    expect(push).toHaveBeenLastCalledWith(`/gallery/reuse/${photo.id}`);
    w.unmount();
    // Opened again after the method: the name typed is there, not saved yet.
    const again = await mountPage(photo.id);
    expect((nameField(again).element as HTMLInputElement).value).toBe('Galaxie du Moulinet');
    expect((await pendingDraft(photo.id))!.displayName).toBe('M101');
  });

  it('keeps the metadata with Enregistrer in the import, without storing the photo', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg', undefined, undefined, {
      inImport: true,
    });
    await holdPendingPlacement(photo.id, { correspondences: corr, dsoIds: ['M101'], by: 'hand' });
    const w = await mountPage(photo.id);
    await nameField(w).setValue('Moulinet');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect((await pendingDraft(photo.id))!.displayName).toBe('Moulinet');
    expect(replace).toHaveBeenCalledWith('/gallery/import');
  });

  it('stores a placed waiting photo of the gallery with its metadata on Enregistrer', async () => {
    const photo = await addPendingPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'M101.jpg');
    await holdPendingPlacement(photo.id, { correspondences: corr, dsoIds: ['M101'], by: 'solved' });
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    const w = await mountPage(photo.id);
    await nameField(w).setValue('Moulinet');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    const [, correspondences, , , metadata] = uploadPhoto.mock.calls[0];
    expect(correspondences).toEqual(corr);
    expect(metadata).toMatchObject({ displayName: 'Moulinet', dsoIds: ['M101'] });
    expect(pendingPhotos.value).toEqual([]);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps only the metadata of a waiting photo not placed yet', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    await setPendingState(photo.id, 'failed', { error: 'no stars' });
    const w = await mountPage(photo.id);
    await nameField(w).setValue('Moulinet');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(pendingPhotos.value[0].state).toBe('failed');
    expect((await pendingDraft(photo.id))!.displayName).toBe('Moulinet');
  });

  it('asks before leaving with changes that are not saved', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    const w = await mountPage(photo.id);
    const before = w.findComponent(PhoneBackButton).props('before')!;
    expect(await before()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    await nameField(w).setValue('Moulinet');
    confirm.mockResolvedValueOnce(false);
    expect(await before()).toBe(false);
    expect(confirm.mock.calls[0][0].message).toBeTruthy();
  });

  it('deletes the photo after asking', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    const w = await mountPage(photo.id);
    confirm.mockResolvedValueOnce(false);
    await w.find('button[aria-label="Supprimer cette photo"]').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[0][0].message).toContain('M101.jpg');
    expect(pendingPhotos.value).toHaveLength(1);
    confirm.mockResolvedValueOnce(true);
    await w.find('button[aria-label="Supprimer cette photo"]').trigger('click');
    await flushPromises();
    expect(pendingPhotos.value).toEqual([]);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });
});
