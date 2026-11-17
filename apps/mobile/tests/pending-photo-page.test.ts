import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const loadServerSettings = vi.fn();
const submitPlateSolve = vi.fn();
const uploadPhoto = vi.fn();
const updatePhotoMetadata = vi.fn();
const setPhotoPlacement = vi.fn();
const setPhotoOnlineSolve = vi.fn();
const deletePhotoAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  updatePhotoMetadata: (...a: unknown[]) => updatePhotoMetadata(...a),
  setPhotoPlacement: (...a: unknown[]) => setPhotoPlacement(...a),
  setPhotoOnlineSolve: (...a: unknown[]) => setPhotoOnlineSolve(...a),
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
  storedPhotoFile: async () => new File(['x'], 'w1.png', { type: 'image/png' }),
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
const searchUnified = vi.fn();
vi.mock('@myastrosky/core/search', () => ({
  searchUnified: (...a: unknown[]) => searchUnified(...a),
}));

import PendingPhotoPage from '../src/pages/PendingPhotoPage.vue';
import PhoneBackButton from '../src/components/PhoneBackButton.vue';
import {
  addPendingPhoto,
  resetPendingPhotos,
  holdPendingPlacement,
  pendingDraft,
  pendingPhotos,
  setPendingState,
} from '../src/pending-photos';
import { shownPendingId, solveHints } from '../src/pending-solve';
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
    resetPendingPhotos();
    solveHints.clear();
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
    expect(file.find('.mob-row-sub').text()).toBe('À résoudre');
    expect(w.text()).toContain('Choisir une méthode de placement');
    for (const method of [
      'Résoudre en ligne',
      'Réutiliser une solution',
      'Identifier 3 étoiles',
      'Placer à la main',
    ])
      expect(rowWith(w, method).exists()).toBe(true);
    // The methods on the phone first, then those of astrometry.net; the online solve is marked as sending the hint.
    const text = w.text();
    expect(text.indexOf('Sur le téléphone')).toBeLessThan(text.indexOf('Identifier 3 étoiles'));
    expect(text.indexOf('Placer à la main')).toBeLessThan(
      text.indexOf('En ligne · astrometry.net'),
    );
    expect(text.indexOf('En ligne · astrometry.net')).toBeLessThan(
      text.indexOf('Résoudre en ligne'),
    );
    expect(w.find('[data-test="solve-hint"]').exists()).toBe(true);
    const marked = w.findAll('.mob-row').filter((r) => r.find('[data-test="hint-mark"]').exists());
    expect(marked.map((r) => r.find('.mob-row-title').text())).toEqual(['Résoudre en ligne']);
    expect(rowWith(w, 'Résoudre en ligne').text()).toContain(
      'Envoie le fichier à astrometry.net, avec l’indice',
    );
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

  it('sends the hint with the online solve: the object picked from the results and the field width', async () => {
    searchUnified.mockResolvedValue([
      { type: 'dso', label: 'M101 – Galaxie du Moulinet', score: 1, mag: 8, ra: 210.8, dec: 54.35 },
    ]);
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    const w = await mountPage(photo.id);
    const fields = w.findAll('[data-test="solve-hint"] input');
    await fields[0].setValue('M101');
    await new Promise((r) => setTimeout(r, 300));
    await flushPromises();
    await rowWith(w, 'Galaxie du Moulinet').trigger('click');
    await fields[1].setValue('2,5');
    await rowWith(w, 'Résoudre en ligne').trigger('click');
    await flushPromises();
    const hints = submitPlateSolve.mock.calls[0][1];
    expect(hints).toMatchObject({ ra: 210.8, dec: 54.35, radius: 2 });
    expect(hints.scale_lower).toBeCloseTo(2);
    expect(hints.scale_upper).toBeCloseTo(3);
  });

  it('sends no hint when none is typed', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'M101.jpg');
    const w = await mountPage(photo.id);
    await rowWith(w, 'Résoudre en ligne').trigger('click');
    await flushPromises();
    expect(submitPlateSolve.mock.calls[0][1]).toEqual({});
  });

  it('greys out the online solve and the reuse without a connection or without the key', async () => {
    const photo = await addPendingPhoto(new Blob(['x']), 'NGC7000.tif');
    loadServerSettings.mockResolvedValue({ apiKeySet: false });
    const w = await mountPage(photo.id);
    const online = rowWith(w, 'Résoudre en ligne');
    expect(online.classes()).toContain('mob-row--disabled');
    expect(online.text()).toContain('Clé API non configurée');
    await online.trigger('click');
    await rowWith(w, 'Réutiliser une solution').trigger('click');
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
    await rowWith(w, 'Réutiliser une solution').trigger('click');
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

  it('opens a gallery photo stored "À résoudre" from the store, and saves it again on Enregistrer, placed', async () => {
    const waiting = {
      id: 'w1',
      originalName: 'M101',
      filename: 'w1.png',
      createdAt: '2026-11-15T00:00:00.000Z',
      correspondences: [],
      dsoIds: [],
      labels: ['Galaxies'],
      pointsOfInterest: [],
      notes: '',
    };
    getPhotos.mockResolvedValue([waiting]);
    updatePhotoMetadata.mockResolvedValue(undefined);
    setPhotoPlacement.mockResolvedValue({ ...waiting, correspondences: corr });
    const w = await mountPage('w1');
    expect(rowWith(w, 'M101').find('.mob-row-sub').text()).toBe('À résoudre');
    await holdPendingPlacement('w1', { correspondences: corr, dsoIds: ['M101'], by: 'solved' });
    await nameField(w).setValue('Moulinet');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(updatePhotoMetadata).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ originalName: 'Moulinet', dsoIds: ['M101'], labels: ['Galaxies'] }),
    );
    expect(setPhotoPlacement).toHaveBeenCalledWith('w1', {
      correspondences: corr,
      manualPlacement: null,
    });
    expect(pendingPhotos.value).toEqual([]);
  });

  it('offers to fetch the result of a solve astrometry.net goes on with, and no new upload', async () => {
    const waiting = {
      id: 'w2',
      originalName: 'NGC7000',
      filename: 'w2.png',
      createdAt: '2026-11-15T00:00:00.000Z',
      correspondences: [],
      dsoIds: [],
      labels: [],
      pointsOfInterest: [],
      notes: '',
      onlineSolve: { state: 'unfinished', submissionId: 42, sentAt: '2026-11-15T21:42:00.000Z' },
    };
    getPhotos.mockResolvedValue([waiting]);
    const w = await mountPage('w2');
    expect(rowWith(w, 'NGC7000').find('.mob-row-sub').text()).toBe('Résolution en cours');
    expect(w.find('[data-test="fetch-result"]').exists()).toBe(true);
    const online = rowWith(w, 'Résoudre en ligne');
    expect(online.text()).toContain('Déjà en cours sur astrometry.net');
    await online.trigger('click');
    expect(submitPlateSolve).not.toHaveBeenCalled();
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
