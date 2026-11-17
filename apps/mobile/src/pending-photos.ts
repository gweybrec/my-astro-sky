/**
 * The photos being worked on before they are saved, kept in memory: those of "Importer des photos" (`inImport`), and a
 * photo of the gallery stored without a placement ("À résoudre") while its page "Photo à ajouter" and its placement methods
 * are open (`storedId`, its record has the stored photo's id). Each keeps its picture, the metadata typed for it (`draft`)
 * and the placement found for it (`placement`). Saving stores it in the photo store, placed or not: a photo not placed
 * waits "À résoudre" in the gallery, with its astrometry.net solve when one runs or waits (`Photo.onlineSolve`), followed
 * again later by `@myastrosky/app-state/stored-solve`.
 */
import { shallowRef, toRaw } from 'vue';
import type {
  CaptureDetails,
  ManualPlacement,
  OnlineSolve,
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
} from '@myastrosky/core/types';
import type { FitsCard } from '@myastrosky/core/fits-header';
import {
  draftFromPhoto,
  draftToMetadata,
  type PhotoMetadataDraft,
} from '@myastrosky/core/photo-metadata-draft';
import {
  setPhotoFitsHeaders,
  setPhotoOnlineSolve,
  setPhotoPlacement,
  storedPhotoFile,
  updatePhotoMetadata,
  uploadPhoto,
} from '@myastrosky/app-state/api';

/**
 * `toPlace`: needs a placement method. `solving`: sent to the online solver. `offline`: sent, but its following stopped
 * for want of the network (astrometry.net goes on). `failed`: the solve did not succeed. `unfinished`: astrometry.net
 * had not finished when the app stopped following it ("En cours"); its result is fetched later. `placed`: a placement is
 * held (`placedBy`); Importer or Enregistrer stores it.
 */
export type PendingState = 'toPlace' | 'solving' | 'offline' | 'failed' | 'unfinished' | 'placed';

/** How a held placement was found: the file's own WCS, by hand on the map, by naming stars, or by astrometry.net. */
export type PlacedBy = 'file' | 'hand' | 'stars' | 'solved';

/** A placement found for a photo, kept until it is saved. */
export interface HeldPlacement {
  correspondences: PhotoCorrespondence[];
  manualPlacement?: ManualPlacement;
  /** The objects that fall in the photo, added to the typed ones when it is saved. */
  dsoIds: string[];
  by: PlacedBy;
}

export interface PendingPhoto {
  id: string;
  /** The file's name as it was picked (a stored photo: its name). */
  name: string;
  state: PendingState;
  /** When it was imported (milliseconds); the list is in this order. */
  addedAt: number;
  /** The online solver's job, while the photo is being solved. */
  jobId?: string;
  /** The astrometry.net submission of that job: it is followed again under a new job. */
  submissionId?: number;
  /** When the picture was sent to astrometry.net (ISO date). */
  sentAt?: string;
  /** The picture sent was a FITS file (its rows count from the bottom). */
  fits?: boolean;
  /** Why the solve did not succeed. */
  error?: string;
  /** In the list of "Importer des photos": stored with the others by Importer. */
  inImport?: boolean;
  /** The stored photo this record stands for (a gallery photo "À résoudre"); Enregistrer saves it again. */
  storedId?: string;
  /** A raw file read without a plate solution: only its capture data was taken. */
  noSolution?: boolean;
  /** How the held placement was found (state `placed`). */
  placedBy?: PlacedBy;
  /** The number of named stars of a placement `stars`. */
  starCount?: number;
}

/**
 * What the file of a photo said besides its picture (a TIFF/FITS/XISF without a plate solution): its capture data, the
 * saved setup its header points to, and its header cards. Given to the photo when it is saved.
 */
export interface PendingCapture {
  integrations?: PhotoIntegration[];
  observationDate?: string;
  captureDetails?: CaptureDetails;
  gearSetupId?: string | null;
  fitsHeaders?: FitsCard[];
}

interface PendingRecord extends PendingPhoto {
  picture: Blob;
  solvePicture?: File;
  capture?: PendingCapture;
  draft?: PhotoMetadataDraft;
  placement?: HeldPlacement;
  /** The stored photo, for a record that stands for one. */
  stored?: Photo;
}

const records = new Map<string, PendingRecord>();

/** The photos being worked on, oldest first. */
export const pendingPhotos = shallowRef<PendingPhoto[]>([]);

const recordOf = ({
  picture: _picture,
  solvePicture: _solvePicture,
  capture: _capture,
  draft: _draft,
  placement,
  stored: _stored,
  ...record
}: PendingRecord): PendingPhoto => {
  const { placedBy: _placedBy, starCount: _starCount, ...rest } = record;
  if (!placement) return rest;
  return {
    ...rest,
    placedBy: placement.by,
    ...(placement.by === 'stars' ? { starCount: placement.correspondences.length } : {}),
  };
};

function publish() {
  pendingPhotos.value = [...records.values()].sort((a, b) => a.addedAt - b.addedAt).map(recordOf);
}

/** Forgets every record (tests). */
export function resetPendingPhotos(): void {
  records.clear();
  pendingPhotos.value = [];
}

/** The phone's database stores no Vue proxy: what a form or a list holds is copied as plain data. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T;

/** What a new photo is kept with besides its picture. */
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
  const record: PendingRecord = {
    id: crypto.randomUUID(),
    name,
    state: options.placement ? 'placed' : 'toPlace',
    addedAt: options.addedAt ?? Date.now(),
    ...(options.inImport ? { inImport: true } : {}),
    ...(options.noSolution ? { noSolution: true } : {}),
    ...(options.placement ? { placement: plain(options.placement) } : {}),
    draft: draftOf(name, capture, options.dsoIds),
    picture,
    ...(solveFile ? { solvePicture: solveFile } : {}),
    ...(capture ? { capture } : {}),
  };
  records.set(record.id, record);
  publish();
  return recordOf(record);
}

/** The state a stored photo's online solve gives its record. */
function stateOfSolve(solve: OnlineSolve | undefined): PendingState {
  if (!solve) return 'toPlace';
  return solve.state;
}

/**
 * Opens a stored photo "À résoudre" for its page: its record has the photo's id, its picture is read from the store, and
 * its astrometry.net solve (if any) comes with it. A record already open is kept as it is.
 */
export async function openStoredPhoto(photo: Photo): Promise<PendingPhoto> {
  const open = records.get(photo.id);
  if (open) return recordOf(open);
  const picture = await storedPhotoFile(photo);
  const solve = photo.onlineSolve;
  const record: PendingRecord = {
    id: photo.id,
    name: photo.originalName,
    state: stateOfSolve(solve),
    addedAt: Date.parse(photo.createdAt) || Date.now(),
    storedId: photo.id,
    stored: photo,
    picture,
    draft: draftFromPhoto(photo),
    ...(solve?.submissionId ? { submissionId: solve.submissionId } : {}),
    ...(solve?.jobId ? { jobId: solve.jobId } : {}),
    ...(solve?.sentAt ? { sentAt: solve.sentAt } : {}),
    ...(solve?.fits ? { fits: true } : {}),
    ...(solve?.error ? { error: solve.error } : {}),
  };
  records.set(record.id, record);
  publish();
  return recordOf(record);
}

/** The metadata a new photo starts with: its name, and what its file said. */
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

/** The metadata typed for a photo; null when it is not kept. */
export async function pendingDraft(id: string): Promise<PhotoMetadataDraft | null> {
  const found = records.get(id);
  if (!found) return null;
  return found.draft ?? draftOf(found.name, found.capture);
}

/** Keeps the metadata typed for a photo. */
export async function setPendingDraft(id: string, draft: PhotoMetadataDraft): Promise<void> {
  const found = records.get(id);
  if (found) found.draft = plain(draft);
}

/** Keeps the header cards of a file read for a photo ("Charger un fichier WCS"), saved with it. */
export async function setPendingFitsHeaders(id: string, cards: FitsCard[]): Promise<void> {
  const found = records.get(id);
  if (found) found.capture = { ...found.capture, fitsHeaders: plain(cards) };
}

/** The placement held for a photo; null when it has none. */
export async function pendingPlacement(id: string): Promise<HeldPlacement | null> {
  return records.get(id)?.placement ?? null;
}

/** Holds the placement found for a photo: it is `placed`, not stored yet. */
export async function holdPendingPlacement(id: string, placement: HeldPlacement): Promise<void> {
  const found = records.get(id);
  if (!found) return;
  delete found.jobId;
  delete found.submissionId;
  delete found.error;
  delete found.sentAt;
  found.state = 'placed';
  found.placement = plain(placement);
  publish();
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

const pictureOf = (found: PendingRecord) =>
  new File([found.picture], pictureName(found.name, found.picture.type), {
    type: found.picture.type,
  });

/** The picture of a photo as a file to place or solve; null when it is not kept. */
export async function pendingPhotoFile(id: string): Promise<File | null> {
  const found = records.get(id);
  return found ? pictureOf(found) : null;
}

/** The original raw file for astrometry.net, or the kept picture when there is no separate solve file. */
export async function pendingPhotoSolveFile(id: string): Promise<File | null> {
  const found = records.get(id);
  if (!found) return null;
  return found.solvePicture ?? pictureOf(found);
}

/** The online solve a photo not placed is stored with, or null (none, or nothing astrometry.net still has). */
export function onlineSolveOf(p: PendingPhoto): OnlineSolve | null {
  if (p.state === 'toPlace' || p.state === 'placed') return null;
  if (p.state !== 'failed' && !p.submissionId) return null;
  return {
    state: p.state,
    sentAt: p.sentAt ?? new Date().toISOString(),
    ...(p.submissionId ? { submissionId: p.submissionId } : {}),
    ...(p.jobId ? { jobId: p.jobId } : {}),
    ...(p.fits ? { fits: true } : {}),
    ...(p.error ? { error: p.error } : {}),
  };
}

/**
 * Changes where a photo stands; the solver's job, its submission and the failure reason are those given, or none. A
 * stored photo keeps its solve with it, so that it is followed again if the app stops.
 */
export async function setPendingState(
  id: string,
  state: PendingState,
  details: {
    jobId?: string;
    submissionId?: number;
    error?: string;
    sentAt?: string;
    fits?: boolean;
  } = {},
): Promise<void> {
  const found = records.get(id);
  if (!found) return;
  delete found.jobId;
  delete found.submissionId;
  delete found.error;
  // A placement is held only while the photo is `placed`.
  if (state !== 'placed') delete found.placement;
  Object.assign(found, { state }, details);
  publish();
  if (found.storedId && state !== 'placed') {
    await setPhotoOnlineSolve(found.storedId, onlineSolveOf(found));
  }
}

/** Forgets a photo here (saved, given up, or deleted). */
export async function removePendingPhoto(id: string): Promise<void> {
  records.delete(id);
  publish();
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Saves a photo with the metadata typed for it (the objects found in it added), its held placement if it has one, and
 * what its file said (header cards), then forgets it here. A new photo is stored, placed or not; a stored one ("À
 * placer") gets its metadata and, once placed, its placement. The header cards are informative: the photo stays saved
 * when they cannot be.
 */
export async function storePendingPhoto(id: string): Promise<Photo> {
  const found = records.get(id);
  if (!found) throw new Error(`No photo ${id} to save`);
  const { placement, capture } = found;
  const metadata = draftToMetadata(
    found.draft ?? draftOf(found.name, capture),
    stripExtension(found.name),
  );
  const dsoIds = [...new Set([...metadata.dsoIds, ...(placement?.dsoIds ?? [])])];
  const captureDetails = Object.keys(metadata.captureDetails).length
    ? metadata.captureDetails
    : null;
  let photo: Photo;
  if (found.storedId) {
    await updatePhotoMetadata(found.storedId, { ...metadata, dsoIds, captureDetails });
    photo = { ...found.stored!, ...metadata, dsoIds, captureDetails };
    if (placement) {
      const placed = await setPhotoPlacement(found.storedId, {
        correspondences: placement.correspondences,
        manualPlacement: placement.manualPlacement ?? null,
      });
      photo = { ...placed, ...metadata, dsoIds, captureDetails };
    }
  } else {
    // The online solve goes with the photo, in the same request: a photo is never stored without it.
    const solve = placement ? null : onlineSolveOf(found);
    photo = await uploadPhoto(
      pictureOf(found),
      placement?.correspondences ?? [],
      placement?.manualPlacement,
      undefined,
      {
        dsoIds,
        labels: metadata.labels,
        pointsOfInterest: metadata.pointsOfInterest,
        integrations: metadata.integrations,
        notes: metadata.notes,
        displayName: metadata.originalName,
        observationDate: metadata.observationDate,
        captureDetails,
        gearSetupId: metadata.gearSetupId,
        ...(solve ? { onlineSolve: solve } : {}),
      },
    );
  }
  if (capture?.fitsHeaders?.length && !found.stored?.hasFitsHeaders) {
    try {
      await setPhotoFitsHeaders(photo.id, capture.fitsHeaders);
      photo = { ...photo, hasFitsHeaders: true };
    } catch {
      // The photo is saved; only its header cards are missing.
    }
  }
  await removePendingPhoto(id);
  return photo;
}
