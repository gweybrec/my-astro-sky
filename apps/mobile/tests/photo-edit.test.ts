import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const getGearSetups = vi.fn();
const updatePhotoMetadata = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => getPhotos(),
  getGearSetups: () => getGearSetups(),
  updatePhotoMetadata: (...a: unknown[]) => updatePhotoMetadata(...a),
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
const showError = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
vi.mock('../src/composables/useBackClose', () => ({ useBackClose: vi.fn() }));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));

const solved = { value: true };
vi.mock('@myastrosky/core/photo-placement', () => ({
  computePhotoToProjMatrix: () => (solved.value ? [1, 0, 0, 1, 0, 0] : null),
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
    confirm.mockReset().mockResolvedValue(true);
    showError.mockReset();
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
    const row = w.findAll('.mob-integration')[1];
    const [filter, frames, seconds] = row.findAll('input');
    await filter.setValue(' Ha ');
    await frames.setValue('10');
    expect(row.find('.mob-integration-total').text()).toBe('');
    await seconds.setValue('300');
    expect(row.find('.mob-integration-total').text()).toBe('= 50min');
    await seconds.setValue('abc');
    expect(showError).toHaveBeenCalledTimes(1);
    await byLabel(w, 'button', "Supprimer la ligne d'intégration").trigger('click');
    await save(w);
    expect(saved().integrations).toEqual([{ frames: 10, seconds: 300, filter: 'Ha' }]);
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

  it('goes back to the gallery when the photo no longer exists', async () => {
    getPhotos.mockResolvedValue([]);
    const w = await mountPage();
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
    expect(w.find('.mob-integration').exists()).toBe(false);
  });
});
