import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { formatBytes } from '@myastrosky/core/format-utils';
import { setBackend } from '@myastrosky/app-state/backend';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import type { SharedSky, SharedSkyPreview } from '@myastrosky/core/domain/shared-sky';
import type { Photo } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const showError = vi.fn();
const showNotice = vi.fn();
const confirm = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice }),
}));
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
const pickFile = vi.fn();
vi.mock('../src/platform-device', () => ({
  SHARED_SKY_FILE_TYPES: { mimeTypes: [], extensions: ['.myastrosky', '.zip'] },
  pickFile: (...a: unknown[]) => pickFile(...a),
}));

import SharedSkiesPage from '../src/pages/SharedSkiesPage.vue';
import ShareSkyPage from '../src/pages/ShareSkyPage.vue';
import SkyViewField from '../src/pages/sky/SkyViewField.vue';
import SkyCheckSheet from '../src/pages/sky/SkyCheckSheet.vue';
import { MY_SKY } from '@myastrosky/core/shared-sky-view';
import { sharedSkyPreviewLines } from '../src/composables/useSharedSkyOpen';
import { photoFacts } from '../src/photo-facts';

const sky = (id: string, senderName: string, photoCount: number): SharedSky =>
  ({
    id,
    senderName,
    sharedAt: '2026-11-02T10:00:00Z',
    receivedAt: '2026-11-03T10:00:00Z',
    photoCount,
    bytes: 312_400_000,
    poiCategories: [],
  }) as unknown as SharedSky;

const preview = (over: Partial<SharedSkyPreview> = {}): SharedSkyPreview =>
  ({
    skyId: 'sky-new',
    senderName: 'Lucie Martin',
    sharedAt: '2026-11-08T10:00:00Z',
    photoCount: 18,
    bytes: 254_700_000,
    freeBytes: null,
    status: 'new',
    existing: null,
    ...over,
  }) as unknown as SharedSkyPreview;

const placedPhoto = (id: string, name: string, fileSize: number) =>
  ({
    id,
    originalName: name,
    fileSize,
    correspondences: [{}, {}],
    dsoIds: [],
  }) as unknown as Photo;

const backend = {
  photos: { listWithSizes: vi.fn() },
  sharedSkies: {
    senderName: vi.fn(),
    list: vi.fn(),
    listPhotos: vi.fn(),
    remove: vi.fn(),
    makeMissingMediums: vi.fn(),
    exportToUser: vi.fn(),
    inspect: vi.fn(),
    open: vi.fn(),
    discard: vi.fn(),
  },
};

async function mountPage(component: object, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/settings/shared-skies');
  if (path !== '/settings/shared-skies') await router.push(path);
  const w = mount(component, { global: { stubs: ionicStubs, plugins: [router] } });
  await flushPromises();
  return { w, router };
}

const button = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll('button').find((b) => b.text() === label)!;

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  vi.clearAllMocks();
  backend.sharedSkies.list.mockResolvedValue([
    sky('s1', 'Marie Dupont', 24),
    sky('s2', 'Club astro des Vosges', 9),
  ]);
  backend.sharedSkies.listPhotos.mockResolvedValue([]);
  backend.sharedSkies.senderName.mockResolvedValue('Observatoire du jardin');
  backend.sharedSkies.discard.mockResolvedValue(undefined);
  backend.photos.listWithSizes.mockResolvedValue([
    placedPhoto('p1', 'M31.jpg', 4_000_000),
    placedPhoto('p2', 'M42.png', 6_000_000),
    { ...placedPhoto('p3', 'waiting.jpg', 1_000), correspondences: [] },
  ]);
  setBackend(backend as never);
});

describe('the shared skies page', () => {
  it('lists the visited skies with their date, photos and size, or says there is none', async () => {
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    expect(w.find('h1').text()).toBe('Ciels partagés');
    const rows = w.findAll('.mob-row');
    expect(rows.map((r) => r.find('.mob-row-title').text())).toEqual([
      'Marie Dupont',
      'Club astro des Vosges',
    ]);
    expect(rows[0].text()).toContain('Partagé le');
    expect(rows[0].text()).toContain(`24 photo(s) · ${formatBytes(312_400_000)}`);

    backend.sharedSkies.list.mockResolvedValue([]);
    const empty = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    expect(empty.w.text()).toContain('Aucun ciel visité.');
  });

  it('opens "Partager mon ciel"', async () => {
    const { w, router } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Partager mon ciel…').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/shared-skies/share');
  });

  it('reads a picked file, asks, then keeps it as a visit', async () => {
    const file = new File(['x'], 'Lucie.myastrosky');
    pickFile.mockResolvedValue(file);
    backend.sharedSkies.inspect.mockResolvedValue({ ticket: 't1', preview: preview() });
    backend.sharedSkies.open.mockResolvedValue(sky('sky-new', 'Lucie Martin', 18));
    confirm.mockResolvedValue(true);
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Ouvrir un ciel partagé…').trigger('click');
    await flushPromises();
    expect(backend.sharedSkies.inspect.mock.calls[0][0].name).toBe(file.name);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ouvrir un ciel partagé', confirmLabel: 'Ouvrir' }),
    );
    expect(confirm.mock.calls[0][0].message).toContain('Ciel de Lucie Martin');
    expect(backend.sharedSkies.open.mock.calls[0][0]).toBe('t1');
    expect(showNotice).toHaveBeenCalledWith('Le ciel de Lucie Martin est ouvert.');
  });

  it('lets go of the file when the confirmation is declined', async () => {
    pickFile.mockResolvedValue(new File(['x'], 'Lucie.myastrosky'));
    backend.sharedSkies.inspect.mockResolvedValue({ ticket: 't1', preview: preview() });
    confirm.mockResolvedValue(false);
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Ouvrir un ciel partagé…').trigger('click');
    await flushPromises();
    expect(backend.sharedSkies.open).not.toHaveBeenCalled();
    expect(backend.sharedSkies.discard).toHaveBeenCalledWith('t1');
  });

  it('does nothing when the picker is closed without a choice', async () => {
    pickFile.mockResolvedValue(null);
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Ouvrir un ciel partagé…').trigger('click');
    await flushPromises();
    expect(backend.sharedSkies.inspect).not.toHaveBeenCalled();
  });

  it('shows the progress with a cancel while the photos are kept, the buttons greyed out', async () => {
    pickFile.mockResolvedValue(new File(['x'], 'Lucie.myastrosky'));
    backend.sharedSkies.inspect.mockResolvedValue({ ticket: 't1', preview: preview() });
    confirm.mockResolvedValue(true);
    let progress: (f: number) => void = () => {};
    let signal: AbortSignal | undefined;
    backend.sharedSkies.open.mockImplementation(
      (_t: string, o: { onProgress: (f: number) => void; cancel: AbortSignal }) => {
        progress = o.onProgress;
        signal = o.cancel;
        return new Promise((_, reject) =>
          o.cancel.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        );
      },
    );
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Ouvrir un ciel partagé…').trigger('click');
    await flushPromises();
    progress(0.45);
    await flushPromises();
    expect(w.text()).toContain('Import des photos… 45 %');
    expect(button(w, 'Partager mon ciel…').attributes('disabled')).toBeDefined();
    await button(w, 'Annuler').trigger('click');
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    expect(w.text()).not.toContain('Import des photos');
    expect(showError).not.toHaveBeenCalled();
  });

  it('shows the red toast when the file cannot be read', async () => {
    pickFile.mockResolvedValue(new File(['x'], 'broken.zip'));
    backend.sharedSkies.inspect.mockRejectedValue(new Error('Fichier illisible'));
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    await button(w, 'Ouvrir un ciel partagé…').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deletes a visited sky only after the confirmation', async () => {
    backend.sharedSkies.remove.mockResolvedValue({ bytesFreed: 1_000_000 });
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    const trash = w.find('[aria-label="Supprimer Marie Dupont"]');
    await trash.trigger('click');
    await flushPromises();
    expect(backend.sharedSkies.remove).not.toHaveBeenCalled();
    await trash.trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[1][0]).toMatchObject({
      title: 'Supprimer ce ciel visité ?',
      destructive: true,
    });
    expect(backend.sharedSkies.remove).toHaveBeenCalledWith('s1');
    expect(showNotice).toHaveBeenCalledWith(`Ciel supprimé, ${formatBytes(1_000_000)} libérés.`);
  });

  it('lists a visited sky under its sender name, which cannot be changed here', async () => {
    const { w } = await mountPage(SharedSkiesPage, '/settings/shared-skies');
    expect(w.text()).toContain('Marie Dupont');
    expect(w.find('[aria-label="Renommer Marie Dupont"]').exists()).toBe(false);
    expect(w.find('input').exists()).toBe(false);
  });
});

describe('"Partager mon ciel"', () => {
  it('offers the photos on the map, all ticked, the remembered name, and gear ticked', async () => {
    const { w } = await mountPage(ShareSkyPage, '/settings/shared-skies/share');
    expect(w.find('h1').text()).toBe('Partager mon ciel');
    expect((w.find('input').element as HTMLInputElement).value).toBe('Observatoire du jardin');
    expect(w.text()).toContain('2 / 2');
    expect(w.text()).toContain(`Taille estimée : ${formatBytes(10_000_000)}`);
    expect(w.text()).toContain('Toute personne qui reçoit ce fichier peut voir ces photos.');
    const gear = w
      .findAll('[role="checkbox"]')
      .find((b) => b.text().includes('Inclure le matériel'));
    expect(gear?.attributes('aria-checked')).toBe('true');
  });

  it('writes the file with the name, the gear choice and the ticked photos, then goes back', async () => {
    backend.sharedSkies.exportToUser.mockResolvedValue(undefined);
    const { w, router } = await mountPage(ShareSkyPage, '/settings/shared-skies/share');
    const back = vi.spyOn(router, 'back');
    await button(w, 'Créer le fichier').trigger('click');
    await flushPromises();
    const request = backend.sharedSkies.exportToUser.mock.calls[0][0];
    expect(request.senderName).toBe('Observatoire du jardin');
    expect(request.includeGear).toBe(true);
    expect([...request.ids].sort()).toEqual(['p1', 'p2']);
    expect(showNotice).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  it('greys out "Créer le fichier" without a name', async () => {
    const { w } = await mountPage(ShareSkyPage, '/settings/shared-skies/share');
    await w.find('input').setValue('   ');
    await flushPromises();
    expect(button(w, 'Créer le fichier').attributes('disabled')).toBeDefined();
  });

  it('shows the red toast when the file cannot be written', async () => {
    backend.sharedSkies.exportToUser.mockRejectedValue(new Error('Plus de place'));
    const { w } = await mountPage(ShareSkyPage, '/settings/shared-skies/share');
    await button(w, 'Créer le fichier').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });
});

describe('the confirmation of a shared sky', () => {
  it('says whose sky it is, and for an update how many photos, with the free space when known', () => {
    const first = sharedSkyPreviewLines(preview())[0];
    expect(first).toMatch(/^Ciel de Lucie Martin, partagé le .* : 18 photo\(s\), /);
    expect(first.endsWith(`${formatBytes(254_700_000)}.`)).toBe(true);
    const update = sharedSkyPreviewLines(
      preview({
        status: 'update',
        senderName: 'Marie Dupont',
        freeBytes: 18_600_000_000,
        existing: { senderName: 'Marie Dupont', sharedAt: '2026-11-02T10:00:00Z' },
      } as never),
    );
    expect(update[0]).toContain('Mettre à jour le ciel de Marie Dupont ?');
    expect(update[1]).toBe(`18 photo(s), ${formatBytes(254_700_000)}`);
    expect(update[2]).toBe(`Espace libre : ${formatBytes(18_600_000_000)}`);
  });
});

describe('"Ciels affichés"', () => {
  it('is hidden before a sky is visited', async () => {
    backend.sharedSkies.list.mockResolvedValue([]);
    await useSharedSkiesStore().load();
    const w = mount(SkyViewField, { global: { stubs: ionicStubs } });
    expect(w.text()).toBe('');
  });

  it('counts the skies ticked, and ticks them in a sheet like the Catalogues', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    const w = mount(SkyViewField, { global: { stubs: ionicStubs } });
    expect(w.find('.mob-section-header').text()).toBe('Ciels affichés');
    expect(w.find('.mob-btn-key').text()).toBe('Ciels');
    expect(w.find('.mob-btn-value').text()).toBe('1 / 3');
    const sheet = w.findComponent(SkyCheckSheet);
    expect(sheet.props('title')).toBe('Ciels affichés');
    expect(sheet.props('options')).toEqual([
      { value: MY_SKY, label: 'Mon ciel' },
      { value: 's1', label: 'Marie Dupont' },
      { value: 's2', label: 'Club astro des Vosges' },
    ]);
    expect(sheet.props('selected')).toEqual([MY_SKY]);
    sheet.vm.$emit('update:selected', [MY_SKY, 's1', 's2']);
    await flushPromises();
    expect(store.shown).toEqual([MY_SKY, 's1', 's2']);
    expect(backend.sharedSkies.listPhotos).toHaveBeenCalledWith('s1');
    expect(backend.sharedSkies.listPhotos).toHaveBeenCalledWith('s2');
    expect(w.find('.mob-btn-value').text()).toBe('3 / 3');
    // Every sky unticked: no photo at all.
    sheet.vm.$emit('update:selected', []);
    await flushPromises();
    expect([store.shown, store.ownShown]).toEqual([[], false]);
    expect(w.find('.mob-btn-value').text()).toBe('0 / 3');
  });
});

describe("a visited sky's photo", () => {
  it('lists its author first, on a line of its own, then the gear as the sender named it', () => {
    const facts = photoFacts({
      id: 'v1',
      originalName: 'NGC7000_Marie.jpg',
      sharedSkyId: 's1',
      author: 'Marie Dupont',
      sharedGear: { setup: 'Lunette 80 mm', telescope: 'Askar FRA400', camera: 'ZWO ASI533MC' },
      correspondences: [],
    } as unknown as Photo);
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ['Auteur', 'Marie Dupont'],
      ['Équipement', 'Lunette 80 mm'],
      ['Télescope', 'Askar FRA400'],
      ['Caméra', 'ZWO ASI533MC'],
    ]);
    expect(facts[0].line).toBe(true);
    expect(facts.filter((f) => f.line)).toHaveLength(1);
    expect(facts[1].stop).toBe(true);
  });
});
