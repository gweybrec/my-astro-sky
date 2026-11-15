/**
 * The photos that are imported but not stored yet: in the list of "Importer des photos" (`inImport`), waiting for a
 * placement method ("À placer"), being solved online ("Résolution"), or placed but not saved yet (`placed`, board "Photo
 * à ajouter, placée"). The photo store only takes a photo with its placement, so until then the phone keeps the
 * picture itself, in the WebView's own database (IndexedDB, in the app's private data), with a small record, the
 * metadata typed for it (`draft`) and the placement found for it (`placement`). Once stored it is an ordinary photo
 * and leaves this list.
 */
import { shallowRef, toRaw } from 'vue';
import type {
  CaptureDetails,
  ManualPlacement,
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
} from '@myastrosky/core/types';
import type { FitsCard } from '@myastrosky/core/fits-header';
import { draftToMetadata, type PhotoMetadataDraft } from '@myastrosky/core/photo-metadata-draft';
import { setPhotoFitsHeaders, uploadPhoto } from '@myastrosky/app-state/api';

/**
 * `toPlace`: needs a placement method. `solving`: sent to the online solver. `offline`: sent, but its following stopped
 * for want of the network (astrometry.net goes on). `failed`: the solve did not succeed. `unfinished`: astrometry.net
 * had not finished when the app stopped following it; its solution is reused later ("Réutiliser une solution
 * astrometry.net"). `placed`: a placement is held (`placedBy`); Importer or Enregistrer stores the photo.
 */
export type PendingState = 'toPlace' | 'solving' | 'offline' | 'failed' | 'unfinished' | 'placed';

/** How a held placement was found: the file's own WCS, by hand on the map, by naming stars, or by astrometry.net. */
export type PlacedBy = 'file' | 'hand' | 'stars' | 'solved';

/** A placement found for a waiting photo, kept until the photo is stored. */
export interface HeldPlacement {
  correspondences: PhotoCorrespondence[];
  manualPlacement?: ManualPlacement;
  /** The objects that fall in the photo, added to the typed ones when it is stored. */
  dsoIds: string[];
  by: PlacedBy;
}

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
  /** In the list of "Importer des photos": not shown in the gallery until Importer. */
  inImport?: boolean;
  /** A raw file read without a plate solution: only its capture data was taken. */
  noSolution?: boolean;
  /** How the held placement was found (state `placed`). */
  placedBy?: PlacedBy;
  /** The number of named stars of a placement `stars`. */
  starCount?: number;
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
  draft?: PhotoMetadataDraft;
  placement?: HeldPlacement;
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
  draft: _draft,
  placement,
  ...record
}: StoredPending): PendingPhoto => {
  const { placedBy: _placedBy, starCount: _starCount, ...rest } = record;
  if (!placement) return rest;
  return {
    ...rest,
    placedBy: placement.by,
    ...(placement.by === 'stars' ? { starCount: placement.correspondences.length } : {}),
  };
};

/** The phone's database stores no Vue proxy: what a form or a list holds is copied as plain data. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T;

let firstLoad = true;

/** Reads the list from the store again on the next `loadPendingPhotos`, as at start-up (tests). */
export function resetPendingLoad(): void {
  firstLoad = true;
}

/**
 * Reads the list again from the store. On the first reading, the photos left in an import when the app stopped go to
 * the gallery, with their metadata and placement: the import list starts empty.
 */
export async function loadPendingPhotos(): Promise<void> {
  const all = await store.all();
  if (firstLoad) {
    firstLoad = false;
    for (const record of all) {
      if (!record.inImport) continue;
      record.inImport = false;
      await store.put(record);
    }
  }
  pendingPhotos.value = all.sort((a, b) => a.addedAt - b.addedAt).map(recordOf);
}

/** What a waiting photo is kept with besides its picture. */
export interface PendingOptions {
  inImport?: boolean;
  /** The placement its file gives (a solved TIFF/FITS/XISF): the photo is `placed` at once. */
  placement?: HeldPlacement;
  noSolution?: boolean;
  /** Its place in the lists (the moment it was picked); now by default. */
  addedAt?: number;
  /** The objects its file names, put in its metadata. */
  dsoIds?: string[];
}

/** Keeps a picture that is not stored yet, with what its file said (`capture`), if anything. */
export async function addPendingPhoto(
  picture: Blob,
  name: string,
  capture?: PendingCapture,
  solveFile?: File,
  options: PendingOptions = {},
): Promise<PendingPhoto> {
  const record: StoredPending = {
    id: crypto.randomUUID(),
    name,
    state: options.placement ? 'placed' : 'toPlace',
    addedAt: options.addedAt ?? Date.now(),
    ...(options.inImport ? { inImport: true } : {}),
    ...(options.noSolution ? { noSolution: true } : {}),
    ...(options.placement ? { placement: plain(options.placement) } : {}),
    draft: draftOf(name, capture, options.dsoIds),
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
  pendingPhotos.value = [...pendingPhotos.value, added].sort((a, b) => a.addedAt - b.addedAt);
  return added;
}

/** The metadata a new waiting photo starts with: its name, and what its file said. */
function draftOf(
  name: string,
  capture?: PendingCapture,
  dsoIds: string[] = [],
): PhotoMetadataDraft {
  return {
    displayName: stripExtension(name),
    dsoIds: [...dsoIds],
    labels: [],
    pointsOfInterest: [],
    integrations: capture?.integrations ? capture.integrations.map((row) => ({ ...row })) : [],
    observationDate: capture?.observationDate ?? '',
    captureDetails: capture?.captureDetails ? { ...capture.captureDetails } : {},
    gearSetupId: capture?.gearSetupId ?? null,
    notes: '',
  };
}

/** The metadata typed for a waiting photo; null when it is no longer kept. */
export async function pendingDraft(id: string): Promise<PhotoMetadataDraft | null> {
  const found = await store.get(id);
  if (!found) return null;
  return found.draft ?? draftOf(found.name, found.capture);
}

/** Keeps the metadata typed for a waiting photo. */
export async function setPendingDraft(id: string, draft: PhotoMetadataDraft): Promise<void> {
  const found = await store.get(id);
  if (!found) return;
  await store.put({ ...found, draft: plain(draft) });
}

/** Keeps the header cards of a file read for a waiting photo ("Charger un fichier WCS"), saved with it once stored. */
export async function setPendingFitsHeaders(id: string, cards: FitsCard[]): Promise<void> {
  const found = await store.get(id);
  if (!found) return;
  await store.put({ ...found, capture: { ...found.capture, fitsHeaders: plain(cards) } });
}

/** The placement held for a waiting photo; null when it has none. */
export async function pendingPlacement(id: string): Promise<HeldPlacement | null> {
  return (await store.get(id))?.placement ?? null;
}

/** Holds the placement found for a waiting photo: it is `placed`, not stored yet. */
export async function holdPendingPlacement(id: string, placement: HeldPlacement): Promise<void> {
  const found = await store.get(id);
  if (!found) return;
  const { jobId: _jobId, submissionId: _submissionId, error: _error, ...kept } = found;
  const next: StoredPending = { ...kept, state: 'placed', placement: plain(placement) };
  await store.put(next);
  const record = recordOf(next);
  pendingPhotos.value = pendingPhotos.value.map((p) => (p.id === id ? record : p));
}

/** Takes a photo out of the import list: the gallery shows it as a waiting photo. */
export async function leaveImport(id: string): Promise<void> {
  const found = await store.get(id);
  if (!found?.inImport) return;
  const next: StoredPending = { ...found, inImport: false };
  await store.put(next);
  const record = recordOf(next);
  pendingPhotos.value = pendingPhotos.value.map((p) => (p.id === id ? record : p));
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
  // A placement is held only while the photo is `placed`.
  const { placement: _placement, ...unplaced } = kept;
  const next: StoredPending = { ...(state === 'placed' ? kept : unplaced), state, ...details };
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
 * Stores a waiting photo with its held placement, the metadata typed for it (the objects found in it added) and what its
 * file said (header cards), then forgets it here. The header cards are informative: the photo stays stored when they
 * cannot be saved. Fails when the photo has no placement.
 */
export async function storePendingPhoto(id: string): Promise<Photo> {
  const found = await store.get(id);
  if (!found?.placement) throw new Error(`No placement for the waiting photo ${id}`);
  const { placement, capture } = found;
  const file = new File([found.picture], pictureName(found.name, found.picture.type), {
    type: found.picture.type,
  });
  const metadata = draftToMetadata(
    found.draft ?? draftOf(found.name, capture),
    stripExtension(found.name),
  );
  const captureDetails = Object.keys(metadata.captureDetails).length
    ? metadata.captureDetails
    : null;
  const photo = await uploadPhoto(
    file,
    placement.correspondences,
    placement.manualPlacement,
    undefined,
    {
      dsoIds: [...new Set([...metadata.dsoIds, ...placement.dsoIds])],
      labels: metadata.labels,
      pointsOfInterest: metadata.pointsOfInterest,
      integrations: metadata.integrations,
      notes: metadata.notes,
      displayName: metadata.originalName,
      observationDate: metadata.observationDate,
      captureDetails,
      gearSetupId: metadata.gearSetupId,
    },
  );
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
