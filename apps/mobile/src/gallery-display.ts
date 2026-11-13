import { reactive, ref } from 'vue';
import { storage } from '@myastrosky/core/platform/storage';
import type { Photo } from '@myastrosky/core/types';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import {
  DEFAULT_GALLERY_SORT,
  emptyGalleryFilters,
  filterGalleryPhotos,
  loadGallerySort,
  saveGallerySort,
  sortGalleryPhotos,
  type GalleryFilterContext,
  type GalleryFilters,
  type GallerySort,
} from '@myastrosky/core/gallery-filter';

/** How the phone is held: the gallery keeps a number of photos per line for each. */
export type Orientation = 'portrait' | 'landscape';

/** The numbers of photos per line the "Affichage" sheet offers (boards "Galerie, affichage"). */
export const PER_LINE_CHOICES: Record<Orientation, readonly number[]> = {
  portrait: [1, 2, 3],
  landscape: [3, 4, 5, 6],
};
const DEFAULTS: Record<Orientation, number> = { portrait: 2, landscape: 6 };
const KEY = 'gallery-display-v1';

function read(): Record<Orientation, number> {
  let stored: Partial<Record<Orientation, unknown>> = {};
  try {
    stored = JSON.parse(storage().get(KEY) ?? '{}') ?? {};
  } catch {
    // An unreadable record is as good as none.
  }
  const valid = (o: Orientation) =>
    PER_LINE_CHOICES[o].includes(stored[o] as number) ? (stored[o] as number) : DEFAULTS[o];
  return { portrait: valid('portrait'), landscape: valid('landscape') };
}

/** The photos per line in each orientation; a change is stored at once. */
export const photosPerLine = reactive<Record<Orientation, number>>({ ...DEFAULTS });

/** Reads the stored choice (the storage is set up at start-up, after this module may have loaded). */
export function loadGalleryDisplay(): void {
  Object.assign(photosPerLine, read());
  gallerySort.value = loadGallerySort();
}

/** The order of the photos (the desktop's sort, kept between sessions with the same record). */
export const gallerySort = ref<GallerySort>(DEFAULT_GALLERY_SORT);

export function setGallerySort(sort: GallerySort): void {
  gallerySort.value = sort;
  saveGallerySort(sort);
}

/** The search and the filters of the gallery, kept while the app runs (not stored). A list is null while every value
 * is shown. */
export const galleryFilters = reactive<GalleryFilters>(emptyGalleryFilters());

/**
 * The photos the gallery lists (board "Galerie, choix du ciel affiché"): the user's own, unless a visited sky is shown
 * alone, then those of the visited sky shown. A visited sky is never mixed into the user's own photos elsewhere.
 */
export async function photosWithVisit(own: Photo[]): Promise<Photo[]> {
  const sharedSkies = useSharedSkiesStore();
  if (!sharedSkies.loaded) await sharedSkies.load();
  return [...(sharedSkies.ownShown ? own : []), ...sharedSkies.visitPhotos];
}

/**
 * The photos as the gallery shows them: those its search and filters keep, in the order of its "Trier par" sheet. A
 * photo's screen goes from one to the next in this order (board "Photo, glisser vers la suivante").
 */
export function galleryShownPhotos(photos: Photo[], context: GalleryFilterContext): Photo[] {
  return sortGalleryPhotos(filterGalleryPhotos(photos, galleryFilters, context), gallerySort.value);
}

/**
 * The last photo shown on its own screen, until the gallery takes it (`takeLastViewedPhoto`): back in the gallery, the
 * grid goes to it when it is not where the grid was left.
 */
let lastViewedPhoto: string | null = null;

export function setLastViewedPhoto(id: string): void {
  lastViewedPhoto = id;
}

export function takeLastViewedPhoto(): string | null {
  const id = lastViewedPhoto;
  lastViewedPhoto = null;
  return id;
}

/** Whether a filter (not the search) hides photos. */
export function galleryFiltered(): boolean {
  const f = galleryFilters;
  return !!(f.labels || f.setups || f.pois || f.dsoTypes || f.dsoCatalogs || f.dateFrom);
}

/** Shows every photo again; the search is kept. */
export function clearGalleryFilters(): void {
  Object.assign(galleryFilters, { ...emptyGalleryFilters(), query: galleryFilters.query });
}

export function setPhotosPerLine(orientation: Orientation, count: number): void {
  if (!PER_LINE_CHOICES[orientation].includes(count)) return;
  photosPerLine[orientation] = count;
  storage().set(KEY, JSON.stringify({ ...photosPerLine }));
}
