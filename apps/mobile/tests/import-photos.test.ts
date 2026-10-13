import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const convertRawPhoto = vi.fn();
const uploadPhoto = vi.fn();
const submitPlateSolve = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  convertRawPhoto: (...a: unknown[]) => convertRawPhoto(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  loadServerSettings: () => Promise.resolve({ apiKeySet: true }),
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  // The job never answers here: the tests move the waiting photo themselves.
  pollPlateSolve: () => new Promise(() => {}),
}));
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: () => [],
}));
const replace = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }));

import ImportPhotosPage from '../src/pages/ImportPhotosPage.vue';
import { addImportFiles, clearImport } from '../src/composables/usePhotoImport';
import {
  configurePendingStore,
  createMemoryPendingStore,
  pendingPhotos,
  removePendingPhoto,
  setPendingState,
} from '../src/pending-photos';

const png = new File(['png'], 'M1.png');
const corr = [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 0, starName: '' }];
const solved = { png, meta: { success: true, correspondences: corr, width: 10, height: 10 } };

const mountPage = () => mount(ImportPhotosPage, { global: { stubs: ionicStubs } });
/** The rows of the chosen files (the placement-method sheet has rows of its own). */
const fileRows = (wrapper: ReturnType<typeof mountPage>) => wrapper.findAll('.mob-list .mob-row');

describe('the import page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    clearImport();
    configurePendingStore(createMemoryPendingStore());
    replace.mockReset();
    uploadPhoto.mockReset();
    convertRawPhoto.mockReset();
    submitPlateSolve.mockReset().mockResolvedValue({ jobId: 'job-1' });
  });

  it('lists each file with where it stands, and a solved one can be imported', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Importer 2 photos');
    const rows = fileRows(wrapper);
    expect(rows.map((r) => r.find('.mob-row-title').text())).toEqual(['M31.fits', 'M45.jpg']);
    expect(rows[0].find('.mob-row-sub').text()).toBe('✓ Déjà résolue');
    expect(rows[0].find('.mob-row-sub').classes()).toContain('mob-status--success');
    expect(rows[1].find('.mob-row-sub').text()).toBe('À placer');
    // Only the photo to place opens the choice of a placement method.
    expect(rows[0].find('.mob-row-chevron').exists()).toBe(false);
    expect(rows[1].find('.mob-row-chevron').exists()).toBe(true);
    expect(wrapper.find('footer button').attributes('disabled')).toBeUndefined();
  });

  it('cannot import while a file is still being read, nor when nothing can be imported', async () => {
    let fail: (reason: Error) => void = () => {};
    convertRawPhoto.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    addImportFiles([new File(['r'], 'M31.fits')]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Importer 1 photo');
    expect(wrapper.find('footer button').attributes('disabled')).toBeDefined();
    fail(new Error('unreadable'));
    await flushPromises();
    expect(wrapper.find('.mob-row-sub').text()).toBe('unreadable');
    expect(wrapper.find('footer button').attributes('disabled')).toBeDefined();
  });

  it('imports everything at once: the solved photo is stored, the other one waits in the gallery', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('footer button').trigger('click');
    await flushPromises();
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(pendingPhotos.value.map((p) => p.name)).toEqual(['M45.jpg']);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps a photo that could not be stored on the page, with the reason', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('footer button').trigger('click');
    await flushPromises();
    expect(fileRows(wrapper).map((r) => r.find('.mob-row-title').text())).toEqual(['M31.fits']);
    expect(wrapper.find('.mob-row-sub').text()).toBe('disk full');
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes back to the gallery once every photo is stored', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    addImportFiles([new File(['r'], 'M31.fits')]);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('footer button').trigger('click');
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  const chooseOnline = async (wrapper: ReturnType<typeof mountPage>, fileName: string) => {
    await fileRows(wrapper)
      .find((r) => r.text().includes(fileName))!
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('.mob-sheet .mob-row')
      .find((r) => r.text().includes('Résoudre en ligne'))!
      .trigger('click');
    await flushPromises();
  };

  it('asks how to place a photo, sends it to the online solver and shows "Résolution"', async () => {
    addImportFiles([new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await fileRows(wrapper)[0].trigger('click');
    await flushPromises();
    expect(wrapper.find('.mob-sheet').text()).toContain('Comment placer cette photo ?');
    await chooseOnline(wrapper, 'M45.jpg');
    expect(submitPlateSolve.mock.calls[0][0].name).toBe('M45.jpg');
    // It is kept at once as a waiting photo, so it is in the gallery whatever happens to this list.
    expect(pendingPhotos.value.map((p) => [p.name, p.state])).toEqual([['M45.jpg', 'solving']]);
    const row = fileRows(wrapper)[0];
    expect(row.find('.mob-row-sub').classes()).toContain('mob-row-sub--busy');
    expect(row.text()).toContain('Résolution');
    expect(row.find('.mob-row-chevron').exists()).toBe(false);
    expect(wrapper.find('footer button').attributes('disabled')).toBeUndefined();
  });

  it('shows a failed solve in red, lets another try be made, and drops the row once the photo is placed', async () => {
    addImportFiles([new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await chooseOnline(wrapper, 'M45.jpg');
    const id = pendingPhotos.value[0].id;

    await setPendingState(id, 'failed', { error: 'no stars' });
    await flushPromises();
    let row = fileRows(wrapper)[0];
    expect(row.find('.mob-row-sub').text()).toBe('Échec de la résolution');
    expect(row.find('.mob-row-sub').classes()).toContain('mob-status--danger');
    expect(row.find('.mob-row-chevron').exists()).toBe(true);

    await chooseOnline(wrapper, 'M45.jpg');
    expect(submitPlateSolve).toHaveBeenCalledTimes(2);
    expect(pendingPhotos.value).toHaveLength(1);
    row = fileRows(wrapper)[0];
    expect(row.text()).toContain('Résolution');

    // Solved and stored: the waiting photo is gone, and so is the row.
    await removePendingPhoto(id);
    await flushPromises();
    expect(fileRows(wrapper)).toHaveLength(0);
  });

  it('"Importer" leaves a photo being solved to the gallery without storing it twice', async () => {
    addImportFiles([new File(['x'], 'M45.jpg'), new File(['y'], 'M42.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    await chooseOnline(wrapper, 'M45.jpg');
    await wrapper.find('footer button').trigger('click');
    await flushPromises();
    expect(pendingPhotos.value.map((p) => [p.name, p.state])).toEqual([
      ['M45.jpg', 'solving'],
      ['M42.jpg', 'toPlace'],
    ]);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });
});
