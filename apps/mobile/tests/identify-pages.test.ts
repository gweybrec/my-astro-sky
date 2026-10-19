import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Photo, PoiCategory } from '@myastrosky/core/types';
import { parseCometEls, parseTnsCsv } from '@myastrosky/core/services/identify';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
const updatePhotoMetadata = vi.fn();
const skybotConesearchAPI = vi.fn();
const tnsConesearchAPI = vi.fn();
const cometElementsAPI = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  getPhotos: () => getPhotos(),
  updatePhotoMetadata: (...a: unknown[]) => updatePhotoMetadata(...a),
  skybotConesearchAPI: (p: unknown) => skybotConesearchAPI(p),
  tnsConesearchAPI: (p: unknown) => tnsConesearchAPI(p),
  cometElementsAPI: () => cometElementsAPI(),
  photoFileUrl: (name: string) => `/uploads/${name}`,
}));

const categories: PoiCategory[] = [
  { id: 'cat-comet', name: 'Comète', color: '#4ea1ff', position: 0 },
  { id: 'cat-asteroid', name: 'Astéroïde', color: '#c9a227', position: 1 },
  { id: 'cat-satellite', name: 'Satellite', color: '#7bd88f', position: 2 },
  { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
];
const saveDraft = vi.fn();
vi.mock('@myastrosky/app-state/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({
    categories,
    ensureLoaded: () => Promise.resolve(),
    saveDraft: (d: unknown) => saveDraft(d),
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
const showNotice = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice }),
}));
vi.mock('../src/composables/useBackClose', () => ({ useBackClose: vi.fn() }));

import IdentifyAsteroidPage from '../src/pages/identify/IdentifyAsteroidPage.vue';
import IdentifySupernovaPage from '../src/pages/identify/IdentifySupernovaPage.vue';
import IdentifyCometPage from '../src/pages/identify/IdentifyCometPage.vue';
import PoiAddPage from '../src/pages/identify/PoiAddPage.vue';
import PoiTypesPage from '../src/pages/PoiTypesPage.vue';
import PhonePhotoStage from '../src/components/PhonePhotoStage.vue';
import { photoPixelsToRaDec } from '@myastrosky/core/photo-identify';

/** The boards "Identifier un astéroïde", "… des supernovae", "… des comètes", "Ajouter un point d'intérêt" and "Types
 * de points d'intérêt", on synthetic solved photos (correspondences at given sky positions, as the core tests). */

function solvedPhoto(
  width: number,
  height: number,
  ra0: number,
  dec0: number,
  scaleArcsec: number,
  over: Partial<Photo> = {},
): Photo {
  const scale = scaleArcsec / 3600;
  const sky = (x: number, y: number) => ({
    ra: ra0 - ((x - width / 2) * scale) / Math.cos((dec0 * Math.PI) / 180),
    dec: dec0 - (y - height / 2) * scale,
  });
  const points = [
    { x: width * 0.1, y: height * 0.1 },
    { x: width * 0.9, y: height * 0.15 },
    { x: width * 0.5, y: height * 0.9 },
  ];
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'NGC7331.jpg',
    width,
    height,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: points.map((p, i) => ({
      pointIndex: i,
      photoX: p.x,
      photoY: p.y,
      starHip: 0,
      starName: `p${i}`,
      starRa: sky(p.x, p.y).ra,
      starDec: sky(p.x, p.y).dec,
    })),
    dsoIds: ['NGC7331'],
    labels: [],
    pointsOfInterest: [],
    integrations: [{ frames: 24, seconds: 300, filter: 'L' }],
    observationDate: '2026-09-04T20:02:11.000Z',
    captureDetails: {},
    gearSetupId: null,
    notes: '',
    ...over,
  };
}
const NGC7331 = solvedPhoto(664, 470, 339.267614, 34.419887, 1.5);
const R2 = solvedPhoto(1341, 790, 341.441, 2.273, 2.36, {
  observationDate: '2025-11-07T18:42:00.000Z',
});

type Wrapper = ReturnType<typeof mount>;
const mountPage = async (page: unknown) => {
  const w = mount(page as never, { global: { stubs: ionicStubs } });
  await flushPromises();
  return w;
};
const byText = (w: Wrapper, selector: string, text: string) =>
  w.findAll(selector).find((b) => b.text().trim() === text)!;
const byLabel = (w: Wrapper, selector: string, name: string) =>
  w.findAll(selector).find((b) => b.attributes('aria-label') === name)!;
const tapPhoto = async (w: Wrapper, at: { x: number; y: number }) => {
  w.findComponent(PhonePhotoStage).vm.$emit('tap', at);
  await flushPromises();
};
const savedPois = () => updatePhotoMetadata.mock.calls[0][1].pointsOfInterest;

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  for (const f of [updatePhotoMetadata, push, replace, back, showError, showNotice, saveDraft]) {
    f.mockReset();
  }
  updatePhotoMetadata.mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
});

describe('identify an asteroid', () => {
  beforeEach(() => getPhotos.mockReset().mockResolvedValue([NGC7331]));

  it('marks the trail, searches SkyBoT around it, ticks the best match and saves it on the photo', async () => {
    const w = await mountPage(IdentifyAsteroidPage);
    expect(w.find('h1').text()).toBe('Identifier un astéroïde');
    // The times come from the photo: its date, and its date plus its integration (24 × 300 s).
    // The fields shown, not the inputs of the phone's pickers behind them.
    const fields = w
      .findAll('.mob-when-row input')
      .filter((i) => !i.element.closest('.mob-picker-inputs'))
      .map((i) => (i.element as HTMLInputElement).value);
    expect(fields).toEqual(['2026-09-04', '20:02', '2026-09-04', '22:02', '5']);
    const search = byLabel(w, 'button', 'Rechercher');
    expect(search.attributes('disabled')).toBeDefined();

    // Départ first, then Arrivée: the second tap places the end.
    await tapPhoto(w, { x: 200, y: 235 });
    await tapPhoto(w, { x: 460, y: 235 });
    expect(w.findAll('.mob-marker').map((m) => m.text())).toEqual(['D', 'A']);

    const [s, e] = photoPixelsToRaDec(NGC7331, [
      { x: 200, y: 235 },
      { x: 460, y: 235 },
    ])!;
    const along = {
      number: '1685',
      name: 'Toro',
      raDeg: (s.ra + e.ra) / 2,
      decDeg: (s.dec + e.dec) / 2,
      className: 'NEA>Apollo',
      vMag: 16.2,
      ephemErrArcsec: 1,
      distArcsec: 0,
      dRaArcsecPerHour: (((e.ra - s.ra) * Math.cos((34.42 * Math.PI) / 180)) / 2) * 3600,
      dDecArcsecPerHour: 0,
    };
    const far = {
      ...along,
      number: '2204',
      name: 'Lyyli',
      className: 'MB>Middle',
      dRaArcsecPerHour: 0,
      ephemErrArcsec: 120,
    };
    skybotConesearchAPI.mockResolvedValue([far, along]);
    await byLabel(w, 'button', 'Rechercher').trigger('click');
    await flushPromises();
    // The trail is 6.5′ long: the radius grows to what it calls for.
    expect(skybotConesearchAPI.mock.calls[0][0].radiusArcmin).toBeCloseTo(24.5, 1);

    expect(w.find('.mob-helper').text()).toBe('2 astéroïdes trouvés');
    const rows = w.findAll('.mob-check-row');
    expect(rows.map((r) => r.find('.mob-row-title').text())).toEqual([
      '(1685) Toro',
      '(2204) Lyyli',
    ]);
    expect(rows[1].find('.mob-status--warn').text()).toBe('Orbite incertaine');
    expect(rows.map((r) => r.attributes('aria-checked'))).toEqual(['true', 'false']);

    await byText(w, 'button', 'Ajouter la sélection (1)').trigger('click');
    await flushPromises();
    expect(savedPois()).toEqual([
      expect.objectContaining({ name: '(1685) Toro', categoryId: 'cat-asteroid' }),
    ]);
    expect(showNotice).toHaveBeenCalledWith('(1685) Toro ajouté(s) aux points d’intérêt');
    expect(replace).toHaveBeenCalledWith('/gallery/photo/p1');
  });

  it('goes back to the marks with "Modifier la recherche"', async () => {
    const w = await mountPage(IdentifyAsteroidPage);
    await tapPhoto(w, { x: 200, y: 235 });
    await tapPhoto(w, { x: 460, y: 235 });
    skybotConesearchAPI.mockResolvedValue([]);
    await byLabel(w, 'button', 'Rechercher').trigger('click');
    await flushPromises();
    expect(w.find('.mob-helper').text()).toBe(
      'Aucun astéroïde correspondant trouvé dans le rayon de recherche',
    );
    await byText(w, 'button', 'Modifier la recherche').trigger('click');
    expect(w.findAll('.mob-when-row')).toHaveLength(3);
    expect(w.findAll('.mob-marker')).toHaveLength(2);
  });

  it('shows a spinner while SkyBoT answers, and after 20 s says the search still runs', async () => {
    const w = await mountPage(IdentifyAsteroidPage);
    await tapPhoto(w, { x: 200, y: 235 });
    await tapPhoto(w, { x: 460, y: 235 });
    skybotConesearchAPI.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await byLabel(w, 'button', 'Rechercher').trigger('click');
      await nextTick();
      expect(w.find('.mob-busy').text()).toBe('Recherche…');
      expect(w.text()).not.toContain('jusqu’à une minute');
      vi.advanceTimersByTime(20_000);
      await nextTick();
      expect(w.text()).toContain(
        'Toujours en cours : le service en ligne répond parfois lentement',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the photo instead when it has no solve', async () => {
    getPhotos.mockResolvedValue([{ ...NGC7331, correspondences: [] }]);
    await mountPage(IdentifyAsteroidPage);
    expect(replace).toHaveBeenCalledWith('/gallery/photo/p1');
  });
});

describe('identify supernovae', () => {
  const CANDIDATES = parseTnsCsv(
    readFileSync(join(__dirname, '../../../tests/fixtures/tns/ngc7331-search.csv'), 'utf-8'),
  );
  beforeEach(() => {
    getPhotos.mockReset().mockResolvedValue([NGC7331]);
    tnsConesearchAPI.mockReset().mockResolvedValue(CANDIDATES);
  });

  it('searches as it opens, pins what falls in the photo and ticks the confirmed supernovae', async () => {
    const w = await mountPage(IdentifySupernovaPage);
    expect(tnsConesearchAPI).toHaveBeenCalledOnce();
    expect(tnsConesearchAPI.mock.calls[0][0].dateStart).toBe('2025-09-04');
    const rows = w.findAll('.mob-check-row');
    expect(rows.map((r) => r.find('.mob-row-title').text()).sort()).toEqual([
      'SN 2025rbs',
      'SN 2026aaiv',
    ]);
    expect(w.findAll('.mob-pin')).toHaveLength(2);
    expect(rows[0].find('.mob-badge--type').text()).toBe('SN Ia');
    expect(rows[0].find('.mob-row-sub').text()).toContain('3 j après la découverte');
    const tns = byText(w, '.mob-row-actions button', 'Voir sur TNS');
    expect(tns.attributes('href')).toBe('https://www.wis-tns.org/object/2026aaiv');
    expect(tns.attributes('target')).toBe('_blank');

    // Unticking one dims its pin; the other is added.
    await rows[1].trigger('click');
    expect(w.findAll('.mob-pin--off')).toHaveLength(1);
    await byText(w, 'button', 'Ajouter la sélection (1)').trigger('click');
    await flushPromises();
    expect(savedPois()).toHaveLength(1);
    expect(savedPois()[0]).toMatchObject({ name: 'SN 2026aaiv', categoryId: 'cat-supernova' });
  });

  it('asks for a date when the photo has none, and does not search', async () => {
    getPhotos.mockResolvedValue([{ ...NGC7331, observationDate: undefined }]);
    const w = await mountPage(IdentifySupernovaPage);
    expect(tnsConesearchAPI).not.toHaveBeenCalled();
    expect(w.find('.mob-helper.mob-status--warn').text()).toContain(
      'n’a pas de date d’observation',
    );
    expect(byLabel(w, 'button', 'Rechercher').attributes('disabled')).toBeDefined();
  });

  it("says why when TNS's answer fails", async () => {
    tnsConesearchAPI.mockRejectedValue(new Error('429'));
    const w = await mountPage(IdentifySupernovaPage);
    expect(w.find('.mob-status--danger').text()).toBe('Échec de la recherche TNS : 429');
  });
});

describe('identify comets', () => {
  const COMETS = parseCometEls(
    readFileSync(join(__dirname, '../../../tests/fixtures/comets/CometEls-sample.txt'), 'utf-8'),
  );
  beforeEach(() => {
    getPhotos.mockReset().mockResolvedValue([R2]);
    cometElementsAPI.mockReset().mockResolvedValue(COMETS);
  });

  it('pins the comet in the photo; a tap moves its pin, which is then saved where it was put', async () => {
    const w = await mountPage(IdentifyCometPage);
    const row = w.find('.mob-check-lead-row');
    expect(row.find('.mob-row-title').text()).toBe('C/2025 R2 (SWAN)');
    expect(row.classes()).toContain('mob-row--current');
    expect(w.text()).toContain(
      'Touchez la photo pour placer le repère de C/2025 R2 (SWAN) sur son noyau',
    );
    expect(byText(w, 'button', 'Voir sur JPL').attributes('href')).toContain('sstr=C%2F2025%20R2');

    await tapPhoto(w, { x: 670.5, y: 395 });
    expect(row.find('.mob-badge').text()).toBe('Ajusté');
    await byText(w, 'button', 'Ajouter la sélection (1)').trigger('click');
    await flushPromises();
    expect(savedPois()[0].ra).toBeCloseTo(341.441, 3);
    expect(savedPois()[0].dec).toBeCloseTo(2.273, 3);
  });

  it('"Revenir à la position prédite" puts the pin back', async () => {
    const w = await mountPage(IdentifyCometPage);
    // The first tap does not grow the panel: the badge keeps its room while hidden, and the button is there from
    // the start, disabled until the pin is moved.
    const reset = () => byText(w, 'button', 'Revenir à la position prédite');
    const state = () => [
      w.find('.mob-badge').classes().includes('mob-invisible'),
      reset().attributes('disabled') !== undefined,
    ];
    expect(state()).toEqual([true, true]);
    await tapPhoto(w, { x: 10, y: 10 });
    expect(state()).toEqual([false, false]);
    await reset().trigger('click');
    expect(state()).toEqual([true, true]);
  });

  it('lists the comets near the field on a wrong date', async () => {
    getPhotos.mockResolvedValue([
      solvedPhoto(1147, 876, 327.783, -24.622, 2.36, {
        observationDate: '2026-07-27T20:12:00.000Z',
      }),
    ]);
    const w = await mountPage(IdentifyCometPage);
    expect(w.text()).toContain('Aucune comète connue dans cette photo');
    expect(w.text()).toContain('Près de ce champ');
    expect(w.findAll('.mob-results-list .mob-row-title').map((r) => r.text())).toContain(
      '10P/Tempel',
    );
  });
});

describe('add a point of interest', () => {
  beforeEach(() => getPhotos.mockReset().mockResolvedValue([NGC7331]));

  it('is named, typed and placed by a tap, its marker in the colour of its type', async () => {
    const w = await mountPage(PoiAddPage);
    const add = () => byText(w, '.mob-sheet-footer button', 'Ajouter');
    expect(add().attributes('disabled')).toBeDefined();
    await w.find('input[aria-label="Nom"]').setValue('Météore');
    await byText(w, '[role="radio"]', 'Satellite').trigger('click');
    await tapPhoto(w, { x: 332, y: 235 });
    const marker = w.find('.mob-marker--tint');
    expect(marker.attributes('style')).toContain('--poi-color: #7bd88f');
    await add().trigger('click');
    await flushPromises();
    expect(savedPois()[0]).toMatchObject({ name: 'Météore', categoryId: 'cat-satellite' });
    expect(savedPois()[0].ra).toBeCloseTo(339.267614, 3);
  });

  it('opens the types of points of interest from the pen', async () => {
    const w = await mountPage(PoiAddPage);
    await byLabel(w, 'button', 'Gérer les types').trigger('click');
    expect(push).toHaveBeenCalledWith('/gallery/poi-types');
  });
});

describe('the types of points of interest', () => {
  it('saves the edited list, and asks before leaving with changes', async () => {
    const w = await mountPage(PoiTypesPage);
    expect(w.findAll('.mob-type-row')).toHaveLength(5);
    await byLabel(w, 'button', 'Supprimer le type Satellite').trigger('click');
    await w.find('input[aria-label="Nom du nouveau type"]').setValue('Météore');
    await byLabel(w, 'button', 'Ajouter un type').trigger('click');
    expect(
      w
        .findAll('.mob-type-row input:not([type="color"])')
        .map((i) => (i.element as HTMLInputElement).value),
    ).toEqual(['Comète', 'Astéroïde', 'Supernova', 'Météore', '']);

    confirm.mockResolvedValue(false);
    await byText(w, 'footer button', 'Annuler').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();

    await byText(w, 'footer button', 'Enregistrer').trigger('click');
    await flushPromises();
    expect(saveDraft.mock.calls[0][0].map((d: { name: string }) => d.name)).toEqual([
      'Comète',
      'Astéroïde',
      'Supernova',
      'Météore',
    ]);
    expect(replace).toHaveBeenCalledWith('/tabs/gallery');
  });
});
