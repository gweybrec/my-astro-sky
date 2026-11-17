/**
 * Saving a photo of "Ajouter des photos" ("Enregistrer N photos"). A photo never saved is stored, placed or not: one not
 * placed waits "À résoudre" in the gallery, with its astrometry.net solve when one runs or waits, so that the result is
 * fetched later without a new upload. A photo saved then changed ("À réenregistrer") gets its metadata again, and its
 * placement when it was placed (or placed again) since. The window stays open; nothing here closes it.
 */
import type {
  CaptureDetails,
  ManualPlacement,
  OnlineSolve,
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
} from '@myastrosky/core/types';
import type { FitsCard } from '@myastrosky/core/fits-header';
import { sanitizeCaptureDetails } from '@myastrosky/core/capture-fields';
import type { BatchItem } from './batch-types';
import { isItemPlaced, sanitizeIntegrationRows } from './batch-utils';

interface PhotoMetadata {
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  notes: string;
  observationDate: string | null;
  captureDetails: CaptureDetails | null;
  gearSetupId: string | null;
}

/** What saving needs of the backend (the functions of `api.ts`; tests give their own). */
export interface BatchSaveApi {
  upload(
    file: File,
    correspondences: PhotoCorrespondence[],
    manualPlacement?: ManualPlacement,
    onProgress?: undefined,
    metadata?: PhotoMetadata & { displayName?: string; onlineSolve?: OnlineSolve | null },
  ): Promise<Photo>;
  updateMetadata(
    photoId: string,
    metadata: PhotoMetadata & { originalName?: string },
  ): Promise<void>;
  setPlacement(
    photoId: string,
    placement: {
      correspondences?: PhotoCorrespondence[];
      manualPlacement?: ManualPlacement | null;
    },
  ): Promise<Photo>;
  setOnlineSolve(photoId: string, solve: OnlineSolve | null): Promise<void>;
  /** Stores the header cards of the file the item's data was read from (informative: a failure is ignored). */
  saveFitsHeaders?(photoId: string, cards: FitsCard[]): Promise<void>;
}

function metadataOf(item: BatchItem): PhotoMetadata {
  const captureDetails = sanitizeCaptureDetails(item.captureDetails);
  return {
    dsoIds: [...item.dsoIds],
    labels: [...item.labels],
    pointsOfInterest: item.pointsOfInterest.map((p) => ({ ...p })),
    integrations: sanitizeIntegrationRows(item.integrations),
    notes: item.notes,
    observationDate: item.observationDate || null,
    captureDetails: Object.keys(captureDetails).length ? captureDetails : null,
    gearSetupId: item.gearSetupId || null,
  };
}

/** The online solve kept with a photo not placed: while astrometry.net runs or has not finished; none otherwise. */
export function onlineSolveOf(item: BatchItem): OnlineSolve | null {
  if (isItemPlaced(item) || !item.online?.submissionId) return null;
  if (item.status !== 'unfinished' && item.status !== 'solving') return null;
  const o = item.online;
  return {
    state: item.status === 'solving' ? 'solving' : 'unfinished',
    submissionId: o.submissionId,
    sentAt: o.sentAt,
    ...(o.jobId ? { jobId: o.jobId } : {}),
    ...(o.checkedAt ? { checkedAt: o.checkedAt } : {}),
    ...(o.fits ? { fits: true } : {}),
  };
}

/**
 * Saves one item and returns the stored photo; the item is then "saved". On a failure the item keeps its state and
 * the reason (`saveError`), and the error is thrown again.
 */
export async function saveBatchItem(item: BatchItem, api: BatchSaveApi): Promise<Photo> {
  const before = item.saveState;
  item.saveState = 'saving';
  delete item.saveError;
  const placed = isItemPlaced(item);
  const metadata = metadataOf(item);
  try {
    let photo: Photo;
    if (!item.photo) {
      // The online solve goes with the photo, in the same request: a photo is never stored without it.
      const solve = onlineSolveOf(item);
      photo = await api.upload(
        item.file,
        placed ? (item.solveCorrespondences ?? []) : [],
        placed ? (item.manualPlacement ?? undefined) : undefined,
        undefined,
        { ...metadata, displayName: item.customName, ...(solve ? { onlineSolve: solve } : {}) },
      );
      if (item.fitsHeaders?.length && api.saveFitsHeaders) {
        try {
          await api.saveFitsHeaders(photo.id, item.fitsHeaders);
          photo = { ...photo, hasFitsHeaders: true };
        } catch {
          // The photo is stored; only its header cards are missing (they are informative).
        }
      }
    } else {
      const originalName = item.customName.trim() || item.photo.originalName;
      await api.updateMetadata(item.photo.id, { ...metadata, originalName });
      photo = { ...item.photo, ...metadata, originalName };
      if (placed && !item.placementSaved) {
        const stored = await api.setPlacement(item.photo.id, {
          correspondences: item.solveCorrespondences ?? [],
          manualPlacement: item.manualPlacement ?? null,
        });
        photo = { ...stored, ...metadata, originalName };
      } else if (!placed) {
        const solve = onlineSolveOf(item);
        if (JSON.stringify(solve) !== JSON.stringify(item.photo.onlineSolve ?? null)) {
          await api.setOnlineSolve(item.photo.id, solve);
        }
        photo = solve ? { ...photo, onlineSolve: solve } : withoutSolve(photo);
      }
      if (item.fitsHeaders?.length && !item.photo.hasFitsHeaders && api.saveFitsHeaders) {
        try {
          await api.saveFitsHeaders(item.photo.id, item.fitsHeaders);
          photo = { ...photo, hasFitsHeaders: true };
        } catch {
          // Informative only.
        }
      }
    }
    item.photo = photo;
    item.saveState = 'saved';
    item.placementSaved = placed;
    return photo;
  } catch (err) {
    item.saveState = before;
    item.saveError = (err as Error)?.message || String(err);
    throw err;
  }
}

function withoutSolve(photo: Photo): Photo {
  const { onlineSolve: _solve, ...rest } = photo;
  return rest;
}
