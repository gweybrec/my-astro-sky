import type { Photo, PoiCategory } from './types';
import { getDSOById } from './catalog/dso-registry';
import { poisMatchFilter } from './poi';
import { NO_LABEL } from './photo-placement';
import { smartSortPhotos } from './photo-search';
import { storage } from './platform/storage';

/** Sentinel setup id of the photos linked to no (known) gear setup. */
export const NO_SETUP = '(no setup)';

/** The gallery's search and filters. null ⇒ that filter is off; an empty list (or map) ⇒ no photo passes it. */
export interface GalleryFilters {
  /** Lower-cased, trimmed search text; '' ⇒ no search. */
  query: string;
  /** Labels, plus {@link NO_LABEL} for unlabelled photos. */
  labels: string[] | null;
  /** Setup ids, plus {@link NO_SETUP} for photos with no known setup. */
  setups: string[] | null;
  /** categoryId → selected names (empty set ⇒ the whole category). */
  pois: Map<string, Set<string>> | null;
  dsoTypes: string[] | null;
  dsoCatalogs: string[] | null;
  /** 'YYYY-MM-DD'; null ⇒ no date filter. dateTo null with a dateFrom ⇒ that single day. */
  dateFrom: string | null;
  dateTo: string | null;
}

export function emptyGalleryFilters(): GalleryFilters {
  return {
    query: '',
    labels: null,
    setups: null,
    pois: null,
    dsoTypes: null,
    dsoCatalogs: null,
    dateFrom: null,
    dateTo: null,
  };
}

/** What the filters need besides the photos: the setups that exist and the POI categories. */
export interface GalleryFilterContext {
  knownSetupIds: ReadonlySet<string>;
  poiCategories: PoiCategory[];
}

/** A photo's setup id as the setup filter sees it: {@link NO_SETUP} when unset or dangling. */
export function gallerySetupKey(photo: Photo, knownSetupIds: ReadonlySet<string>): string {
  return photo.gearSetupId && knownSetupIds.has(photo.gearSetupId) ? photo.gearSetupId : NO_SETUP;
}

/** True when an id or a file name belongs to one of the catalogues (prefix followed by a digit, space or dash). */
function matchesCatalog(name: string, catalogs: string[]): boolean {
  const upper = name.toUpperCase();
  return catalogs.some((cat) => {
    const p = cat.toUpperCase();
    return (
      upper.startsWith(p + ' ') ||
      upper.startsWith(p + '-') ||
      upper === p ||
      (upper.startsWith(p) && upper.length > p.length && /[\d\s-]/.test(upper[p.length]))
    );
  });
}

/** The photos passing every active filter, in their given order. */
export function filterGalleryPhotos(
  photos: Photo[],
  filters: GalleryFilters,
  ctx: GalleryFilterContext,
): Photo[] {
  let filtered = [...photos];

  // Search — file name, objects, labels, points of interest, notes
  const q = filters.query.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (photo) =>
        photo.originalName.toLowerCase().includes(q) ||
        photo.dsoIds.some((id) => id.toLowerCase().includes(q)) ||
        photo.labels.some((l) => l.toLowerCase().includes(q)) ||
        (photo.pointsOfInterest ?? []).some((p) => p.name.toLowerCase().includes(q)) ||
        photo.notes.toLowerCase().includes(q),
    );
  }

  // Labels — the (no label) sentinel controls unlabelled photos
  if (filters.labels) {
    const sel = filters.labels;
    filtered = filtered.filter((photo) =>
      photo.labels.length === 0
        ? sel.includes(NO_LABEL)
        : photo.labels.some((l) => sel.includes(l)),
    );
  }

  // Gear setup — the (no setup) sentinel controls unlinked photos
  if (filters.setups) {
    const sel = filters.setups;
    filtered = filtered.filter((photo) => sel.includes(gallerySetupKey(photo, ctx.knownSetupIds)));
  }

  // Object types — photos with no object always pass; others need at least one match
  if (filters.dsoTypes) {
    const sel = filters.dsoTypes;
    filtered = filtered.filter(
      (photo) =>
        photo.dsoIds.length === 0 ||
        photo.dsoIds.some((id) => {
          const dso = getDSOById(id);
          return dso && sel.includes(dso.type);
        }),
    );
  }

  // Catalogues — the photo's objects if it has some, else its file name
  if (filters.dsoCatalogs) {
    const sel = filters.dsoCatalogs;
    filtered = filtered.filter((photo) =>
      photo.dsoIds.length > 0
        ? photo.dsoIds.some((id) => matchesCatalog(id, sel))
        : matchesCatalog(photo.originalName, sel),
    );
  }

  // Points of interest — only photos with at least one selected POI pass
  if (filters.pois) {
    const sel = filters.pois;
    filtered = filtered.filter((photo) =>
      poisMatchFilter(photo.pointsOfInterest ?? [], ctx.poiCategories, sel),
    );
  }

  // Observation date — a photo with no date can't satisfy it; a reversed range is swapped.
  // ISO 8601 date strings compare lexicographically, so the UTC day is sliced off.
  if (filters.dateFrom) {
    let from = filters.dateFrom;
    let to = filters.dateTo ?? from;
    if (to < from) [from, to] = [to, from];
    filtered = filtered.filter((photo) => {
      if (!photo.observationDate) return false;
      const day = photo.observationDate.slice(0, 10);
      return day >= from && day <= to;
    });
  }

  return filtered;
}

/** The gallery's orders: by name (catalogue-aware, M2 before M100) or by observation date. */
export type GallerySort = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';
export const GALLERY_SORTS: readonly GallerySort[] = [
  'name-asc',
  'name-desc',
  'date-desc',
  'date-asc',
];
export const DEFAULT_GALLERY_SORT: GallerySort = 'name-asc';

export function isGallerySort(value: unknown): value is GallerySort {
  return GALLERY_SORTS.includes(value as GallerySort);
}

/** The i18n key naming each order. */
export const GALLERY_SORT_LABEL_KEYS: Record<GallerySort, string> = {
  'name-asc': 'gallery.sortNameAsc',
  'name-desc': 'gallery.sortNameDesc',
  'date-desc': 'gallery.sortDateNewest',
  'date-asc': 'gallery.sortDateOldest',
};

const SORT_KEY = 'gallery-sort';

/** The stored order of the gallery (kept between sessions, unlike the filters). */
export function loadGallerySort(): GallerySort {
  const stored = storage().get(SORT_KEY);
  return isGallerySort(stored) ? stored : DEFAULT_GALLERY_SORT;
}

export function saveGallerySort(sort: GallerySort): void {
  storage().set(SORT_KEY, sort);
}

/** The photos in the chosen order. By date, photos with no date come last, in name order. */
export function sortGalleryPhotos(photos: Photo[], sort: GallerySort): Photo[] {
  const byName = smartSortPhotos(photos);
  if (sort === 'name-asc') return byName;
  if (sort === 'name-desc') return byName.reverse();
  const sign = sort === 'date-desc' ? -1 : 1;
  // Array.prototype.sort is stable: equal dates keep their name order.
  return byName.sort((a, b) => {
    const da = a.observationDate;
    const db = b.observationDate;
    if (!da || !db) return da ? -1 : db ? 1 : 0;
    return da < db ? -sign : da > db ? sign : 0;
  });
}

/** The setup filter's options: each setup at least one photo links to, then {@link NO_SETUP}, with photo counts. */
export function gallerySetupItems(
  photos: Photo[],
  setupNames: ReadonlyMap<string, string>,
): { setupId: string; name: string; count: number }[] {
  const known = new Set(setupNames.keys());
  const counts = new Map<string, number>();
  for (const p of photos) {
    const id = gallerySetupKey(p, known);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([setupId, count]) => ({
      setupId,
      name: setupId === NO_SETUP ? NO_SETUP : (setupNames.get(setupId) ?? setupId),
      count,
    }))
    .sort((a, b) => {
      if (a.setupId === NO_SETUP) return 1;
      if (b.setupId === NO_SETUP) return -1;
      return a.name.localeCompare(b.name);
    });
}
