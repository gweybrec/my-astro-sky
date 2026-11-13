/**
 * The shared-skies store: the visits kept, which skies are shown (the user's own and any visited ones, ticked), the
 * photos of the skies shown, and the choice remembered between sessions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@myastrosky/app-state/api', () => ({
  getSharedSkies: vi.fn(),
  getSharedSkyPhotos: vi.fn(),
  inspectSharedSky: vi.fn(),
  openSharedSky: vi.fn(),
  discardSharedSky: vi.fn().mockResolvedValue(undefined),
  removeSharedSky: vi.fn(),
  shareMySky: vi.fn().mockResolvedValue(undefined),
}));

import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import {
  getSharedSkies,
  getSharedSkyPhotos,
  openSharedSky,
  removeSharedSky,
} from '@myastrosky/app-state/api';
import type { SharedSky, SharedSkyPhoto } from '@myastrosky/core/domain/shared-sky';
import { configureErrorReporter } from '@myastrosky/core/platform/error-hook';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { MY_SKY } from '@myastrosky/core/shared-sky-view';

const sky = (id: string, over: Partial<SharedSky> = {}): SharedSky => ({
  id,
  senderName: id,
  sharedAt: '2026-03-01T10:00:00.000Z',
  receivedAt: '2026-03-02T10:00:00.000Z',
  photoCount: 1,
  bytes: 10,
  poiCategories: [],
  ...over,
});
const photo = (id: string, skyId: string, over: Partial<SharedSkyPhoto> = {}) =>
  ({ id, sharedSkyId: skyId, pointsOfInterest: [], ...over }) as SharedSkyPhoto;
const ids = (photos: readonly SharedSkyPhoto[]) => photos.map((p) => p.id);

describe('shared-skies store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    configureStorage(createMemoryStore());
    configureErrorReporter(() => undefined);
    vi.mocked(getSharedSkies).mockResolvedValue([sky('paul-sky'), sky('zoe-sky')]);
    vi.mocked(getSharedSkyPhotos).mockImplementation(async (id) => [photo(`${id}-1`, id)]);
  });

  it('shows the user own sky at first, with no visit photo', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    expect(store.skies.map((s) => s.id)).toEqual(['paul-sky', 'zoe-sky']);
    expect([store.shown, store.shownSkies, store.ownShown]).toEqual([[MY_SKY], [], true]);
    expect(store.visitPhotos).toEqual([]);
    expect(getSharedSkyPhotos).not.toHaveBeenCalled();
  });

  it('shows any number of skies, and reads the photos of every visited one ticked', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    await store.show(['zoe-sky', 'paul-sky']);
    // In the list order, whatever the order ticked.
    expect([store.shown, store.ownShown]).toEqual([['paul-sky', 'zoe-sky'], false]);
    expect(ids(store.visitPhotos)).toEqual(['paul-sky-1', 'zoe-sky-1']);
    await store.show([MY_SKY, 'zoe-sky']);
    expect([store.shown, store.ownShown]).toEqual([[MY_SKY, 'zoe-sky'], true]);
    expect(ids(store.visitPhotos)).toEqual(['zoe-sky-1']);
    // None ticked: no photo at all.
    await store.show([]);
    expect([store.shown, store.ownShown, store.visitPhotos]).toEqual([[], false, []]);
  });

  it('leaves out a sky that is not kept', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    await store.show(['nobody', 'paul-sky']);
    expect(store.shown).toEqual(['paul-sky']);
  });

  it('remembers the skies shown, and shows them again the next time', async () => {
    const first = useSharedSkiesStore();
    await first.load();
    await first.show([MY_SKY, 'zoe-sky']);
    expect(JSON.parse(storage().get('sharedSkyView')!)).toEqual({ shown: [MY_SKY, 'zoe-sky'] });

    setActivePinia(createPinia());
    const next = useSharedSkiesStore();
    await next.load();
    expect(next.shown).toEqual([MY_SKY, 'zoe-sky']);
    expect(ids(next.visitPhotos)).toEqual(['zoe-sky-1']);
  });

  it('reads back the earlier single choice of a sky', async () => {
    storage().set('sharedSkyView', JSON.stringify({ mode: 'visit', skyId: 'paul-sky' }));
    const store = useSharedSkiesStore();
    await store.load();
    expect([store.shown, ids(store.visitPhotos)]).toEqual([['paul-sky'], ['paul-sky-1']]);
  });

  it('does not show again a remembered sky that was deleted since, nor an unreadable choice', async () => {
    storage().set('sharedSkyView', JSON.stringify({ shown: ['gone'] }));
    const store = useSharedSkiesStore();
    await store.load();
    expect(store.shown).toEqual([]);

    storage().set('sharedSkyView', '{ not json');
    setActivePinia(createPinia());
    const other = useSharedSkiesStore();
    await other.load();
    expect(other.shown).toEqual([MY_SKY]);
  });

  it('shows the photos of a newer package at once when its sky is shown', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    await store.show(['paul-sky']);
    vi.mocked(openSharedSky).mockResolvedValue(sky('paul-sky', { photoCount: 2 }));
    vi.mocked(getSharedSkyPhotos).mockResolvedValue([
      photo('new-1', 'paul-sky'),
      photo('new-2', 'paul-sky'),
    ]);
    const opened = await store.open('ticket-1');
    expect(opened.photoCount).toBe(2);
    expect(openSharedSky).toHaveBeenCalledWith('ticket-1', undefined);
    expect(ids(store.visitPhotos)).toEqual(['new-1', 'new-2']);
  });

  it('stops showing a deleted sky, and shows the user own again when it was the only one shown', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    await store.show(['paul-sky', 'zoe-sky']);
    vi.mocked(removeSharedSky).mockResolvedValue({ bytesFreed: 1234 });
    vi.mocked(getSharedSkies).mockResolvedValue([sky('zoe-sky')]);
    expect(await store.remove('paul-sky')).toBe(1234);
    expect([store.shown, ids(store.visitPhotos)]).toEqual([['zoe-sky'], ['zoe-sky-1']]);

    vi.mocked(getSharedSkies).mockResolvedValue([]);
    await store.remove('zoe-sky');
    expect([store.shown, store.ownShown, store.visitPhotos]).toEqual([[MY_SKY], true, []]);
    expect(JSON.parse(storage().get('sharedSkyView')!)).toEqual({ shown: [MY_SKY] });
  });

  it('stops showing a sky whose photos cannot be read, and shows the user own when none is left', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    vi.mocked(getSharedSkyPhotos).mockImplementation(async (id) => {
      if (id === 'paul-sky') throw new Error('gone');
      return [photo(`${id}-1`, id)];
    });
    await store.show(['paul-sky', 'zoe-sky']);
    expect([store.shown, ids(store.visitPhotos)]).toEqual([['zoe-sky'], ['zoe-sky-1']]);
    await store.show(['paul-sky']);
    expect([store.shown, store.visitPhotos]).toEqual([[MY_SKY], []]);
  });

  it('keeps the photos of the latest choice when an earlier one ends later', async () => {
    const store = useSharedSkiesStore();
    await store.load();
    let release: () => void = () => undefined;
    vi.mocked(getSharedSkyPhotos).mockImplementationOnce(
      (id) =>
        new Promise((resolve) => {
          release = () => resolve([photo(`${id}-slow`, id)]);
        }),
    );
    const slow = store.show(['paul-sky']);
    await store.show(['zoe-sky']);
    release();
    await slow;
    expect(ids(store.visitPhotos)).toEqual(['zoe-sky-1']);
  });

  it('gives the categories of each sky shown an id of their own, and points its photos at them', async () => {
    vi.mocked(getSharedSkies).mockResolvedValue([
      sky('paul-sky', {
        poiCategories: [
          { id: 'a', name: 'Comet', color: '#111111' },
          { id: 'b', name: 'Nova', color: '#222222' },
        ],
      }),
      sky('zoe-sky', { poiCategories: [{ id: 'a', name: 'Comet', color: '#333333' }] }),
    ]);
    vi.mocked(getSharedSkyPhotos).mockImplementation(async (id) => [
      photo(`${id}-1`, id, {
        pointsOfInterest: [
          { categoryId: 'a', name: 'C/2025 A1' },
        ] as SharedSkyPhoto['pointsOfInterest'],
      }),
    ]);
    const store = useSharedSkiesStore();
    await store.load();
    expect(store.visitPoiCategories).toEqual([]);
    await store.show([MY_SKY, 'paul-sky', 'zoe-sky']);
    expect(store.visitPoiCategories.map((c) => [c.id, c.color, c.position])).toEqual([
      ['paul-sky:a', '#111111', 0],
      ['paul-sky:b', '#222222', 1],
      ['zoe-sky:a', '#333333', 0],
    ]);
    expect(store.visitPhotos.map((p) => p.pointsOfInterest[0].categoryId)).toEqual([
      'paul-sky:a',
      'zoe-sky:a',
    ]);
  });
});
