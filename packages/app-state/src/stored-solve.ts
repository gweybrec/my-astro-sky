/**
 * The astrometry.net solve of a photo stored without a placement ("À résoudre"). The solve goes on on astrometry.net's
 * server whatever the app does, so its submission is kept with the photo (`Photo.onlineSolve`) and asked about again
 * later, once each time: at start-up on the desktop, whenever the gallery is shown on the phone. "Récupérer le résultat
 * d'astrometry.net" follows it for up to 15 minutes. Nothing is uploaded again. A
 * solved photo is placed at once (the stored photo gets its placement and the objects found in it); otherwise the photo
 * keeps where the solve stands: `unfinished` ("En cours"), `offline` or `failed`. Shared by the desktop and the phone.
 */
import { findDSOIdsFromCorrespondences } from '@myastrosky/core/catalog/dso-registry';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { OnlineSolve, Photo, PhotoCorrespondence } from '@myastrosky/core/types';
import {
  pollPlateSolve,
  resumePlateSolve,
  setPhotoOnlineSolve,
  setPhotoPlacement,
  updatePhotoMetadata,
} from './api';

/** How often a job is asked where it stands. */
export const STORED_SOLVE_POLL_MS = 2000;

/** The states of a solve that is followed again; `failed` waits for the user. */
const FOLLOWED: ReadonlySet<OnlineSolve['state']> = new Set(['solving', 'unfinished', 'offline']);

/** The errors that mean astrometry.net is out of reach for now: no network, a bad answer, or no code at all. */
const TRANSIENT_CODES = new Set([undefined, 'NETWORK_ERROR', 'NETWORK_TIMEOUT', 'HTTP_ERROR']);

const following = new Set<string>();

/** This photo's solve is being followed now (a screen does not start it a second time). */
export function isFollowingStoredSolve(photoId: string): boolean {
  return following.has(photoId);
}

/** The photo's solve can be followed again: it has a submission and is not given up. */
export function canFollowStoredSolve(photo: Pick<Photo, 'onlineSolve'>): boolean {
  const solve = photo.onlineSolve;
  return !!solve?.submissionId && FOLLOWED.has(solve.state);
}

export interface StoredSolveOptions {
  /**
   * Asks astrometry.net once where the solve stands instead of following it for up to 15 minutes: a solve it has not
   * finished stays "En cours" (`unfinished`) and is asked again next time.
   */
  quick?: boolean;
  /** Called each time the photo changes (the solve's state, or placed). */
  onChange?: (photo: Photo) => void;
  /** Waits between two polls (tests). */
  wait?: (ms: number) => Promise<void>;
  /** The clock (tests). */
  now?: () => number;
  /** False when the device has no network (tests); by default `navigator.onLine`. */
  online?: () => boolean;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const codeOf = (error: unknown) => (error as { code?: string } | null)?.code;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The objects in the field: astrometry.net's list, else those the solution's corners take in. */
function objectsOf(
  photo: Photo,
  correspondences: PhotoCorrespondence[],
  solverDsoIds?: string[],
): string[] {
  if (solverDsoIds?.length) return solverDsoIds;
  return findDSOIdsFromCorrespondences(correspondences, photo.width, photo.height);
}

/**
 * Follows a stored photo's solve again until it ends, and returns the photo as it then is: placed, or with its solve's
 * new state. A photo with nothing to follow (no submission, given up) or already followed comes back as it is.
 */
export async function followStoredSolve(
  photo: Photo,
  options: StoredSolveOptions = {},
): Promise<Photo> {
  if (!canFollowStoredSolve(photo) || following.has(photo.id)) return photo;
  const wait = options.wait ?? defaultWait;
  const now = options.now ?? Date.now;
  const online = options.online ?? defaultOnline;
  const solve = photo.onlineSolve!;
  following.add(photo.id);
  let current = photo;

  /** Keeps the solve's new state with the stored photo, and tells the screen. */
  const keep = async (next: OnlineSolve) => {
    current = { ...current, onlineSolve: next };
    await setPhotoOnlineSolve(photo.id, next);
    options.onChange?.(current);
  };
  const checked = () => new Date(now()).toISOString();

  try {
    if (!online()) {
      await keep({ ...solve, state: 'offline', checkedAt: checked() });
      return current;
    }
    // The stored photo's size is its file's, orientation applied: the size its solution is mapped onto.
    const { jobId } = await resumePlateSolve(
      { width: photo.width, height: photo.height },
      solve.submissionId!,
      { fits: !!solve.fits, ...(options.quick ? { budgetMs: 0 } : {}) },
    );
    await keep({ ...solve, state: 'solving', jobId, checkedAt: checked() });
    for (;;) {
      await wait(STORED_SOLVE_POLL_MS);
      if (!online()) {
        await keep({ ...current.onlineSolve!, state: 'offline', checkedAt: checked() });
        return current;
      }
      let status;
      try {
        status = await pollPlateSolve(jobId);
      } catch (error) {
        if (!TRANSIENT_CODES.has(codeOf(error))) throw error;
        await keep({ ...current.onlineSolve!, state: 'offline', checkedAt: checked() });
        return current;
      }
      if (status.status === 'solved' && status.correspondences?.length) {
        const placed = await setPhotoPlacement(photo.id, {
          correspondences: status.correspondences,
        });
        const found = objectsOf(placed, status.correspondences, status.dsoIds);
        const dsoIds = [...new Set([...placed.dsoIds, ...found])];
        if (dsoIds.length !== placed.dsoIds.length) {
          await updatePhotoMetadata(placed.id, {
            dsoIds,
            labels: placed.labels,
            pointsOfInterest: placed.pointsOfInterest,
            integrations: placed.integrations ?? [],
            notes: placed.notes,
            observationDate: placed.observationDate ?? null,
            captureDetails: placed.captureDetails ?? null,
            gearSetupId: placed.gearSetupId ?? null,
          });
        }
        current = { ...placed, dsoIds };
        options.onChange?.(current);
        return current;
      }
      if (status.status === 'timeout') {
        // Not a failure: astrometry.net goes on solving after the app stopped waiting.
        await keep({ ...current.onlineSolve!, state: 'unfinished', checkedAt: checked() });
        return current;
      }
      if (status.status === 'failed') {
        await keep({
          ...current.onlineSolve!,
          state: 'failed',
          checkedAt: checked(),
          error: status.error || 'failed',
        });
        return current;
      }
    }
  } catch (error) {
    reportError('stored-solve.follow', error);
    await keep({
      ...(current.onlineSolve ?? solve),
      state: 'failed',
      checkedAt: checked(),
      error: messageOf(error),
    }).catch(() => undefined);
    return current;
  } finally {
    following.delete(photo.id);
  }
}

/** How many stored photos are asked about at once. */
export const STORED_SOLVE_CHECKS_AT_ONCE = 3;

/**
 * Asks astrometry.net where the solves of the stored photos that wait for it stand, a few photos at a time, once each
 * (`quick`): a solved photo is placed, a failed one shows it, one astrometry.net has not finished stays "En cours"
 * and is asked again next time. A solve astrometry.net never finishes therefore holds no other photo back.
 */
export async function followStoredSolves(
  photos: readonly Photo[],
  options: StoredSolveOptions = {},
): Promise<void> {
  const waiting = photos.filter(canFollowStoredSolve);
  let next = 0;
  const worker = async () => {
    while (next < waiting.length) {
      await followStoredSolve(waiting[next++], { quick: true, ...options });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(STORED_SOLVE_CHECKS_AT_ONCE, waiting.length) }, worker),
  );
}
