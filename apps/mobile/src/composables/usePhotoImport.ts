import { computed, ref, shallowRef } from 'vue';
import type { Photo } from '@myastrosky/core/types';
import { ANY_PHOTO_EXT_RE, isFitsFile, isRawAstroFile } from '@myastrosky/core/photo-formats';
import { wcsCaptureMetadata, wcsPhotoMetadata } from '@myastrosky/core/wcs-photo-metadata';
import { convertRawPhoto } from '@myastrosky/app-state/api';
import { suggestedSetupFor } from '@myastrosky/app-state/wcs-load-flow';
import {
  addPendingPhoto,
  leaveImport,
  pendingPhotos,
  removePendingPhoto,
  storePendingPhoto,
  type PendingCapture,
  type PendingPhoto,
} from '../pending-photos';

/**
 * The list of "Importer des photos". Each picked file is read first (`reading`: a TIFF, FITS or XISF is converted and
 * its header's WCS read), then kept as a waiting photo of the import (`inImport`): it stays in the list while its page
 * "Photo à ajouter" or a placement method is open, and after a restart it goes to the gallery. A file whose header
 * places it is kept `placed` at once ("✓ Déjà résolue").
 */
export interface ReadingFile {
  key: string;
  name: string;
  /** `converting`: being read. `failed`: it could not be read (`error`). */
  status: 'converting' | 'failed';
  error: string;
  /** When it was picked: the list keeps that order. */
  pickedAt: number;
}

/** A row of the list: a file being read, or a photo kept for the import. */
export type ImportRow =
  | { kind: 'reading'; key: string; file: ReadingFile }
  | { kind: 'pending'; key: string; photo: PendingPhoto };

const reading = shallowRef<ReadingFile[]>([]);
let nextKey = 1;

/** The photos of the import, in the order their files were picked. */
export const importPhotos = computed(() => pendingPhotos.value.filter((p) => p.inImport));

/** The rows of the list: the files being read or that failed, and the photos kept, in the order they were picked. */
export const importRows = computed<ImportRow[]>(() =>
  [
    ...reading.value.map((file) => ({
      at: file.pickedAt,
      row: { kind: 'reading', key: file.key, file } as const,
    })),
    ...importPhotos.value.map((photo) => ({
      at: photo.addedAt,
      row: { kind: 'pending', key: photo.id, photo } as const,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map(({ row }) => row),
);

function setReading(file: ReadingFile, changes: Partial<ReadingFile> | null) {
  reading.value = changes
    ? reading.value.map((f) => (f === file ? Object.assign(file, changes) : f))
    : reading.value.filter((f) => f !== file);
  // A new list, so that the screen draws the changed row.
  reading.value = [...reading.value];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// One conversion at a time: a large raw file and its decode buffers are not held in memory for several photos at once.
let converting = Promise.resolve();

/** Reads a TIFF, FITS or XISF, then keeps it for the import, placed when its header has a plate solution. */
async function readRawFile(file: File, entry: ReadingFile) {
  try {
    const { png, meta } = await convertRawPhoto(file);
    const wcs = wcsPhotoMetadata(meta, meta.width, meta.height);
    // The raw file is the photo itself: nothing to compare it with, but its header may point to a saved setup.
    const gearSetupId = await suggestedSetupFor(meta);
    const capture = wcs ?? wcsCaptureMetadata(meta);
    const kept: PendingCapture = {
      ...(capture?.integrations.length ? { integrations: capture.integrations } : {}),
      ...(capture?.observationDate ? { observationDate: capture.observationDate } : {}),
      ...(capture?.captureDetails ? { captureDetails: capture.captureDetails } : {}),
      ...(gearSetupId ? { gearSetupId } : {}),
      ...(capture?.fitsHeaders?.length ? { fitsHeaders: capture.fitsHeaders } : {}),
    };
    const placed = wcs && meta.correspondences?.length;
    await addPendingPhoto(
      png,
      file.name,
      Object.keys(kept).length ? kept : undefined,
      // astrometry.net reads the original FITS; it reads no TIFF or XISF: those go as the PNG.
      isFitsFile(file.name) ? file : undefined,
      {
        inImport: true,
        addedAt: entry.pickedAt,
        noSolution: !wcs,
        ...(placed
          ? {
              placement: { correspondences: meta.correspondences!, dsoIds: wcs.dsoIds, by: 'file' },
              dsoIds: wcs.dsoIds,
            }
          : {}),
      },
    );
    setReading(entry, null);
  } catch (error) {
    setReading(entry, { status: 'failed', error: messageOf(error) });
  }
}

/** Keeps a JPEG, PNG or WebP for the import as it is. */
async function keepPicture(file: File, entry: ReadingFile) {
  try {
    await addPendingPhoto(file, file.name, undefined, undefined, {
      inImport: true,
      addedAt: entry.pickedAt,
    });
    setReading(entry, null);
  } catch (error) {
    setReading(entry, { status: 'failed', error: messageOf(error) });
  }
}

/** Adds the picked files to the import. Files that are not photos are left out; returns how many were added. */
export function addImportFiles(files: File[]): number {
  const now = Date.now();
  const added: [File, ReadingFile][] = [];
  for (const file of files) {
    if (!ANY_PHOTO_EXT_RE.test(file.name)) continue;
    added.push([
      file,
      {
        key: `reading-${nextKey++}`,
        name: file.name,
        status: 'converting',
        error: '',
        pickedAt: now + added.length,
      },
    ]);
  }
  reading.value = [...reading.value, ...added.map(([, entry]) => entry)];
  for (const [file, entry] of added) {
    if (isRawAstroFile(file.name)) converting = converting.then(() => readRawFile(file, entry));
    else void keepPicture(file, entry);
  }
  return added.length;
}

const storing = ref(false);

/** True while a file is being read, or the photos stored. */
export const importBusy = computed(
  () => storing.value || reading.value.some((f) => f.status === 'converting'),
);

/** The number of photos "Importer" takes: every photo kept for the import. */
export const importableCount = computed(() => importPhotos.value.length);

/**
 * Imports everything at once: a placed photo is stored with its metadata; the others (to place, being solved) go to the
 * gallery as waiting photos, with theirs. A photo that cannot be stored stays in the list; its reason is returned.
 * The files that could not be read leave the list.
 */
export async function importAll(): Promise<{
  stored: Photo[];
  errors: { name: string; message: string }[];
}> {
  const stored: Photo[] = [];
  const errors: { name: string; message: string }[] = [];
  storing.value = true;
  try {
    for (const photo of importPhotos.value) {
      try {
        if (photo.state === 'placed') stored.push(await storePendingPhoto(photo.id));
        else await leaveImport(photo.id);
      } catch (error) {
        errors.push({ name: photo.name, message: messageOf(error) });
      }
    }
    reading.value = reading.value.filter((f) => f.status === 'converting');
  } finally {
    storing.value = false;
  }
  return { stored, errors };
}

/** Gives the import up: its photos are forgotten, nothing is added. */
export async function discardImport(): Promise<void> {
  reading.value = [];
  for (const photo of importPhotos.value) await removePendingPhoto(photo.id);
}

/** Empties the list of files being read (tests). */
export function resetImport(): void {
  reading.value = [];
}
