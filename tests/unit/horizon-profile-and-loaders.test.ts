import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { HORIZON_SETTINGS_KEY } from '@myastrosky/core/horizon-settings';
import { setBackend } from '@myastrosky/app-state/backend';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';

const setDsoCatalog = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  setDsoCatalog: (...a: unknown[]) => setDsoCatalog(...a),
}));

import { loadDsoCatalogData } from '@myastrosky/app-state/catalog-loaders';

const profile = { az: [0], alt: [1] } as never;

describe('the shared horizon store', () => {
  const getProfile = vi.fn();
  beforeEach(() => {
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
    getProfile.mockReset();
    setBackend({ horizon: { getProfile } } as never);
  });

  it('computes for a location, shows the profile and stores it', async () => {
    getProfile.mockResolvedValue(profile);
    const store = useHorizonProfileStore();
    store.setObsHeight(1.7);
    expect(await store.computeFor(48.58, 7.75)).toBe(true);
    expect(getProfile).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 48.58, lon: 7.75, obsHeightM: 1.7 }),
    );
    expect(store.enabled).toBe(true);
    expect(JSON.parse(storage().get(HORIZON_SETTINGS_KEY)!)).toMatchObject({
      enabled: true,
      obsHeightM: 1.7,
    });
  });

  it('keeps an error and applies nothing when the computation fails or there is no location', async () => {
    getProfile.mockRejectedValue(new Error('boom'));
    const store = useHorizonProfileStore();
    expect(await store.computeFor(1, 2)).toBe(false);
    expect(store.error).toBeTruthy();
    expect(store.profile).toBeNull();
    expect(await store.computeFor(null, null)).toBe(false);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('imports a file, then clears it', () => {
    const store = useHorizonProfileStore();
    expect(store.importFromText('0 5\n90 10\n180 5\n270 8', 48, 7)).toBe(true);
    expect(store.profile).not.toBeNull();
    store.clear();
    expect(store.profile).toBeNull();
    expect(store.enabled).toBe(false);
    expect(store.importFromText('not a horizon', 48, 7)).toBe(false);
    expect(store.error).toBeTruthy();
  });
});

describe('the shared deep-sky loader', () => {
  beforeEach(() => {
    setDsoCatalog.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the file with the overrides', async () => {
    await loadDsoCatalogData({ lang: 'fr', getOverrides: async () => ({ M1: {} }) });
    expect(setDsoCatalog).toHaveBeenCalledWith({ data: [] }, { M1: {} }, 'fr');
  });

  it('loads without the overrides when they cannot be read', async () => {
    await loadDsoCatalogData({
      lang: 'en',
      getOverrides: async () => {
        throw new Error('x');
      },
    });
    expect(setDsoCatalog).toHaveBeenCalledWith({ data: [] }, {}, 'en');
  });
});
