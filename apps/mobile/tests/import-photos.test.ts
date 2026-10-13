import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const convertRawPhoto = vi.fn();
const uploadPhoto = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  convertRawPhoto: (...a: unknown[]) => convertRawPhoto(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
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
} from '../src/pending-photos';

const png = new File(['png'], 'M1.png');
const corr = [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 0, starName: '' }];
const solved = { png, meta: { success: true, correspondences: corr, width: 10, height: 10 } };

const mountPage = () => mount(ImportPhotosPage, { global: { stubs: ionicStubs } });

describe('the import page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    clearImport();
    configurePendingStore(createMemoryPendingStore());
    replace.mockReset();
    uploadPhoto.mockReset();
    convertRawPhoto.mockReset();
  });

  it('lists each file with where it stands, and a solved one can be imported', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Importer 2 photos');
    const rows = wrapper.findAll('.mob-row');
    expect(rows.map((r) => r.find('.mob-row-title').text())).toEqual(['M31.fits', 'M45.jpg']);
    expect(rows[0].find('.mob-row-sub').text()).toBe('✓ Déjà résolue');
    expect(rows[0].find('.mob-row-sub').classes()).toContain('mob-status--success');
    expect(rows[1].find('.mob-row-sub').text()).toBe('À placer');
    expect(rows[1].classes()).toContain('mob-row--inert');
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
    expect(wrapper.findAll('.mob-row').map((r) => r.find('.mob-row-title').text())).toEqual([
      'M31.fits',
    ]);
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
});
