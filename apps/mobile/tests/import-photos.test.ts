import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const convertRawPhoto = vi.fn();
const uploadPhoto = vi.fn();
let storedPhotos: { id: string; originalName: string }[] = [];
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => Promise.resolve(storedPhotos),
  convertRawPhoto: (...a: unknown[]) => convertRawPhoto(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  setPhotoFitsHeaders: () => Promise.resolve(),
  // No saved setup for a raw file's header to point to.
  getGearSetups: () => Promise.resolve([]),
}));
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: () => [],
}));
const replace = vi.fn();
const push = vi.fn();
const back = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ replace, push, back }) }));
const confirm = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
vi.mock('../src/composables/useBackClose', () => ({ useBackClose: vi.fn() }));

import ImportPhotosPage from '../src/pages/ImportPhotosPage.vue';
import PhoneBackButton from '../src/components/PhoneBackButton.vue';
import { addImportFiles, resetImport } from '../src/composables/usePhotoImport';
import {
  resetPendingPhotos,
  holdPendingPlacement,
  pendingPhotos,
  setPendingState,
} from '../src/pending-photos';

const png = new File(['png'], 'M1.png', { type: 'image/png' });
const corr = [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 0, starName: '' }];
const solved = { png, meta: { success: true, correspondences: corr, width: 10, height: 10 } };

const mountPage = () => mount(ImportPhotosPage, { global: { stubs: ionicStubs } });
const fileRows = (wrapper: ReturnType<typeof mountPage>) => wrapper.findAll('.mob-list .mob-row');
const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
};
const idOf = (name: string) => pendingPhotos.value.find((p) => p.name === name)!.id;

describe('the import page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    resetImport();
    resetPendingPhotos();
    replace.mockReset();
    push.mockReset();
    back.mockReset();
    confirm.mockReset();
    showError.mockReset();
    uploadPhoto.mockReset();
    convertRawPhoto.mockReset();
    storedPhotos = [];
  });

  it('notes "Nom déjà utilisé" under a file named like one of the photos, whatever its state', async () => {
    storedPhotos = [{ id: 'p1', originalName: 'M45' }];
    addImportFiles([new File(['x'], 'M45.jpg'), new File(['y'], 'M42.jpg')]);
    const wrapper = mountPage();
    await settle();
    const rows = fileRows(wrapper);
    const subs = (i: number) => rows[i].findAll('.mob-row-sub').map((s) => s.text());
    expect(subs(0)).toContain('Nom déjà utilisé');
    expect(subs(1)).not.toContain('Nom déjà utilisé');
    // The note keeps the secondary colour: never the status colour of the line above it.
    const note = rows[0].findAll('.mob-row-sub').find((s) => s.text() === 'Nom déjà utilisé')!;
    expect(note.classes()).not.toContain('mob-status--success');
  });

  it('lists each file with where it stands; every photo opens its page "Photo à ajouter"', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    addImportFiles([
      new File(['r'], 'M31.fits'),
      new File(['x'], 'M45.jpg'),
      new File(['y'], 'M101.jpg'),
      new File(['z'], 'NGC7000.jpg'),
    ]);
    const wrapper = mountPage();
    await settle();
    await holdPendingPlacement(idOf('M101.jpg'), { correspondences: [], dsoIds: [], by: 'hand' });
    await setPendingState(idOf('NGC7000.jpg'), 'solving', { jobId: 'job-1' });
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Importer 4 photos');
    const rows = fileRows(wrapper);
    expect(rows.map((r) => r.find('.mob-row-title').text())).toEqual([
      'M31.fits',
      'M45.jpg',
      'M101.jpg',
      'NGC7000.jpg',
    ]);
    expect(rows.map((r) => r.find('.mob-row-sub').text())).toEqual([
      '✓ Déjà résolue',
      'À résoudre',
      '✓ Placée à la main',
      'Résolution',
    ]);
    expect(rows[0].find('.mob-row-sub').classes()).toContain('mob-status--success');
    expect(rows.every((r) => r.find('.mob-row-chevron').exists())).toBe(true);
    await rows[0].trigger('click');
    expect(push).toHaveBeenCalledWith(`/gallery/pending/${idOf('M31.fits')}`);
    expect(wrapper.find('footer button').attributes('disabled')).toBeUndefined();
  });

  it('says on its row that a raw file has no plate solution, its capture data being loaded', async () => {
    convertRawPhoto.mockResolvedValue({
      png,
      meta: { success: false, width: 10, height: 10, expTime: 30, stackCnt: 44 },
    });
    addImportFiles([new File(['r'], 'M42_SeeStarS50.fit'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await settle();
    const rows = fileRows(wrapper);
    // The board "Importer, fichier non résolu": "À résoudre", then the line in the warning colour.
    expect(rows[0].findAll('.mob-row-sub').map((s) => s.text())).toEqual([
      'À résoudre',
      'Non résolu astrométriquement : données de prise de vue chargées',
    ]);
    expect(rows[0].findAll('.mob-row-sub')[1].classes()).toContain('mob-status--warn');
    // A photo that is not a raw file has no such line.
    expect(rows[1].findAll('.mob-row-sub').map((s) => s.text())).toEqual(['À résoudre']);
  });

  it('cannot import while a file is still being read, nor when nothing can be imported', async () => {
    let fail: (reason: Error) => void = () => {};
    convertRawPhoto.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    addImportFiles([new File(['r'], 'M31.fits')]);
    const wrapper = mountPage();
    await settle();
    expect(wrapper.find('h1').text()).toBe('Importer 1 photo');
    expect(wrapper.find('footer button').attributes('disabled')).toBeDefined();
    fail(new Error('unreadable'));
    await settle();
    expect(wrapper.find('.mob-row-sub').text()).toBe('unreadable');
    expect(fileRows(wrapper)[0].find('.mob-row-chevron').exists()).toBe(false);
    expect(wrapper.find('footer button').attributes('disabled')).toBeDefined();
  });

  it('imports everything at once: the placed photo with its placement, the other one "À résoudre"', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    uploadPhoto.mockResolvedValue({ id: 'p1' });
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await settle();
    await wrapper.find('footer button').trigger('click');
    await settle();
    expect(uploadPhoto).toHaveBeenCalledTimes(2);
    expect(uploadPhoto.mock.calls[1][1]).toEqual([]);
    expect(pendingPhotos.value).toEqual([]);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps a photo that could not be stored in the list, and says why', async () => {
    convertRawPhoto.mockResolvedValue(solved);
    uploadPhoto.mockRejectedValue(new Error('disk full'));
    addImportFiles([new File(['r'], 'M31.fits'), new File(['x'], 'M45.jpg')]);
    const wrapper = mountPage();
    await settle();
    await wrapper.find('footer button').trigger('click');
    await settle();
    expect(fileRows(wrapper).map((r) => r.find('.mob-row-title').text())).toEqual([
      'M31.fits',
      'M45.jpg',
    ]);
    expect(showError.mock.calls[0][0]).toContain('M31.fits : disk full');
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps its list when it is left for a photo's page and shown again", async () => {
    addImportFiles([new File(['x'], 'M45.jpg'), new File(['y'], 'M101.jpg')]);
    const first = mountPage();
    await settle();
    first.unmount();
    const again = mountPage();
    await settle();
    expect(fileRows(again).map((r) => r.find('.mob-row-title').text())).toEqual([
      'M45.jpg',
      'M101.jpg',
    ]);
  });

  it('asks before giving the import up when it is left with photos in the list', async () => {
    addImportFiles([new File(['x'], 'M45.jpg'), new File(['y'], 'M101.jpg')]);
    const wrapper = mountPage();
    await settle();
    const before = wrapper.findComponent(PhoneBackButton).props('before')!;
    confirm.mockResolvedValueOnce(false);
    expect(await before()).toBe(false);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: "Abandonner l'import ?",
      message: 'Les 2 photos ne seront pas ajoutées. Pour les garder, touchez Importer.',
      confirmLabel: 'Abandonner',
      destructive: true,
    });
    expect(pendingPhotos.value).toHaveLength(2);
    confirm.mockResolvedValueOnce(true);
    expect(await before()).toBe(true);
    expect(pendingPhotos.value).toEqual([]);
  });

  it('is left without a question when its list is empty', async () => {
    const wrapper = mountPage();
    await settle();
    expect(await wrapper.findComponent(PhoneBackButton).props('before')!()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
