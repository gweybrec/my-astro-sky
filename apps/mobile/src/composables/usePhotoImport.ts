import { computed, shallowRef, watch } from 'vue';
import type { Photo, PhotoCorrespondence } from '@myastrosky/core/types';
import { ANY_PHOTO_EXT_RE, isRawAstroFile } from '@myastrosky/core/photo-formats';
import { sanitizeCaptureDetails } from '@myastrosky/core/capture-fields';
import { wcsPhotoMetadata, type WcsPhotoMetadata } from '@myastrosky/core/wcs-photo-metadata';
import { convertRawPhoto, uploadPhoto } from '@myastrosky/app-state/api';
import { addPendingPhoto, pendingPhotos } from '../pending-photos';
import { solvePendingOnline } from '../pending-solve';

/**
 * - `converting`: a solved-format file (TIFF, FITS) is being read: its picture is made and its header's WCS is read.
 * - `solved`: the file says where it is on the sky ("Déjà résolue"); it is imported as a placed photo.
 * - `toPlace`: nothing says where the photo is; it is imported as a photo waiting for a placement method.
 * - `failed`: the file could not be read or stored.
 * - `importing` / `imported`: the photo is being stored / is stored.
 * - `solving`: the photo was sent to the online solver from this list; it is already kept as a waiting photo, and
 *   leaves the list once it is solved and placed.
 * - `solveFailed`: that solve did not succeed; another method can be chosen.
 */
export type ImportStatus =
  | 'converting'
  | 'solved'
  | 'toPlace'
  | 'failed'
  | 'importing'
  | 'imported'
  | 'solving'
  | 'solveFailed';

export interface ImportItem {
  id: number;
  name: string;
  /** The picture to store: the file itself, or the PNG made from a TIFF / FITS. */
  file: File;
  status: ImportStatus;
  /** Where the photo is on the sky (status `solved`). */
  correspondences: PhotoCorrespondence[] | null;
  metadata: WcsPhotoMetadata | null;
  error: string;
  /** The waiting photo this file became when a placement method was chosen for it here. */
  pendingId?: string;
}

const items = shallowRef<ImportItem[]>([]);
let nextId = 1;

/** The files chosen to import, in the order they were added. */
export const importItems = computed(() => items.value);

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

function update(item: ImportItem, changes: Partial<ImportItem>) {
  Object.assign(item, changes);
  // A new list, so that the screen draws the changed row.
  items.value = [...items.value];
}

// One conversion at a time: a large raw file and its decode buffers are not held in memory for several photos at once.
let converting = Promise.resolve();

async function readSolvedFile(item: ImportItem) {
  try {
    const { png, meta } = await convertRawPhoto(item.file);
    const wcs = wcsPhotoMetadata(meta, meta.width, meta.height);
    update(item, {
      file: png,
      status: wcs ? 'solved' : 'toPlace',
      correspondences: wcs ? (meta.correspondences ?? null) : null,
      metadata: wcs,
    });
  } catch (error) {
    update(item, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Adds the picked files to the import. Files that are not photos are left out; returns how many were added. */
export function addImportFiles(files: File[]): number {
  const added: ImportItem[] = [];
  for (const file of files) {
    if (!ANY_PHOTO_EXT_RE.test(file.name)) continue;
    const raw = isRawAstroFile(file.name);
    added.push({
      id: nextId++,
      name: file.name,
      file,
      status: raw ? 'converting' : 'toPlace',
      correspondences: null,
      metadata: null,
      error: '',
    });
  }
  items.value = [...items.value, ...added];
  for (const item of added) {
    if (item.status === 'converting') converting = converting.then(() => readSolvedFile(item));
  }
  return added.length;
}

/** The number of photos whose file says where they are on the sky. */
export const solvedCount = computed(() => items.value.filter((i) => i.status === 'solved').length);

/**
 * The number of photos "Importer" would take now: the solved ones, the ones still to place, and the ones already
 * kept because a placement method was chosen for them here.
 */
export const importableCount = computed(
  () =>
    items.value.filter(
      (i) => i.status === 'solved' || i.status === 'toPlace' || i.pendingId !== undefined,
    ).length,
);

/**
 * Sends a photo of the list to the online solver. It is kept as a waiting photo first, so that it is in the gallery
 * whatever happens to this list; the row then shows "Résolution".
 */
export async function solveImportOnline(item: ImportItem): Promise<void> {
  if (item.status !== 'toPlace' && item.status !== 'solveFailed') return;
  try {
    const pendingId = item.pendingId ?? (await addPendingPhoto(item.file, item.name)).id;
    update(item, { pendingId, status: 'solving', error: '' });
    await solvePendingOnline(pendingId);
  } catch (error) {
    update(item, {
      status: 'solveFailed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// A photo sent to the solver from this list follows its waiting photo: it leaves the list once that photo is placed
// (it is then an ordinary photo of the gallery), and shows the failure when the solve does not succeed.
watch(pendingPhotos, (waiting) => {
  let changed = false;
  const next: ImportItem[] = [];
  for (const item of items.value) {
    if (item.pendingId === undefined) {
      next.push(item);
      continue;
    }
    const kept = waiting.find((p) => p.id === item.pendingId);
    if (!kept) {
      changed = true;
      continue;
    }
    const status = kept.state === 'failed' ? 'solveFailed' : 'solving';
    if (item.status !== status) {
      Object.assign(item, { status, error: kept.error ?? '' });
      changed = true;
    }
    next.push(item);
  }
  if (changed) items.value = next;
});

/** True while a file is being read or stored. */
export const importBusy = computed(() =>
  items.value.some((i) => i.status === 'converting' || i.status === 'importing'),
);

/**
 * Imports everything at once: a solved photo is stored, placed where its file says; a photo still to place is kept
 * as a waiting photo, which the gallery shows as "À placer". A photo that cannot be stored stays in the list as
 * failed; the others leave it. Returns the photos stored with their placement.
 */
export async function importAll(): Promise<Photo[]> {
  const stored: Photo[] = [];
  const ready = items.value.filter((i) => i.status === 'solved' || i.status === 'toPlace');
  for (const item of ready) {
    const solved = item.status === 'solved';
    update(item, { status: 'importing' });
    try {
      if (solved) {
        const meta = item.metadata!;
        stored.push(
          await uploadPhoto(item.file, item.correspondences!, undefined, undefined, {
            dsoIds: meta.dsoIds,
            integrations: meta.integrations,
            observationDate: meta.observationDate ?? null,
            captureDetails: meta.captureDetails
              ? sanitizeCaptureDetails(meta.captureDetails)
              : null,
            displayName: stripExtension(item.name),
          }),
        );
      } else {
        await addPendingPhoto(item.file, item.name);
      }
      update(item, { status: 'imported' });
    } catch (error) {
      update(item, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // The stored ones leave the list, and so do the ones already kept as waiting photos.
  items.value = items.value.filter((i) => i.status !== 'imported' && i.pendingId === undefined);
  return stored;
}

/** Empties the import (the page was left). */
export function clearImport() {
  items.value = [];
}
