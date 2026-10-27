import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Component } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { setBackend } from '@myastrosky/app-state/backend';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
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
import AstrometryKeyPage from '../src/pages/AstrometryKeyPage.vue';
import AboutPage from '../src/pages/AboutPage.vue';
import PrivacyPage from '../src/pages/PrivacyPage.vue';
import DataCreditsPage from '../src/pages/DataCreditsPage.vue';
import PhoneRadioSheet from '../src/components/PhoneRadioSheet.vue';
import { applySavedTheme } from '../src/app-theme';

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
  settings: { readPublic: vi.fn(), update: vi.fn(), removeApiKey: vi.fn() },
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
  applySavedTheme();
  setActivePinia(createPinia());
  configureGearCatalogLoader(async (type) => [...GEAR[type]] as object[]);
  vi.clearAllMocks();
  backend.gear.listSetups.mockResolvedValue(setups);
  backend.plans.list.mockResolvedValue([]);
  backend.settings.readPublic.mockResolvedValue({ apiKeySet: true });
  backend.settings.update.mockResolvedValue({ apiKeyChanged: true });
  backend.settings.removeApiKey.mockResolvedValue(undefined);
  backend.photos.listWithSizes.mockResolvedValue([]);
  backend.dsoOverrides.getAll.mockResolvedValue({});
  setBackend(backend as never);
});

describe('the astrometry.net key page', () => {
  const field = (w: ReturnType<typeof mount>) => w.find('input[type=password]');
  const button = (w: ReturnType<typeof mount>, text: string) =>
    w.findAll('button').find((b) => b.text() === text)!;

  it('never shows a stored key: dots as the placeholder and the line saying one is configured', async () => {
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Clé astrometry.net');
    expect((field(w).element as HTMLInputElement).value).toBe('');
    expect(field(w).attributes('placeholder')).toBe('••••••••');
    expect(w.text()).toContain('Clé configurée — saisissez une nouvelle clé pour la remplacer');
    expect(button(w, 'Enregistrer').attributes('disabled')).toBeDefined();
    expect(button(w, 'Supprimer la clé API').attributes('disabled')).toBeUndefined();
  });

  it('without a key shows the invitation to type one, no line, and nothing to delete', async () => {
    backend.settings.readPublic.mockResolvedValue({ apiKeySet: false });
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    expect(field(w).attributes('placeholder')).toBe('Saisir la clé API…');
    expect(w.text()).not.toContain('Clé configurée');
    expect(button(w, 'Supprimer la clé API').attributes('disabled')).toBeDefined();
  });

  it('with a key that can no longer be read asks to enter it again and lets it be deleted', async () => {
    backend.settings.readPublic.mockResolvedValue({ apiKeySet: false, apiKeyUnreadable: true });
    confirm.mockResolvedValue(true);
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    expect(field(w).attributes('placeholder')).toBe('Saisir la clé API…');
    expect(w.text()).toContain(
      'La clé astrometry.net enregistrée ne peut plus être lue. Saisissez-la à nouveau pour résoudre vos photos en ligne.',
    );
    await button(w, 'Supprimer la clé API').trigger('click');
    await flushPromises();
    expect(backend.settings.removeApiKey).toHaveBeenCalled();
    expect(w.text()).not.toContain('ne peut plus être lue');
  });

  it('stores only the typed key, trimmed, then goes back to Réglages', async () => {
    const { global, router } = app();
    const w = mount(AstrometryKeyPage, { global });
    await flushPromises();
    await field(w).setValue('  abcdef123  ');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(backend.settings.update).toHaveBeenCalledWith({ apiKey: 'abcdef123' });
    expect(router.currentRoute.value.path).toBe('/tabs/settings');
  });

  it('shows the toast and stays when the key cannot be stored', async () => {
    backend.settings.update.mockRejectedValue(new Error('boom'));
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    await field(w).setValue('abc');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect((field(w).element as HTMLInputElement).value).toBe('abc');
  });

  it('asks before deleting the key, and deletes it only after a yes', async () => {
    confirm.mockResolvedValueOnce(false);
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    await button(w, 'Supprimer la clé API').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: 'Supprimer la clé API',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    expect(backend.settings.removeApiKey).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await button(w, 'Supprimer la clé API').trigger('click');
    await flushPromises();
    expect(backend.settings.removeApiKey).toHaveBeenCalledTimes(1);
    expect(w.text()).not.toContain('Clé configurée');
  });

  it('opens the explanation as plain paragraphs behind the "i"', async () => {
    const w = mount(AstrometryKeyPage, { global: app().global });
    await flushPromises();
    await w.find('button[aria-label="Informations : Clé API astrometry.net"]').trigger('click');
    const [title, message] = showInfo.mock.calls[0];
    expect(title).toBe('Clé API astrometry.net');
    expect(message).not.toContain('<br');
    expect(message).toContain('nova.astrometry.net');
  });
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
    expect(text).toContain('Froid moderne (défaut)');
    const rows = w.findAll('.mob-row');
    const disabled = rows
      .filter((r) => r.classes().includes('mob-row--inert'))
      .map((r) => r.text());
    expect(disabled.some((t) => t.includes('Thème'))).toBe(false);
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

  it('opens the about page from its row', async () => {
    const { global, router } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    const about = w.findAll('.mob-row').find((r) => r.text().includes('À propos'));
    expect(about?.classes()).not.toContain('mob-row--inert');
    await about!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/about');
  });

  it('opens the privacy page from its row', async () => {
    const { global, router } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    const privacy = w.findAll('.mob-row').find((r) => r.text().includes('Confidentialité'));
    expect(privacy?.classes()).not.toContain('mob-row--inert');
    await privacy!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/privacy');
  });

  it('opens the data credits page from its row, under the privacy row', async () => {
    const { global, router } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    const titles = w.findAll('.mob-row').map((r) => r.text());
    const credits = titles.findIndex((t) => t.includes('Crédits des données'));
    expect(credits).toBe(titles.findIndex((t) => t.includes('Confidentialité')) + 1);
    const row = w.findAll('.mob-row')[credits];
    expect(row.classes()).not.toContain('mob-row--inert');
    await row.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/credits');
  });
});

describe('the theme', () => {
  const themeRow = (w: ReturnType<typeof mount>) =>
    w.findAll('.mob-row').find((r) => r.text().includes('Thème'))!;
  const themeSheet = (w: ReturnType<typeof mount>) => w.findComponent(PhoneRadioSheet as Component);
  const sheetProps = (w: ReturnType<typeof mount>) =>
    themeSheet(w).props() as {
      open: boolean;
      title: string;
      value: string;
      options: { value: string; label: string }[];
    };

  it('shows the current theme in its row and opens the choice of the three themes', async () => {
    const { global } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    expect(themeRow(w).text()).toContain('Froid moderne (défaut)');
    expect(sheetProps(w).open).toBe(false);
    await themeRow(w).trigger('click');
    expect(sheetProps(w).open).toBe(true);
    expect(sheetProps(w).title).toBe('Thème');
    expect(sheetProps(w).value).toBe('cold-blue-v2');
    expect(sheetProps(w).options).toEqual([
      { value: 'cold-blue-v2', label: 'Froid moderne (défaut)' },
      { value: 'warm', label: 'Chaud' },
      { value: 'cold-blue', label: 'Froid classique' },
    ]);
  });

  it('applies a chosen theme at once, saves it, closes the sheet and shows its name', async () => {
    const changed = vi.fn();
    window.addEventListener('app-theme-changed', changed);
    const { global } = app();
    const w = mount(SettingsPage, { global });
    await flushPromises();
    await themeRow(w).trigger('click');
    themeSheet(w).vm.$emit('update:value', 'warm');
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe('warm');
    expect(storage().get('app-theme')).toBe('warm');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(sheetProps(w).open).toBe(false);
    expect(themeRow(w).text()).toContain('Chaud');
    window.removeEventListener('app-theme-changed', changed);
  });

  it('applies the saved theme at start-up', () => {
    storage().set('app-theme', 'cold-blue');
    applySavedTheme();
    expect(document.documentElement.dataset.theme).toBe('cold-blue');
  });

  it('falls back to the default theme when the saved value is unknown', () => {
    storage().set('app-theme', 'night-red');
    applySavedTheme();
    expect(document.documentElement.dataset.theme).toBe('cold-blue-v2');
  });
});

describe('the about page', () => {
  it("shows the desktop's figures, the author's email as a mail link, the description and the features", async () => {
    vi.stubGlobal('__APP_VERSION__', '0.12.0');
    vi.stubGlobal('__APP_BUILD_TIMESTAMP__', '2026-10-27T09:12:33.412Z');
    vi.stubGlobal('__APP_AUTHOR_NAME__', 'Ada Lovelace');
    vi.stubGlobal('__APP_AUTHOR_EMAIL__', 'ada@example.org');
    vi.stubGlobal('__APP_LICENSE__', 'MIT');
    try {
      const { global } = app();
      const w = mount(AboutPage, { global });
      await flushPromises();
      expect(w.find('h1').text()).toBe('À propos de MyAstroSky');
      const facts = w.findAll('.mob-fact').map((f) => f.text());
      expect(facts).toEqual([
        'Version0.12.0',
        'Build2026-10-27T09:12:33.412Z',
        'AuteurAda Lovelaceada@example.org',
        'LicenceMIT',
      ]);
      const link = w.find('a.mob-link');
      expect(link.attributes('href')).toBe('mailto:ada@example.org');
      expect(link.text()).toBe('ada@example.org');
      expect(w.find('.mob-text').text()).toContain('carte du ciel interactive');
      const features = w.findAll('.mob-bullets li').map((li) => li.text());
      expect(features).toHaveLength(6);
      expect(features[0]).toBe('Projection stéréographique');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows no mail link when the build carries no email', async () => {
    const { global } = app();
    const w = mount(AboutPage, { global });
    await flushPromises();
    expect(w.find('a.mob-link').exists()).toBe(false);
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

  it('asks before clearing the horizon, and clears it only after a yes', async () => {
    const { global } = app();
    const w = mount(LocationPage, { global });
    const horizon = useHorizonProfileStore(global.plugins[1] as never);
    horizon.applyProfile({ azimuths: [0], altitudes: [3] } as never, true);
    const clearButton = () => w.findAll('button').find((b) => b.text() === "Effacer l'horizon")!;
    confirm.mockResolvedValueOnce(false);
    await clearButton().trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Effacer l'horizon ?", destructive: true }),
    );
    expect(horizon.profile).not.toBeNull();
    confirm.mockResolvedValueOnce(true);
    await clearButton().trigger('click');
    await flushPromises();
    expect(horizon.profile).toBeNull();
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
    expect(showError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Impossible de calculer l'horizon à partir des données d'altitude",
      }),
    );
  });

  it('has the DMS button waiting for its board, not dimmed', () => {
    const { global } = app();
    const w = mount(LocationPage, { global });
    expect(
      w
        .findAll('button')
        .find((b) => b.text().startsWith('DMS'))!
        .attributes('aria-disabled'),
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

  const previewWithDifferentSetup = () => ({
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
    setups: [{ id: 'sB', name: 'B', exists: true, conflict: 'different' as const }],
    gear: [],
  });

  async function openPreview() {
    backend.backup.preview.mockResolvedValue(previewWithDifferentSetup());
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
    return w;
  }
  const restoreButton = (w: Awaited<ReturnType<typeof openPreview>>) =>
    w.findAll('button').find((b) => b.text() === 'Restaurer une sauvegarde')!;
  const radios = (w: Awaited<ReturnType<typeof openPreview>>) => w.findAll('[role="radio"]');

  it('previews a file and offers the three choices for a different setup, none chosen at first', async () => {
    const w = await openPreview();
    expect(w.text()).toContain('sauvegarde.zip');
    expect(w.text()).toContain('Setups (1)');
    expect(w.text()).toContain('sera remplacé');
    expect(radios(w).map((r) => r.text())).toEqual([
      'Remplacer',
      'Garder les deux',
      'Ne pas importer',
    ]);
    expect(radios(w).every((r) => r.attributes('aria-checked') === 'false')).toBe(true);
    expect(restoreButton(w).attributes('disabled')).toBeDefined();
  });

  it.each([
    ['Remplacer', 'replace'],
    ['Garder les deux', 'keepBoth'],
  ])('sends the choice "%s" to the import call and reports the result', async (label, value) => {
    const w = await openPreview();
    await radios(w)
      .find((r) => r.text() === label)!
      .trigger('click');
    expect(w.text()).not.toContain('sera remplacé');
    expect(restoreButton(w).attributes('disabled')).toBeUndefined();
    await restoreButton(w).trigger('click');
    await flushPromises();
    expect(backend.backup.restore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selectedSetups: ['sB'], setupConflicts: { sB: value } }),
    );
    expect(showInfo).toHaveBeenCalled();
  });

  it('treats "Ne pas importer" as unticking the setup: nothing is sent for it', async () => {
    const w = await openPreview();
    await radios(w)
      .find((r) => r.text() === 'Ne pas importer')!
      .trigger('click');
    expect(radios(w)).toHaveLength(0);
    expect(restoreButton(w).attributes('disabled')).toBeDefined();
    expect(backend.backup.restore).not.toHaveBeenCalled();
  });

  /** A promise and the function that settles it, to hold an action running. */
  function held<T>() {
    let settle!: (v: T) => void;
    const promise = new Promise<T>((resolve) => (settle = resolve));
    return { promise, settle };
  }
  const button = (w: ReturnType<typeof mount>, label: string) =>
    w.findAll('button').find((b) => b.text() === label)!;
  const isBusy = (b: ReturnType<ReturnType<typeof mount>['find']>) =>
    b.classes().includes('mob-btn--busy') && b.find('.mob-spinner').exists();

  it('shows the spinner on "Créer une sauvegarde" while the backup is built, and only once', async () => {
    backend.photos.listWithSizes.mockResolvedValue([{ id: 'p1', fileSize: 1000 }]);
    const run = held<void>();
    backend.backup.exportToUser.mockReturnValue(run.promise);
    const { global } = app();
    const w = mount(BackupPage, { global });
    await flushPromises();
    await button(w, 'Créer une sauvegarde').trigger('click');
    await flushPromises();
    expect(isBusy(button(w, 'Créer une sauvegarde'))).toBe(true);
    await button(w, 'Créer une sauvegarde').trigger('click');
    expect(backend.backup.exportToUser).toHaveBeenCalledTimes(1);
    run.settle();
    await flushPromises();
    expect(isBusy(button(w, 'Créer une sauvegarde'))).toBe(false);
  });

  it('shows the spinner on "Choisir un fichier" while the chosen file is read', async () => {
    const run = held<ReturnType<typeof previewWithDifferentSetup>>();
    backend.backup.preview.mockReturnValue(run.promise);
    pickFile.mockResolvedValue(new File(['x'], 'sauvegarde.zip'));
    const { global } = app();
    const w = mount(BackupPage, { global });
    await flushPromises();
    await button(w, 'Choisir un fichier').trigger('click');
    await flushPromises();
    expect(isBusy(button(w, 'Choisir un fichier'))).toBe(true);
    run.settle(previewWithDifferentSetup());
    await flushPromises();
    expect(w.find('.mob-btn--busy').exists()).toBe(false);
    expect(w.text()).toContain('sauvegarde.zip');
  });

  it('shows the spinner on "Restaurer une sauvegarde" while restoring', async () => {
    const w = await openPreview();
    const run = held<{ imported: number; skipped: number }>();
    backend.backup.restore.mockReturnValue(run.promise);
    await radios(w)
      .find((r) => r.text() === 'Remplacer')!
      .trigger('click');
    await restoreButton(w).trigger('click');
    await flushPromises();
    expect(isBusy(restoreButton(w))).toBe(true);
    expect(button(w, 'Changer de fichier').attributes('disabled')).toBeDefined();
    run.settle({ imported: 1, skipped: 0 });
    await flushPromises();
    expect(w.find('.mob-btn--busy').exists()).toBe(false);
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

describe('the privacy page', () => {
  it("shows the desktop's texts: local storage, then each feature that goes online", async () => {
    const { global } = app();
    const w = mount(PrivacyPage, { global });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Confidentialité');
    expect(w.findAll('.mob-text-title').map((h) => h.text())).toEqual([
      'Solveur astrometry.net',
      "Calcul de l'horizon",
      'Identification des astéroïdes, comètes et supernovae',
    ]);
    const texts = w.findAll('.mob-text').map((p) => p.text());
    expect(texts).toHaveLength(4);
    expect(texts[0]).toContain('stockées localement sur votre appareil');
    expect(texts[1]).toContain('nova.astrometry.net');
    expect(texts[2]).toContain('seule fonction qui envoie votre position');
    expect(texts[3]).toContain('IMCCE SkyBoT');
  });

  it('leaves out the IP geolocation block: the phone takes its position from the device', async () => {
    const { global } = app();
    const w = mount(PrivacyPage, { global });
    await flushPromises();
    expect(w.text()).not.toContain('ip-api.com');
  });
});

describe('the data credits page', () => {
  it("shows the desktop's sections, the online data with the line saying it is downloaded", async () => {
    const { global } = app();
    const w = mount(DataCreditsPage, { global });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Crédits des données');
    expect(w.findAll('.mob-section-header').map((h) => h.text())).toEqual([
      'Catalogues',
      'Documents de référence',
      'Données en ligne',
    ]);
    expect(w.findAll('.mob-helper').map((p) => p.text())).toEqual([
      "Ces données ne sont pas incluses dans l'application : elles sont téléchargées depuis ces services quand vous calculez l'horizon d'un lieu.",
    ]);
    const names = w.findAll('.mob-credit > .mob-row-title').map((n) => n.text());
    expect(names).toHaveLength(12);
    expect(names).toContain('Stars — d3-celestial');
    expect(names).toContain('Finest NGC Chart/Log System');
    expect(names.slice(-2)).toEqual(['Peak names — OpenStreetMap', 'Elevation — Terrain Tiles']);
  });

  it('opens the links and the licences in the browser, and shows a licence without a page as a plain chip', async () => {
    const { global } = app();
    const w = mount(DataCreditsPage, { global });
    await flushPromises();
    const credit = (name: string) =>
      w.findAll('.mob-credit').find((c) => c.find('.mob-row-title').text() === name)!;

    const osm = credit('Peak names — OpenStreetMap');
    expect(osm.text()).toContain('© OpenStreetMap contributors');
    const [link, licence] = osm.findAll('.mob-credit-links a');
    expect(link.attributes('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(link.text()).toBe('openstreetmap.org/copyright');
    expect(licence.classes()).toContain('mob-badge');
    expect(licence.text()).toBe('ODbL 1.0');
    expect(licence.attributes('href')).toBe('https://opendatacommons.org/licenses/odbl/1-0/');
    for (const a of w.findAll('.mob-credit a')) {
      expect(a.attributes('target')).toBe('_blank');
      expect(a.attributes('rel')).toBe('noopener noreferrer');
    }

    const boundaries = credit('Constellation boundaries');
    expect(boundaries.findAll('a')).toHaveLength(0);
    expect(boundaries.find('span.mob-badge').text()).toBe('Domaine public');

    const largePn = credit('Large PN Observing Atlas');
    expect(largePn.find('span.mob-badge').text()).toBe('Tous droits réservés');
    expect(largePn.text()).toContain('Source des grandes nébuleuses planétaires');

    expect(credit('Elevation — Terrain Tiles').find('.mob-badge').exists()).toBe(false);
  });
});
