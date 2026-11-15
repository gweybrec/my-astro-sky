/**
 * The photos that are imported but not on the sky yet: waiting for a placement method ("À placer") or being solved
 * online ("Résolution"). The photo store only takes a photo with its placement, so until then the phone keeps the
 * picture itself, in the WebView's own database (IndexedDB, in the app's private data), with a small record. Once a
 * photo is placed it is stored as an ordinary photo and leaves this list.
 */
import { shallowRef } from 'vue';
import type {
  CaptureDetails,
  ManualPlacement,
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
} from '@myastrosky/core/types';
import type { FitsCard } from '@myastrosky/core/fits-header';
import { sanitizeCaptureDetails } from '@myastrosky/core/capture-fields';
import { setPhotoFitsHeaders, uploadPhoto } from '@myastrosky/app-state/api';

/**
 * `toPlace`: needs a placement method. `solving`: sent to the online solver. `offline`: sent, but its following stopped
 * for want of the network (astrometry.net goes on). `failed`: the solve did not succeed. `unfinished`: astrometry.net
 * had not finished when the app stopped following it; its solution is reused later ("Réutiliser une solution
 * astrometry.net").
 */
export type PendingState = 'toPlace' | 'solving' | 'offline' | 'failed' | 'unfinished';

export interface PendingPhoto {
  id: string;
  /** The file's name as it was picked. */
  name: string;
  state: PendingState;
  /** When it was imported (milliseconds); the list is in this order. */
  addedAt: number;
  /** The online solver's job, while the photo is being solved. */
  jobId?: string;
  /** The astrometry.net submission of that job: it is followed again under a new job after a restart. */
  submissionId?: number;
  /** Why the solve did not succeed. */
  error?: string;
}

/**
 * What the file of a waiting photo said besides its picture (a TIFF/FITS/XISF without a plate solution): its capture
 * data, the saved setup its header points to, and its header cards. Given to the photo when it is placed.
 */
export interface PendingCapture {
  integrations?: PhotoIntegration[];
  observationDate?: string;
  captureDetails?: CaptureDetails;
  gearSetupId?: string | null;
  fitsHeaders?: FitsCard[];
}

interface StoredPending extends PendingPhoto {
  picture: Blob;
  solvePicture?: Blob;
  solveName?: string;
  solveType?: string;
  capture?: PendingCapture;
}

/** Where the records and their pictures are kept. */
export interface PendingStore {
  all(): Promise<StoredPending[]>;
  /** One record, without reading the others; undefined when it is not kept. */
  get(id: string): Promise<StoredPending | undefined>;
  put(record: StoredPending): Promise<void>;
  delete(id: string): Promise<void>;
}

const DB_NAME = 'myastrosky-pending-photos';
const STORE = 'photos';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** The store in the WebView's database. */
export function createIndexedDbPendingStore(factory: IDBFactory): PendingStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    });
    return opened;
  };
  const store = async (mode: IDBTransactionMode) =>
    (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    all: async () => request<StoredPending[]>((await store('readonly')).getAll()),
    get: async (id) => request<StoredPending | undefined>((await store('readonly')).get(id)),
    put: async (record) => void (await request((await store('readwrite')).put(record))),
    delete: async (id) => void (await request((await store('readwrite')).delete(id))),
  };
}

/** A store that lasts as long as the page (tests, and a browser without a database). */
export function createMemoryPendingStore(): PendingStore {
  const records = new Map<string, StoredPending>();
  return {
    all: async () => [...records.values()],
    get: async (id) => records.get(id),
    put: async (record) => void records.set(record.id, record),
    delete: async (id) => void records.delete(id),
  };
}

let store: PendingStore =
  typeof indexedDB === 'undefined'
    ? createMemoryPendingStore()
    : createIndexedDbPendingStore(indexedDB);

/** Replaces the store (tests). */
export function configurePendingStore(next: PendingStore): void {
  store = next;
  pendingPhotos.value = [];
}

/** The photos waiting to be placed, oldest first. Filled by `loadPendingPhotos`. */
export const pendingPhotos = shallowRef<PendingPhoto[]>([]);

const recordOf = ({
  picture: _picture,
  solvePicture: _solvePicture,
  solveName: _solveName,
  solveType: _solveType,
  capture: _capture,
  ...record
}: StoredPending): PendingPhoto => record;

/** Reads the list again from the store. */
export async function loadPendingPhotos(): Promise<void> {
  const all = await store.all();
  pendingPhotos.value = all.sort((a, b) => a.addedAt - b.addedAt).map(recordOf);
}

/** Keeps a picture that has no placement yet, with what its file said (`capture`), if anything. */
export async function addPendingPhoto(
  picture: Blob,
  name: string,
  capture?: PendingCapture,
  solveFile?: File,
): Promise<PendingPhoto> {
  const record: StoredPending = {
    id: crypto.randomUUID(),
    name,
    state: 'toPlace',
    addedAt: Date.now(),
    picture,
    ...(solveFile
      ? {
          solvePicture: solveFile,
          solveName: solveFile.name,
          solveType: solveFile.type,
        }
      : {}),
    ...(capture ? { capture } : {}),
  };
  await store.put(record);
  const added = recordOf(record);
  pendingPhotos.value = [...pendingPhotos.value, added];
  return added;
}

const PICTURE_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

/**
 * The name of a kept picture: the file's name, with the extension of what is kept. A TIFF/FITS/XISF is kept as the
 * PNG made from it, and the photo store and the solvers read a file by its extension.
 */
export function pictureName(name: string, type: string): string {
  const extensions = PICTURE_EXTENSIONS[type];
  if (!extensions) return name;
  const lower = name.toLowerCase();
  if (extensions.some((ext) => lower.endsWith(ext))) return name;
  return `${stripExtension(name)}${extensions[0]}`;
}

/** The picture of a waiting photo as a file to place or solve; null when it is no longer kept. */
export async function pendingPhotoFile(id: string): Promise<File | null> {
  const found = await store.get(id);
  return found
    ? new File([found.picture], pictureName(found.name, found.picture.type), {
        type: found.picture.type,
      })
    : null;
}

/** The original raw file for astrometry.net, or the kept picture when there is no separate solve file. */
export async function pendingPhotoSolveFile(id: string): Promise<File | null> {
  const found = await store.get(id);
  if (!found) return null;
  return found.solvePicture
    ? new File([found.solvePicture], found.solveName ?? found.name, {
        type: found.solveType ?? '',
      })
    : new File([found.picture], pictureName(found.name, found.picture.type), {
        type: found.picture.type,
      });
}

/** Changes where a waiting photo stands; the solver's job, its submission and the failure reason are those given, or none. */
export async function setPendingState(
  id: string,
  state: PendingState,
  details: { jobId?: string; submissionId?: number; error?: string } = {},
): Promise<void> {
  const found = await store.get(id);
  if (!found) return;
  const { jobId: _jobId, submissionId: _submissionId, error: _error, ...kept } = found;
  const next: StoredPending = { ...kept, state, ...details };
  await store.put(next);
  const record = recordOf(next);
  pendingPhotos.value = pendingPhotos.value.map((p) => (p.id === id ? record : p));
}

/** Forgets a waiting photo (it was placed, or removed). */
export async function removePendingPhoto(id: string): Promise<void> {
  await store.delete(id);
  pendingPhotos.value = pendingPhotos.value.filter((p) => p.id !== id);
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Stores a waiting photo once it is placed (its reference points, or a hand placement), with the objects found in it
 * and what its file said (capture data, setup, header cards), then forgets it here. The header cards are informative:
 * the photo stays stored when they cannot be saved.
 */
export async function storePlacedPendingPhoto(
  id: string,
  file: File,
  correspondences: PhotoCorrespondence[],
  manualPlacement: ManualPlacement | undefined,
  dsoIds: string[],
): Promise<Photo> {
  const capture = (await store.get(id))?.capture;
  const captureDetails = capture?.captureDetails
    ? sanitizeCaptureDetails(capture.captureDetails)
    : null;
  const photo = await uploadPhoto(file, correspondences, manualPlacement, undefined, {
    dsoIds,
    displayName: stripExtension(file.name),
    ...(capture?.integrations?.length ? { integrations: capture.integrations } : {}),
    ...(capture?.observationDate ? { observationDate: capture.observationDate } : {}),
    ...(captureDetails ? { captureDetails } : {}),
    ...(capture?.gearSetupId ? { gearSetupId: capture.gearSetupId } : {}),
  });
  let stored = photo;
  if (capture?.fitsHeaders?.length) {
    try {
      await setPhotoFitsHeaders(photo.id, capture.fitsHeaders);
      stored = { ...photo, hasFitsHeaders: true };
    } catch {
      // The photo is placed; only its header cards are missing.
    }
  }
  await removePendingPhoto(id);
  return stored;
}
