import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { setBackend } from '@myastrosky/app-state/backend';
import { ionicStubs } from './helpers';

const showError = vi.fn();
const confirm = vi.fn();
const showInfo = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: (...a: unknown[]) => showInfo(...a),
}));
vi.mock('../src/catalogs', () => ({ catalogsReady: () => Promise.resolve() }));
const getCurrentPosition = vi.fn();
const pickFile = vi.fn();
vi.mock('../src/platform-device', () => ({
  getCurrentPosition: () => getCurrentPosition(),
  pickFile: (...a: unknown[]) => pickFile(...a),
  HORIZON_FILE_TYPES: {},
  BACKUP_FILE_TYPES: {},
}));

import SettingsPage from '../src/pages/SettingsPage.vue';
import SetupsPage from '../src/pages/SetupsPage.vue';
import SetupEditPage from '../src/pages/SetupEditPage.vue';
import LocationPage from '../src/pages/LocationPage.vue';
import BackupPage from '../src/pages/BackupPage.vue';

const GEAR = {
  telescope: [
    {
      id: 't1',
      brand: 'Askar',
      model: 'FRA400',
      aperture_mm: 72,
      focal_length_mm: 400,
      f_ratio: 5.6,
      is_smart_telescope: false,
      integrated_camera_id: null,
    },
    {
      id: 't2',
      brand: 'ZWO',
      model: 'Seestar S50',
      aperture_mm: 50,
      focal_length_mm: 250,
      f_ratio: 5,
      is_smart_telescope: true,
      integrated_camera_id: 'c2',
    },
  ],
  camera: [
    {
      id: 'c1',
      brand: 'ZWO',
      model: 'ASI533MC',
      sensor_width_mm: 11.3,
      sensor_height_mm: 11.3,
      pixel_size_um: 3.76,
      resolution_x: 3008,
      resolution_y: 3008,
      color_type: 'OSC',
    },
    {
      id: 'c2',
      brand: 'ZWO',
      model: 'Seestar Sensor',
      sensor_width_mm: 5.6,
      sensor_height_mm: 3.2,
      pixel_size_um: 2.9,
      resolution_x: 1920,
      resolution_y: 1080,
      color_type: 'OSC',
    },
  ],
  accessory: [{ id: 'a1', brand: 'Celestron', model: 'Reducer', magnification_factor: 0.7 }],
  filter: [],
} as const;

const setups = [
  {
    id: 's1',
    name: 'Équipement 1',
    telescopeId: 't1',
    cameraId: 'c1',
    accessoryId: null,
    enabled: true,
  },
  {
    id: 's2',
    name: 'Seestar',
    telescopeId: 't2',
    cameraId: 'c2',
    accessoryId: null,
    enabled: true,
  },
];

const backend = {
  gear: {
    listSetups: vi.fn(),
    createSetup: vi.fn(),
    replaceSetup: vi.fn(),
    removeSetup: vi.fn(),
    listCatalog: vi.fn(),
  },
  plans: { list: vi.fn() },
  settings: { readPublic: vi.fn() },
  photos: { listWithSizes: vi.fn() },
  backup: { exportToUser: vi.fn(), preview: vi.fn(), restore: vi.fn() },
  horizon: { getProfile: vi.fn() },
  dsoOverrides: { getAll: vi.fn() },
};

function app() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/setups/:id', component: { template: '<div />' } },
      { path: '/:p(.*)*', component: { template: '<div />' } },
    ],
  });
  return { router, global: { stubs: ionicStubs, plugins: [router, createPinia()] } };
}

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  configureGearCatalogLoader(async (type) => [...GEAR[type]] as object[]);
  vi.clearAllMocks();
  backend.gear.listSetups.mockResolvedValue(setups);
  backend.plans.list.mockResolvedValue([]);
  backend.settings.readPublic.mockResolvedValue({ apiKeySet: true });
  backend.photos.listWithSizes.mockResolvedValue([]);
  backend.dsoOverrides.getAll.mockResolvedValue({});
  setBackend(backend as never);
});

describe('the Réglages page', () => {
  it('shows the board rows with their real values, and disables the ones without a screen yet', async () => {
    storage().set('targets-prefs-v3', JSON.stringify({ setupId: null, lat: 48.58, lon: 7.75 }));
    const { global } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    const text = w.text();
    expect(text).toContain('Setups');
    expect(w.findAll('.mob-row')[0].text()).toContain('2');
    expect(text).toContain('48.58, 7.75');
    expect(text).toContain('✓ Configurée');
    expect(text).toContain('Froid moderne');
    const rows = w.findAll('.mob-row');
    const disabled = rows
      .filter((r) => r.classes().includes('mob-row--disabled'))
      .map((r) => r.text());
    expect(disabled.some((t) => t.includes('Thème'))).toBe(true);
    expect(disabled.some((t) => t.includes('Setups'))).toBe(false);
  });

  it('opens the setups page from its row', async () => {
    const { global, router } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    await w.findAll('.mob-row')[0].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/setups');
  });
});

describe('the setups page', () => {
  it('lists each setup with its gear and field of view', async () => {
    const { global } = app();
    const w = mount(SetupsPage, { global });
    await flushPromises();
    const rows = w.findAll('.mob-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Équipement 1');
    expect(rows[0].text()).toContain('Askar FRA400 + ZWO ASI533MC');
    expect(rows[0].text()).toContain('Focale effective : 400 mm · FOV');
  });

  it('shows no row and no error when there is no setup', async () => {
    backend.gear.listSetups.mockResolvedValue([]);
    const { global } = app();
    const w = mount(SetupsPage, { global });
    await flushPromises();
    expect(w.findAll('.mob-row')).toHaveLength(0);
    expect(showError).not.toHaveBeenCalled();
  });

  it('shows the error toast when the setups cannot be read', async () => {
    backend.gear.listSetups.mockRejectedValue(new Error('boom'));
    const { global } = app();
    mount(SetupsPage, { global });
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });
});

describe('the setup editor', () => {
  async function open(id: string) {
    const a = app();
    await a.router.push('/settings/setups');
    await a.router.push(`/settings/setups/${id}`);
    const w = mount(SetupEditPage, { global: a.global });
    await flushPromises();
    return { w, router: a.router };
  }

  it('shows the setup, its facts and the plans that use it, and disables the delete row', async () => {
    backend.plans.list.mockResolvedValue([
      { id: 'p1', name: 'Nuit du 2026-10-03', setupId: 's1', entries: [], mosaics: [] },
    ]);
    const { w } = await open('s1');
    expect((w.find('input').element as HTMLInputElement).value).toBe('Équipement 1');
    expect(w.text()).toContain('Askar FRA400');
    expect(w.text()).toContain('Focale effective');
    expect(w.text()).toContain('Utilisé par ces plans :');
    expect(w.text()).toContain('Nuit du 2026-10-03');
    const del = w.findAll('.mob-row').find((r) => r.text().includes('Supprimer le setup'))!;
    expect(del.classes()).toContain('mob-row--disabled');
    expect(del.text()).toContain('ne peut pas être supprimé');
  });

  it('asks for confirmation before deleting, and deletes only after a yes', async () => {
    const { w, router } = await open('s1');
    const del = () => w.findAll('.mob-row').find((r) => r.text().includes('Supprimer le setup'))!;
    confirm.mockResolvedValueOnce(false);
    await del().trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(backend.gear.removeSetup).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await del().trigger('click');
    await flushPromises();
    expect(backend.gear.removeSetup).toHaveBeenCalledWith('s1');
    await vi.waitFor(() => expect(router.currentRoute.value.path).not.toBe('/settings/setups/s1'));
  });

  it('saves the edited name, and shows the toast when saving fails', async () => {
    const { w } = await open('s1');
    await w.find('input').setValue('Autre nom');
    const save = w.findAll('button').find((b) => b.text() === 'Enregistrer')!;
    await save.trigger('click');
    await flushPromises();
    expect(backend.gear.replaceSetup).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ name: 'Autre nom', telescopeId: 't1', cameraId: 'c1' }),
    );
    backend.gear.replaceSetup.mockRejectedValueOnce(new Error('boom'));
    await w
      .findAll('button')
      .find((b) => b.text() === 'Enregistrer')!
      .trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });

  it('adds a setup with the first gear, and cannot save without a name', async () => {
    const { w } = await open('new');
    const save = () => w.findAll('button').find((b) => b.text() === 'Enregistrer')!;
    expect(save().attributes('disabled')).toBeDefined();
    expect(w.text()).not.toContain('Supprimer le setup');
    await w.find('input').setValue('Nouveau');
    expect(save().attributes('disabled')).toBeUndefined();
    await save().trigger('click');
    await flushPromises();
    expect(backend.gear.createSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nouveau',
        telescopeId: 't1',
        cameraId: 'c1',
        enabled: true,
      }),
    );
  });

  it('locks the camera of a smart telescope', async () => {
    const { w } = await open('s2');
    const cameraField = w
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Caméra'))!;
    expect(cameraField.attributes('disabled')).toBeDefined();
    expect(cameraField.attributes('aria-label')).toContain('Seestar Sensor');
  });
});

describe('the location page', () => {
  it('stores a typed position under the desktop keys, and rolls back an out-of-range one', async () => {
    const { global } = app();
    const w = mount(LocationPage, { global });
    const [lat, lon] = w.findAll('input');
    await lat.setValue('48.58');
    await lon.setValue('7.75');
    await lon.trigger('change');
    // The stub input has no ionChange: commit through the field's own event.
    (
      w.findAllComponents({ name: 'PhoneField' })[1].vm as unknown as { $emit: (e: string) => void }
    ).$emit('commit');
    expect(JSON.parse(storage().get('targets-prefs-v3')!)).toMatchObject({ lat: 48.58, lon: 7.75 });
    await lat.setValue('95');
    (
      w.findAllComponents({ name: 'PhoneField' })[0].vm as unknown as { $emit: (e: string) => void }
    ).$emit('commit');
    await flushPromises();
    expect((lat.element as HTMLInputElement).value).toBe('48.58');
  });

  it('uses the device position, rounded to 2 decimals, and turns the button red when refused', async () => {
    const { global } = app();
    const w = mount(LocationPage, { global });
    const button = () =>
      w
        .findAll('button')
        .find(
          (b) =>
            b.text().includes('Utiliser ma position') || b.text().includes("Impossible d'obtenir"),
        )!;
    getCurrentPosition.mockResolvedValueOnce({ latitude: 48.5849, longitude: 7.7512 });
    await button().trigger('click');
    await flushPromises();
    expect(JSON.parse(storage().get('targets-prefs-v3')!)).toMatchObject({ lat: 48.58, lon: 7.75 });
    getCurrentPosition.mockRejectedValueOnce(new Error('denied'));
    await button().trigger('click');
    await flushPromises();
    expect(button().text()).toBe("Impossible d'obtenir la position");
    expect(button().classes()).toContain('mob-btn--danger');
  });

  it('shows the red toast when the horizon cannot be computed', async () => {
    storage().set('targets-prefs-v3', JSON.stringify({ setupId: null, lat: 48.58, lon: 7.75 }));
    backend.horizon.getProfile.mockRejectedValue(new Error('x'));
    const { global } = app();
    const w = mount(LocationPage, { global });
    await w
      .findAll('button')
      .find((b) => b.text() === "Calculer l'horizon")!
      .trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });

  it('has the DMS button waiting for its board, disabled', () => {
    const { global } = app();
    const w = mount(LocationPage, { global });
    expect(
      w
        .findAll('button')
        .find((b) => b.text().startsWith('DMS'))!
        .attributes('disabled'),
    ).toBeDefined();
  });
});

describe('the backup page', () => {
  it('exports with the ticked contents', async () => {
    backend.photos.listWithSizes.mockResolvedValue([{ id: 'p1', fileSize: 1000 }]);
    const { global } = app();
    const w = mount(BackupPage, { global });
    await flushPromises();
    expect(w.text()).toContain('Taille estimée');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Créer une sauvegarde')!
      .trigger('click');
    await flushPromises();
    expect(backend.backup.exportToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          includeSetups: true,
          includePlans: true,
          includeImages: true,
          includeDsoOverrides: false,
        }),
        ids: ['p1'],
      }),
    );
  });

  it('previews a file, restores what is ticked (replacing a different setup) and reports the result', async () => {
    backend.backup.preview.mockResolvedValue({
      hasMetadata: false,
      photos: 0,
      hasDsoOverrides: false,
      hasCustomGear: false,
      hasSetups: true,
      hasPoiCategories: false,
      hasSkyRegions: false,
      hasPlans: false,
      hasShortcuts: false,
      images: [],
      plans: [],
      setups: [{ id: 'sB', name: 'B', exists: true, conflict: 'different' }],
      gear: [],
    });
    backend.backup.restore.mockResolvedValue({ imported: 1, skipped: 0 });
    pickFile.mockResolvedValue(new File(['x'], 'sauvegarde.zip'));
    const { global } = app();
    const w = mount(BackupPage, { global });
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Choisir un fichier')!
      .trigger('click');
    await flushPromises();
    expect(w.text()).toContain('sauvegarde.zip');
    expect(w.text()).toContain('Setups (1)');
    expect(w.text()).toContain('sera remplacé');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Restaurer une sauvegarde')!
      .trigger('click');
    await flushPromises();
    expect(backend.backup.restore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selectedSetups: ['sB'], setupConflicts: { sB: 'replace' } }),
    );
    expect(showInfo).toHaveBeenCalled();
  });

  it('shows the toast when the file cannot be read', async () => {
    backend.backup.preview.mockRejectedValue(new Error('bad'));
    pickFile.mockResolvedValue(new File(['x'], 'x.zip'));
    const { global } = app();
    const w = mount(BackupPage, { global });
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Choisir un fichier')!
      .trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
  });
});
