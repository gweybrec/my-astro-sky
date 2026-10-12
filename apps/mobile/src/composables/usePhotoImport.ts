import { computed, shallowRef } from 'vue';
import type { Photo, PhotoCorrespondence } from '@myastrosky/core/types';
import { ANY_PHOTO_EXT_RE, isRawAstroFile } from '@myastrosky/core/photo-formats';
import { sanitizeCaptureDetails } from '@myastrosky/core/capture-fields';
import { wcsPhotoMetadata, type WcsPhotoMetadata } from '@myastrosky/core/wcs-photo-metadata';
import { convertRawPhoto, uploadPhoto } from '@myastrosky/app-state/api';

/**
 * - `converting`: a solved-format file (TIFF, FITS) is being read: its picture is made and its header's WCS is read.
 * - `solved`: the file says where it is on the sky ("Déjà résolue"); it can be imported.
 * - `toPlace`: nothing says where the photo is; it needs a placement method.
 * - `failed`: the file could not be read.
 * - `importing` / `imported`: the photo is being stored / is stored.
 */
export type ImportStatus =
  'converting' | 'solved' | 'toPlace' | 'failed' | 'importing' | 'imported';

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

/** The number of photos that can be imported now. */
export const solvedCount = computed(() => items.value.filter((i) => i.status === 'solved').length);

/** True while a file is being read or stored. */
export const importBusy = computed(() =>
  items.value.some((i) => i.status === 'converting' || i.status === 'importing'),
);

/**
 * Stores every solved photo, placed where its file says. A photo that cannot be stored stays in the list as failed;
 * the stored ones leave it. Returns the stored photos.
 */
export async function importSolved(): Promise<Photo[]> {
  const stored: Photo[] = [];
  for (const item of items.value.filter((i) => i.status === 'solved')) {
    update(item, { status: 'importing' });
    try {
      const meta = item.metadata!;
      const photo = await uploadPhoto(item.file, item.correspondences!, undefined, undefined, {
        dsoIds: meta.dsoIds,
        integrations: meta.integrations,
        observationDate: meta.observationDate ?? null,
        captureDetails: meta.captureDetails ? sanitizeCaptureDetails(meta.captureDetails) : null,
        displayName: stripExtension(item.name),
      });
      stored.push(photo);
      update(item, { status: 'imported' });
    } catch (error) {
      update(item, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  items.value = items.value.filter((i) => i.status !== 'imported');
  return stored;
}

/** Empties the import (the page was left). */
export function clearImport() {
  items.value = [];
}
