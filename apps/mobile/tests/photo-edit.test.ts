import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const updatePhotoMetadata = vi.fn();
const solveWCS = vi.fn();
const setPhotoFitsHeaders = vi.fn();
const deletePhotoAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  solveWCS: (...a: unknown[]) => solveWCS(...a),
  setPhotoFitsHeaders: (...a: unknown[]) => setPhotoFitsHeaders(...a),
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  updatePhotoMetadata: (...a: unknown[]) => updatePhotoMetadata(...a),
  deletePhotoAPI: (...a: unknown[]) => deletePhotoAPI(...a),
}));
vi.mock('@myastrosky/app-state/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({
    categories: [{ id: 'cat-comet', name: 'Comète', color: '#5aa9ff' }],
    ensureLoaded: () => Promise.resolve(),
  }),
}));

const replace = vi.fn();
const back = vi.fn();
const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, back, push }),
  useRoute: () => ({ params: { id: 'p1' } }),
}));

const confirm = vi.fn();
const confirmWcsWarnings = vi.fn();
const showError = vi.fn();
const showNotice = vi.fn();
const showWarning = vi.fn();
// The saved setups' optics, for the file checks and the setup the header points to.
const loadSetupOptics = vi.fn();
vi.mock('@myastrosky/core/gear-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/core/gear-catalog')>()),
  loadSetupOptics: (...a: unknown[]) => loadSetupOptics(...a),
}));
const pickFile = vi.fn();
vi.mock('../src/platform-device', () => ({
  pickFile: (...a: unknown[]) => pickFile(...a),
  WCS_FILE_TYPES: { mimeTypes: [], extensions: ['.fits'] },
}));
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  confirmWcsWarnings: (...a: unknown[]) => confirmWcsWarnings(...a),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice, showWarning }),
  LONG_TOAST_MS: 8000,
}));
vi.mock('../src/composables/useBackClose', () => ({ useBackClose: vi.fn() }));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));

const solved = { value: true };
vi.mock('@myastrosky/core/photo-placement', () => ({
  photoSkyModel: () =>
    solved.value
      ? {
          width: 100,
          height: 100,
          toSky: () => ({ ra: 0, dec: 0 }),
          toPixel: () => ({ x: 0, y: 0 }),
        }
      : null,
}));
vi.mock('@myastrosky/core/search', () => ({
  searchDSOs: (q: string) =>
    q.toLowerCase().startsWith('m3')
      ? [
          { dso: { id: 'M32', displayName: '' } },
          { dso: { id: 'M33', displayName: 'Galaxie du Triangle' } },
        ]
      : [],
}));

import PhotoEditPage from '../src/pages/PhotoEditPage.vue';
import { deliverPois } from '../src/identify-session';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import { pendingWcs, type WcsLoaded } from '../src/composables/useWcsLoad';
import { resetFilterUse } from '../src/filter-usage';
import { skySelection } from '../src/composables/useSkySelection';

/** "Photo, modifier les infos": the form of a photo's metadata. */

const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    filename: 'm31.jpg',
    originalName: 'M31_stack.jpg',
    width: 4000,
    height: 2000,
    dsoIds: ['M31', 'M110'],
    labels: ['LRGB'],
    pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
    integrations: [{ frames: 40, seconds: 180, filter: 'L' }],
    observationDate: '2025-09-14T12:00:00.000Z',
    captureDetails: { gain: 100, ccdTemp: -10 },
    gearSetupId: 's1',
    notes: 'Seeing moyen',
    ...over,
  }) as Photo;

const mountPage = async () => {
  const w = mount(PhotoEditPage, { global: { stubs: ionicStubs } });
  await flushPromises();
  return w;
};
type Page = Awaited<ReturnType<typeof mountPage>>;
const byLabel = (w: Page, tag: string, name: string) =>
  w.findAll(tag).find((e) => e.attributes('aria-label') === name)!;
const byText = (w: Page, tag: string, text: string) =>
  w.findAll(tag).find((e) => e.text() === text)!;
const chips = (w: Page) => w.findAll('.mob-chip--remove').map((c) => c.text());
const rowTitles = (w: Page) => w.findAll('.mob-row-title').map((r) => r.text());
/** The rows of the points of interest: they wait for their screens. */
/** The rows under the points of interest: adding one, and the identifications. */
const poiRows = (w: Page) =>
  w
    .findAll('.mob-row .mob-row-title')
    .map((r) => r.text())
    .filter((text) => /point d'intérêt$|^Identifier /.test(text));
const row = (w: Page, title: string) =>
  w.findAll('.mob-row').find((r) => r.find('.mob-row-title').text() === title)!;
const saved = () => updatePhotoMetadata.mock.calls[0][1];
const save = async (w: Page) => {
  await byText(w, 'button', 'Enregistrer').trigger('click');
  await flushPromises();
};

describe("a photo's edit page", () => {
  beforeEach(() => {
    resetFilterUse();
    localStorage.setItem('lang', 'fr');
    solved.value = true;
    getPhotos
      .mockReset()
      .mockResolvedValue([
        photo(),
        photo({ id: 'p2', labels: ['Galaxies', 'LRGB', 'Grand champ'] }),
      ]);
    getGearSetups.mockReset().mockResolvedValue([{ id: 's1', name: 'Équipement 1' }]);
    updatePhotoMetadata.mockReset().mockResolvedValue(undefined);
    deletePhotoAPI.mockReset().mockResolvedValue(undefined);
    skySelection.value = null;
    confirm.mockReset().mockResolvedValue(true);
    showError.mockReset();
    showNotice.mockReset();
    pickFile.mockReset();
    solveWCS.mockReset();
    pendingWcs.value = null;
    replace.mockReset();
    back.mockReset();
  });

  it('shows what the photo has', async () => {
    const w = await mountPage();
    expect(w.find('h1').text()).toBe('Modifier les infos');
    expect((byLabel(w, 'input', 'Nom du fichier').element as HTMLInputElement).value).toBe(
      'M31_stack.jpg',
    );
    expect(chips(w)).toEqual(['M31', 'M110', 'LRGB', 'C/2023 A3']);
    expect(w.findAll('.mob-integration')).toHaveLength(1);
    expect(w.find('.mob-integration-total').text()).toBe('= 2h00');
    expect(byLabel(w, 'button', 'Équipement : Équipement 1').exists()).toBe(true);
    expect(w.findAll('.mob-field-row label').map((l) => l.text())).toEqual([
      'Gain',
      'Temp. capteur',
    ]);
    expect((byLabel(w, 'input', 'Notes').element as HTMLInputElement).value).toBe('Seeing moyen');
  });

  it('saves the form as it stands and goes back to the photo', async () => {
    const w = await mountPage();
    await save(w);
    expect(updatePhotoMetadata).toHaveBeenCalledWith('p1', {
      dsoIds: ['M31', 'M110'],
      labels: ['LRGB'],
      pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
      integrations: [{ frames: 40, seconds: 180, filter: 'L' }],
      observationDate: '2025-09-14T12:00:00.000Z',
      captureDetails: { gain: 100, ccdTemp: -10 },
      gearSetupId: 's1',
      notes: 'Seeing moyen',
      originalName: 'M31_stack.jpg',
    });
    expect(replace).toHaveBeenCalledWith('/gallery/photo/p1');
    expect(confirm).not.toHaveBeenCalled();
  });

  // "Supprimer cette photo" is in the footer with Annuler and Enregistrer (first in the markup: the left of the row in
  // landscape; the style puts it on a row of its own under them in portrait).
  it('has the delete button in its footer', async () => {
    const w = await mountPage();
    expect(w.findAll('.mob-footer button').map((b) => b.text())).toEqual([
      'Supprimer cette photo',
      'Annuler',
      'Enregistrer',
    ]);
    expect(byText(w, 'button', 'Supprimer cette photo').classes()).toContain('mob-footer-delete');
  });

  it('deletes the photo once confirmed, closes its sheet on the map and leaves to the gallery', async () => {
    skySelection.value = { kind: 'photo', photo: photo() };
    const w = await mountPage();
    await byText(w, 'button', 'Supprimer cette photo').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(deletePhotoAPI).toHaveBeenCalledWith('p1');
    expect(updatePhotoMetadata).not.toHaveBeenCalled();
    expect(skySelection.value).toBeNull();
    // No page to go back to here: the gallery, as the photo's own page is gone.
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });

  it('keeps the photo and the page when the delete is not confirmed', async () => {
    confirm.mockResolvedValue(false);
    const w = await mountPage();
    await byText(w, 'button', 'Supprimer cette photo').trigger('click');
    await flushPromises();
    expect(deletePhotoAPI).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('shows the red toast and stays when the delete fails', async () => {
    deletePhotoAPI.mockRejectedValue(new Error('boom'));
    const w = await mountPage();
    await byText(w, 'button', 'Supprimer cette photo').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(byText(w, 'button', 'Supprimer cette photo').attributes('disabled')).toBeUndefined();
  });

  it('removes an object and adds the typed one, without its spaces', async () => {
    const w = await mountPage();
    await byLabel(w, 'div', 'Retirer M110').trigger('click');
    const field = byLabel(w, 'input', 'Rechercher un DSO…');
    await field.setValue(' NGC 206 ');
    await field.trigger('keydown.enter');
    expect(chips(w).slice(0, 2)).toEqual(['M31', 'NGC206']);
    await save(w);
    expect(saved().dsoIds).toEqual(['M31', 'NGC206']);
  });

  it('offers the objects found for what is typed, and adds the one tapped', async () => {
    vi.useFakeTimers();
    try {
      const w = await mountPage();
      await byLabel(w, 'input', 'Rechercher un DSO…').setValue('m3');
      await vi.advanceTimersByTimeAsync(250);
      expect(rowTitles(w)).toContain('M32');
      expect(rowTitles(w)).toContain('M33 — Galaxie du Triangle');
      await byText(w, '.mob-row', 'M33 — Galaxie du Triangle').trigger('click');
      expect(chips(w)).toContain('M33');
      expect(rowTitles(w)).not.toContain('M32');
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the other photos' labels for what is typed, and adds a new one with the plus", async () => {
    const w = await mountPage();
    const field = byLabel(w, 'input', 'Ajouter une étiquette…');
    await field.setValue('ga');
    await byText(w, '.mob-row', 'Galaxies').trigger('click');
    await field.setValue(' Balcon ');
    await w.findAll('.mob-add-row')[1].find('button').trigger('click');
    await save(w);
    expect(saved().labels).toEqual(['LRGB', 'Galaxies', 'Balcon']);
  });

  it('removes a point of interest, and shows the identifications only for a placed photo', async () => {
    const w = await mountPage();
    expect(poiRows(w)).toEqual([
      "Ajouter un point d'intérêt",
      'Identifier un astéroïde',
      'Identifier des supernovae',
      'Identifier des comètes',
    ]);
    await byLabel(w, 'div', 'Retirer C/2023 A3').trigger('click');
    await save(w);
    expect(saved().pointsOfInterest).toEqual([]);

    solved.value = false;
    const unplaced = await mountPage();
    expect(poiRows(unplaced)).toEqual(["Ajouter un point d'intérêt"]);
    expect(row(unplaced, "Ajouter un point d'intérêt").classes()).toContain('mob-row--disabled');
  });

  it("opens the identifications and Ajouter un point d'intérêt, whose points join the form", async () => {
    const w = await mountPage();
    await row(w, 'Identifier des supernovae').trigger('click');
    expect(push).toHaveBeenLastCalledWith('/gallery/photo/p1/identify/supernova');
    await row(w, "Ajouter un point d'intérêt").trigger('click');
    expect(push).toHaveBeenLastCalledWith('/gallery/photo/p1/poi');

    // What a page found joins the form, not the saved photo; one already listed is not added twice.
    const fresh = await deliverPois(photo(), [
      { name: 'C/2023 A3', categoryId: 'cat-comet' },
      { name: 'SN 2025rbs', categoryId: 'cat-supernova', ra: 339.26, dec: 34.42 },
    ]);
    expect(fresh.map((p) => p.name)).toEqual(['SN 2025rbs']);
    expect(updatePhotoMetadata).not.toHaveBeenCalled();
    await save(w);
    expect(saved().pointsOfInterest.map((p: { name: string }) => p.name)).toEqual([
      'C/2023 A3',
      'SN 2025rbs',
    ]);
  });

  it('edits the integration rows: a new row, its total, a refused number, a removed row', async () => {
    const w = await mountPage();
    await byText(w, 'button', 'Ajouter une ligne').trigger('click');
    const line = w.findAll('.mob-integration')[1];
    // the numbers first, then the filter on its own line under them, with no text field
    const [frames, seconds] = line.findAll('input');
    expect(line.findAll('input')).toHaveLength(2);
    await frames.setValue('10');
    expect(line.find('.mob-integration-total').text()).toBe('');
    await seconds.setValue('300');
    expect(line.find('.mob-integration-total').text()).toBe('= 50min');
    await seconds.setValue('abc');
    expect(showError).toHaveBeenCalledTimes(1);
    expect(line.find('.mob-integration-filter').text()).toBe('Filtres');
    await byLabel(w, 'button', 'Choisir le filtre de la ligne 2').trigger('click');
    await row(w, 'Ha').trigger('click');
    expect(w.findAll('.mob-integration')[1].find('.mob-badge--filter').text()).toBe('Ha');
    await byLabel(w, 'button', "Supprimer la ligne d'intégration").trigger('click');
    await save(w);
    expect(saved().integrations).toEqual([{ frames: 10, seconds: 300, filter: 'Ha' }]);
  });

  it("lists the filters of the photos' exposures first when a row's filter is chosen", async () => {
    getPhotos.mockResolvedValue([
      photo(),
      photo({
        id: 'p2',
        observationDate: '2026-01-01T00:00:00.000Z',
        integrations: [{ frames: 1, seconds: 1, filter: 'Antlia 3nm H-Alpha Pro' }],
      }),
    ]);
    const w = await mountPage();
    await byLabel(w, 'button', 'Changer le filtre de la ligne 1').trigger('click');
    const sheet = w.findComponent({ name: 'FilterPickSheet' });
    expect(sheet.findAll('.mob-section-header').map((h) => h.text())).toEqual([
      'Récents',
      'Tous les filtres',
    ]);
    const titles = sheet.findAll('.mob-row-title').map((t) => t.text());
    // "Ajouter un filtre", "Aucun filtre", then the newest photo's filter first, each filter once
    expect(titles.slice(2, 4)).toEqual(['Antlia 3nm H-Alpha Pro', 'L']);
    expect(titles.filter((t) => t === 'L')).toHaveLength(1);
  });

  it('offers a filter just chosen first among the recent ones, before it is saved', async () => {
    const w = await mountPage();
    await byText(w, 'button', 'Ajouter une ligne').trigger('click');
    await byLabel(w, 'button', 'Choisir le filtre de la ligne 2').trigger('click');
    await row(w, 'OIII').trigger('click');
    await byLabel(w, 'button', 'Changer le filtre de la ligne 1').trigger('click');
    const sheet = w.findComponent({ name: 'FilterPickSheet' });
    const titles = sheet.findAll('.mob-row-title').map((t) => t.text());
    expect(titles.slice(2, 4)).toEqual(['OIII', 'L']);
    expect(updatePhotoMetadata).not.toHaveBeenCalled();
  });

  it('hides "Aucun filtre" once a search is typed', async () => {
    const w = await mountPage();
    await byLabel(w, 'button', 'Changer le filtre de la ligne 1').trigger('click');
    const sheet = w.findComponent({ name: 'FilterPickSheet' });
    const titles = () => sheet.findAll('.mob-row-title').map((t) => t.text());
    expect(titles()).toContain('Aucun filtre');
    await sheet.find('.mob-sheet-header input').setValue('ha');
    expect(titles()).not.toContain('Aucun filtre');
    expect(titles()).toContain('Ha');
  });

  it('opens the filter add page from the list, for that row', async () => {
    const w = await mountPage();
    await byLabel(w, 'button', 'Changer le filtre de la ligne 1').trigger('click');
    await row(w, 'Ajouter un filtre').trigger('click');
    expect(push).toHaveBeenCalledWith('/settings/gear/filter/new');
  });

  it('keeps a row with a filter only, and refuses to save a row with nothing in it', async () => {
    const w = await mountPage();
    await byText(w, 'button', 'Ajouter une ligne').trigger('click');
    await save(w);
    expect(updatePhotoMetadata).not.toHaveBeenCalled();
    expect(showError.mock.calls[0][0].message).toBe(
      'Saisissez un nombre de poses, une durée de pose ou un filtre avant de valider cette ligne.',
    );
    await byLabel(w, 'button', 'Choisir le filtre de la ligne 2').trigger('click');
    await row(w, 'OIII').trigger('click');
    await save(w);
    expect(saved().integrations).toEqual([
      { frames: 40, seconds: 180, filter: 'L' },
      { frames: 0, seconds: 0, filter: 'OIII' },
    ]);
  });

  it('sets and empties the observation date', async () => {
    const w = await mountPage();
    const picker = w.findComponent(PhoneNativePicker);
    picker.vm.$emit('pick', '2025-01-02T03:04');
    await flushPromises();
    expect((byLabel(w, 'input', "Date d'observation").element as HTMLInputElement).value).toBe(
      '2025-01-02 03:04',
    );
    picker.vm.$emit('clear');
    await save(w);
    expect(saved().observationDate).toBeNull();
  });

  it('links the photo to no equipment', async () => {
    const w = await mountPage();
    await byText(w, 'button[role="radio"]', '— Aucun —').trigger('click');
    await save(w);
    expect(saved().gearSetupId).toBeNull();
  });

  it('adds a capture field chosen in the list, changes one and removes one', async () => {
    const w = await mountPage();
    const plus = () => w.findAll('.mob-add-row')[2].findAll('button').at(-1)!;
    expect(plus().attributes('disabled')).toBeDefined();
    await byText(w, 'button[role="radio"]', 'ISO').trigger('click');
    await plus().trigger('click');
    expect(w.findAll('.mob-field-row label').map((l) => l.text())).toEqual([
      'Gain',
      'ISO',
      'Temp. capteur',
    ]);
    await byLabel(w, 'input', 'ISO').setValue('800');
    await byLabel(w, 'input', 'Gain').setValue('120');
    await byLabel(w, 'button', 'Supprimer le champ Temp. capteur').trigger('click');
    await save(w);
    expect(saved().captureDetails).toEqual({ gain: 120, iso: 800 });
  });

  it('leaves at once without changes, and asks first with changes', async () => {
    const w = await mountPage();
    await byText(w, 'button', 'Annuler').trigger('click');
    await flushPromises();
    expect(confirm).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);

    const changed = await mountPage();
    replace.mockReset();
    await byLabel(changed, 'input', 'Notes').setValue('autre');
    confirm.mockResolvedValue(false);
    await byText(changed, 'button', 'Annuler').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Vous avez des modifications non enregistrées.',
        destructive: true,
      }),
    );
    expect(replace).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await byLabel(changed, 'button', 'Retour').trigger('click');
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/gallery/photo/p1');
    expect(updatePhotoMetadata).not.toHaveBeenCalled();
  });

  it('stays on the page with a red toast when saving fails', async () => {
    updatePhotoMetadata.mockRejectedValue(new Error('nope'));
    const w = await mountPage();
    await save(w);
    expect(showError).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  describe('"Charger un fichier WCS"', () => {
    const empty = { observationDate: null, integrations: [], captureDetails: {} };
    const REF = { photoX: 10, photoY: 10, ra: 10.68, dec: 41.27 };
    const read = {
      success: true,
      correspondences: [REF],
      dateObs: '2025-10-01T20:00:00Z',
      expTime: 300,
      stackCnt: 12,
      filter: 'Ha',
    };
    const loaded = (result: unknown, solved = true): WcsLoaded => ({
      result: result as WcsLoaded['result'],
      solved,
      suggestedSetup: null,
      filename: 'm31.fits',
    });

    beforeEach(() => {
      confirmWcsWarnings.mockReset().mockResolvedValue(true);
      showWarning.mockReset();
      setPhotoFitsHeaders.mockReset().mockResolvedValue(undefined);
      loadSetupOptics.mockReset().mockResolvedValue([]);
    });

    it('fills only the empty fields from the file, unsaved until Enregistrer', async () => {
      getPhotos.mockResolvedValue([photo(empty)]);
      const file = new File(['x'], 'm31.fits');
      pickFile.mockResolvedValue(file);
      solveWCS.mockResolvedValue(read);
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      expect(solveWCS).toHaveBeenCalledWith(file, 4000, 2000);
      expect(showNotice).toHaveBeenCalledWith('Métadonnées chargées depuis le fichier');
      expect(updatePhotoMetadata).not.toHaveBeenCalled();
      await save(w);
      expect(saved().observationDate).toBe('2025-10-01T20:00:00Z');
      expect(saved().integrations).toEqual([{ frames: 12, seconds: 300, filter: 'Ha' }]);
    });

    it('keeps what the photo already has, and says nothing new was found', async () => {
      pickFile.mockResolvedValue(new File(['x'], 'm31.fits'));
      solveWCS.mockResolvedValue({
        success: true,
        correspondences: [REF],
        dateObs: '2025-10-01T20:00:00Z',
      });
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      expect(showNotice).toHaveBeenCalledWith(
        'Aucune nouvelle métadonnée trouvée (valeurs conservées)',
      );
      await save(w);
      expect(saved().observationDate).toBe('2025-09-14T12:00:00.000Z');
    });

    it('says so with a red toast when the file cannot be read', async () => {
      pickFile.mockResolvedValue(new File(['x'], 'bad.fits'));
      solveWCS.mockResolvedValue({ success: false, code: 'NO_WCS' });
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      expect(showError).toHaveBeenCalled();
      expect(showNotice).not.toHaveBeenCalled();
    });

    it("fills the form with a file read from the photo's sheet, and asks before leaving it unsaved", async () => {
      getPhotos.mockResolvedValue([photo(empty)]);
      pendingWcs.value = { photoId: 'p1', ...loaded(read) };
      const w = await mountPage();
      expect(pendingWcs.value).toBeNull();
      expect(showNotice).toHaveBeenCalledWith('Métadonnées chargées depuis le fichier');
      confirm.mockResolvedValueOnce(false);
      await byText(w, 'button', 'Annuler').trigger('click');
      await flushPromises();
      expect(confirm).toHaveBeenCalled();
      expect(back).not.toHaveBeenCalled();
    });

    it('takes the capture data of a file without a plate solution, says so in amber, and saves its headers', async () => {
      getPhotos.mockResolvedValue([photo(empty)]);
      const cards = [{ key: 'EXPTIME', value: '30.' }];
      pickFile.mockResolvedValue(new File(['x'], 'M2.fit'));
      solveWCS.mockResolvedValue({
        success: false,
        code: 'NO_WCS_DATA',
        expTime: 30,
        stackCnt: 44,
        fitsHeaders: cards,
      });
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      expect(showError).not.toHaveBeenCalled();
      expect(showWarning).toHaveBeenCalledWith(
        "M2.fit n'est pas résolu astrométriquement : la photo n'est pas placée par ce fichier, mais ses données de prise de vue ont été chargées.",
      );
      expect(setPhotoFitsHeaders).not.toHaveBeenCalled();
      await save(w);
      expect(saved().integrations).toEqual([{ frames: 44, seconds: 30, filter: '' }]);
      expect(setPhotoFitsHeaders).toHaveBeenCalledWith('p1', cards);
    });

    it('fills the setup the header points to, for a photo without one', async () => {
      getPhotos.mockResolvedValue([photo({ ...empty, gearSetupId: null })]);
      getGearSetups.mockResolvedValue([{ id: 's30', name: 'Seestar' }]);
      loadSetupOptics.mockResolvedValue([
        {
          setupId: 's30',
          nativeFocalMm: 150,
          effectiveFocalMm: 150,
          pixelSizeUm: 2.9,
          telescopeName: 'ZWO Seestar S30',
          cameraName: 'ZWO Seestar S30',
          setupName: 'Seestar',
        },
      ]);
      pickFile.mockResolvedValue(new File(['x'], 'S30.fit'));
      solveWCS.mockResolvedValue({
        success: false,
        code: 'NO_WCS_DATA',
        facts: { telescope: 'S30_0289c34b', instrument: 'Seestar S30', focalLengthMm: 150 },
        fitsHeaders: [{ key: 'SIMPLE', value: 'T' }],
      });
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      await save(w);
      expect(saved().gearSetupId).toBe('s30');
    });

    it('asks about what does not match the photo, and takes nothing when cancelled', async () => {
      getPhotos.mockResolvedValue([photo(empty)]);
      pickFile.mockResolvedValue(new File(['x'], 'autre.fits'));
      solveWCS.mockResolvedValue({
        ...read,
        dimensionWarning: {
          sourceW: 3000,
          sourceH: 3000,
          targetW: 4000,
          targetH: 2000,
          aspectMismatch: true,
        },
      });
      confirmWcsWarnings.mockResolvedValueOnce(false);
      const w = await mountPage();
      await byText(w, 'button', 'Charger un fichier WCS (fits/tiff)').trigger('click');
      await flushPromises();
      expect(confirmWcsWarnings).toHaveBeenCalledWith(
        'autre.fits',
        expect.arrayContaining([expect.stringContaining('3000×3000')]),
      );
      expect(showNotice).not.toHaveBeenCalled();
      await save(w);
      expect(saved().observationDate).toBeNull();
    });

    it("leaves another photo's file alone", async () => {
      pendingWcs.value = { photoId: 'p2', ...loaded(read) };
      await mountPage();
      expect(pendingWcs.value).not.toBeNull();
      expect(showNotice).not.toHaveBeenCalled();
    });
  });

  it('goes back to the gallery when the photo no longer exists', async () => {
    getPhotos.mockResolvedValue([]);
    const w = await mountPage();
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
    expect(w.find('.mob-integration').exists()).toBe(false);
  });
});
