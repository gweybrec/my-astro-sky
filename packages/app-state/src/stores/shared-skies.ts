import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { TransferOptions } from '@myastrosky/core/backend';
import type {
  SharedSky,
  SharedSkyPhoto,
  SharedSkyPreview,
  ShareRequest,
} from '@myastrosky/core/domain/shared-sky';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { storage } from '@myastrosky/core/platform/storage';
import { keepKnownSkies, MY_SKY, rememberedSkiesShown } from '@myastrosky/core/shared-sky-view';
import type { PoiCategory } from '@myastrosky/core/types';
import {
  discardSharedSky,
  getSharedSkies,
  getSharedSkyPhotos,
  inspectSharedSky,
  openSharedSky,
  removeSharedSky,
  shareMySky,
} from '../api';

/** Where the choice of skies is kept between sessions. */
const VIEW_KEY = 'sharedSkyView';

/**
 * A visit's photos with their points of interest pointing at that sky's own categories: two senders may use the same
 * category id for different colours, so each sky's ids are made distinct (`<skyId>:<categoryId>`).
 */
function withSkyCategories(photos: SharedSkyPhoto[], skyId: string): SharedSkyPhoto[] {
  return photos.map((photo) =>
    photo.pointsOfInterest.length === 0
      ? photo
      : {
          ...photo,
          pointsOfInterest: photo.pointsOfInterest.map((poi) => ({
            ...poi,
            categoryId: `${skyId}:${poi.categoryId}`,
          })),
        },
  );
}

/**
 * The skies other people shared, kept as visits, and which skies are being looked at: the user's own (`MY_SKY`) and
 * any visited ones, ticked in a list. The visits' photos are held here, apart from the user's own: the map layer gets
 * them through `setVisitPhotos`, and nothing that lists the user's photos sees them.
 */
export const useSharedSkiesStore = defineStore('sharedSkies', () => {
  const skies = ref<SharedSky[]>([]);
  const loaded = ref(false);
  /** The skies ticked: `MY_SKY` and visited skies' ids, in the list's order. */
  const shown = ref<string[]>([MY_SKY]);
  /** The photos of the visited skies shown, in the list's order; empty while none is. */
  const visitPhotos = shallowRef<SharedSkyPhoto[]>([]);

  /** The visited skies shown. */
  const shownSkies = computed<SharedSky[]>(() =>
    skies.value.filter((s) => shown.value.includes(s.id)),
  );
  /** Whether the user's own photos are shown. */
  const ownShown = computed(() => shown.value.includes(MY_SKY));
  /** The categories of the shown skies' points of interest, in the shape the map and the screens resolve them with. */
  const visitPoiCategories = computed<PoiCategory[]>(() =>
    shownSkies.value.flatMap((sky) =>
      sky.poiCategories.map((c, position) => ({ ...c, id: `${sky.id}:${c.id}`, position })),
    ),
  );

  function remember(): void {
    try {
      storage().set(VIEW_KEY, JSON.stringify({ shown: shown.value }));
    } catch {
      // The choice is only not remembered.
    }
  }

  function recall(): unknown {
    try {
      return JSON.parse(storage().get(VIEW_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  /** Reads the photos of the skies shown; a sky that cannot be read is no longer shown. */
  async function loadVisitPhotos(): Promise<void> {
    const shownKey = () => shownSkies.value.map((s) => s.id).join('|');
    const wanted = shownSkies.value;
    const lists: SharedSkyPhoto[][] = [];
    const failed = new Set<string>();
    for (const sky of wanted) {
      try {
        lists.push(withSkyCategories(await getSharedSkyPhotos(sky.id), sky.id));
      } catch (err) {
        reportError('shared_sky_photos_load_failed', err);
        failed.add(sky.id);
      }
    }
    if (failed.size > 0) {
      const kept = shown.value.filter((v) => !failed.has(v));
      // When none is left, the user's own sky is shown again.
      shown.value = kept.length > 0 ? kept : [MY_SKY];
      remember();
    }
    // The choice may have changed while the photos were read: the later call sets them.
    const read = wanted
      .filter((s) => !failed.has(s.id))
      .map((s) => s.id)
      .join('|');
    if (shownKey() === read) visitPhotos.value = lists.flat();
  }

  /** Reads the visits and, the first time, shows again the skies that were shown when the app was closed. */
  async function load(): Promise<void> {
    try {
      skies.value = await getSharedSkies();
    } catch (err) {
      reportError('shared_skies_load_failed', err);
      return;
    }
    const before = shown.value.join('|');
    if (!loaded.value) {
      loaded.value = true;
      shown.value = rememberedSkiesShown(recall(), skies.value);
    } else {
      // A visit deleted is no longer shown; when it was the only sky shown, the user's own is shown again.
      const kept = keepKnownSkies(shown.value, skies.value);
      shown.value = kept.length === 0 && shown.value.length > 0 ? [MY_SKY] : kept;
    }
    if (shown.value.join('|') !== before) remember();
    await loadVisitPhotos();
  }

  /** Shows the skies ticked: `MY_SKY` and visited skies' ids, in any number (none: no photo at all). */
  async function show(values: readonly string[]): Promise<void> {
    shown.value = keepKnownSkies(values, skies.value);
    remember();
    await loadVisitPhotos();
  }

  /** Writes a package of the user's sky and hands it over. */
  function share(request: ShareRequest): Promise<void> {
    return shareMySky(request);
  }

  /** Reads what a package holds; nothing is kept until `open`. */
  function inspect(
    file: File,
    options?: TransferOptions,
  ): Promise<{ ticket: string; preview: SharedSkyPreview }> {
    return inspectSharedSky(file, options);
  }

  /** Keeps an inspected package as a visit, and shows its photos at once when that sky is the one shown. */
  async function open(ticket: string, options?: TransferOptions): Promise<SharedSky> {
    const sky = await openSharedSky(ticket, options);
    await load();
    return sky;
  }

  function discard(ticket: string): Promise<void> {
    return discardSharedSky(ticket);
  }

  /** Deletes a visit; returns the bytes freed. It is no longer shown. */
  async function remove(id: string): Promise<number> {
    const { bytesFreed } = await removeSharedSky(id);
    await load();
    return bytesFreed;
  }

  return {
    skies,
    loaded,
    shown,
    visitPhotos,
    shownSkies,
    ownShown,
    visitPoiCategories,
    load,
    loadVisitPhotos,
    show,
    share,
    inspect,
    open,
    discard,
    remove,
  };
});
