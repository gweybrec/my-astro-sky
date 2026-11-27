/**
 * Online solving of the photos being worked on: the picture is sent to astrometry.net, its job is followed until it ends,
 * and a solved photo is placed, as the desktop's "Ajouter des photos" window does (`holdSolved`). The job and its
 * astrometry.net submission are kept on the photo; a photo stored "À résoudre" keeps them in the photo store, where
 * `@myastrosky/app-state/stored-solve` follows them again after a restart. Without a network the following stops and
 * the photo shows "Hors ligne": astrometry.net goes on solving, and the result is fetched once the phone is back online.
 */
import { ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { findDSOIdsFromCorrespondences } from '@myastrosky/core/catalog/dso-registry';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { isFitsFile } from '@myastrosky/core/photo-formats';
import { onlineSolveHints } from '@myastrosky/core/domain/solve';
import { useErrorToast } from './composables/useErrorToast';
import type { AstrometrySolveStatus, PhotoCorrespondence } from '@myastrosky/core/types';
import {
  pictureSize,
  pollPlateSolve,
  resumePlateSolve,
  reuseAstrometrySubmission,
  submitPlateSolve,
} from '@myastrosky/app-state/api';
import {
  type PendingPhoto,
  pendingPhotoFile,
  pendingPhotoSolveFile,
  pendingPhotos,
  setPendingState,
  holdPendingPlacement,
  storePendingPhoto,
} from './pending-photos';

/** How often a job is asked where it stands, as on the desktop. */
export const POLL_INTERVAL_MS = 2000;

/** The codes of the errors that mean the solver is out of reach: no network, a server that answers badly, or no code. */
const TRANSIENT_CODES = new Set([undefined, 'NETWORK_ERROR', 'NETWORK_TIMEOUT', 'HTTP_ERROR']);

/** Counts the photos stored after a solve: a screen that lists the photos reads them again when it changes. */
export const solvedPhotoCount = ref(0);

/** The hint typed for a photo ("Objet cible", FOV), sent with its online solve; kept while the app runs. */
export interface SolveHint {
  /** The text of the target field, and the position of the object picked from its results. */
  targetText: string;
  target: { ra: number; dec: number } | null;
  fov: string;
}
export const solveHints = new Map<string, SolveHint>();

/** The field width typed, in degrees, or null when it is empty or not a width (0.1 to 180). */
export function hintFovDeg(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0.1 && value <= 180
    ? value
    : null;
}

const following = new Set<string>();
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const codeOf = (error: unknown) => (error as { code?: string } | null)?.code;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Stops following a job for want of the network: the photo keeps its job and submission and shows "Hors ligne". The
 * first photo to stop says why, and where to find the result later.
 */
async function stopOffline(id: string, jobId: string, submissionId: number | undefined) {
  const first = !pendingPhotos.value.some((p) => p.state === 'offline');
  await setPendingState(id, 'offline', { jobId, submissionId });
  if (first) await useErrorToast().showNotice(t('mobile.gallery.solveOffline'));
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The size of a picture, for finding the objects in its field; 0 × 0 when it cannot be read. */
async function sizeOf(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** The waiting photo whose page "Photo à ajouter" is open, or null: a solve that ends for it waits for Enregistrer. */
export const shownPendingId = ref<string | null>(null);

/**
 * Holds the placement of a solved photo. A photo of the import list, or whose page is open, waits for Importer or
 * Enregistrer; a waiting photo of the gallery is stored at once, with the metadata typed for it.
 */
async function holdSolved(
  id: string,
  file: File,
  correspondences: PhotoCorrespondence[],
  solverDsoIds: string[] | undefined,
  storeIfWaiting: boolean,
): Promise<void> {
  let dsoIds = solverDsoIds ?? [];
  if (dsoIds.length === 0) {
    const { width, height } = await sizeOf(file);
    dsoIds = findDSOIdsFromCorrespondences(correspondences, width, height);
  }
  await holdPendingPlacement(id, { correspondences, dsoIds, by: 'solved' });
  const photo = pendingPhotos.value.find((p) => p.id === id);
  if (!storeIfWaiting || !photo || photo.inImport || shownPendingId.value === id) return;
  await storePendingPhoto(id);
  solvedPhotoCount.value += 1;
}

/**
 * Follows a job until it ends: the photo is then placed, or marked as failed with the reason. A job the solver
 * no longer knows (the app restarted) is started again from its submission, as is one followed again after a loss of
 * the network (`again`: its job may have given up meanwhile). Without a network the following stops (`stopOffline`).
 */
async function follow(id: string, firstJobId: string, again = false): Promise<void> {
  if (following.has(id)) return;
  following.add(id);
  let jobId = firstJobId;
  let startAgain = again;
  try {
    for (;;) {
      await wait(POLL_INTERVAL_MS);
      const photo = pendingPhotos.value.find((p) => p.id === id);
      if (!photo) return;
      if (isOffline()) {
        await stopOffline(id, jobId, photo.submissionId);
        return;
      }
      let status: AstrometrySolveStatus;
      try {
        if (startAgain && photo.submissionId) {
          startAgain = false;
          const file = await pendingPhotoFile(id);
          if (!file) return;
          // Only the picture's size is sent (a FITS file has its PNG's); the flag tells whether the picture sent was a
          // FITS file.
          ({ jobId } = await resumePlateSolve(await pictureSize(file), photo.submissionId, {
            fits: !!photo.fits,
          }));
          await setPendingState(id, 'solving', { jobId, submissionId: photo.submissionId });
          continue;
        }
        status = await pollPlateSolve(jobId);
      } catch (error) {
        if (codeOf(error) === 'JOB_NOT_FOUND' && photo.submissionId) {
          startAgain = true;
          continue;
        }
        if (!TRANSIENT_CODES.has(codeOf(error))) throw error;
        await stopOffline(id, jobId, photo.submissionId);
        return;
      }
      if (status.submissionId && status.submissionId !== photo.submissionId) {
        await setPendingState(id, 'solving', { jobId, submissionId: status.submissionId });
      }
      if (status.status === 'solved' && status.correspondences) {
        const file = await pendingPhotoFile(id);
        if (file) await holdSolved(id, file, status.correspondences, status.dsoIds, true);
        return;
      }
      if (status.status === 'timeout') {
        // Not a failure: astrometry.net goes on solving after the app stopped following it.
        await setPendingState(id, 'unfinished', {
          submissionId: status.submissionId ?? photo.submissionId,
        });
        await useErrorToast().showWarning(t('batch.statusUnfinished'));
        return;
      }
      if (status.status === 'failed') {
        await setPendingState(id, 'failed', { error: status.error || t('modal.solveFailed') });
        return;
      }
    }
  } catch (error) {
    reportError('pending-solve.follow', error);
    await setPendingState(id, 'failed', { error: messageOf(error) });
  } finally {
    following.delete(id);
  }
}

/**
 * Sends a waiting photo to the online solver, with the hint typed for it (`solveHints`). The photo shows "Résolution" until the solve ends. A photo stopped for want
 * of the network is not sent again: its solve is followed again.
 */
export async function solvePendingOnline(id: string): Promise<void> {
  const stopped = pendingPhotos.value.find((p) => p.id === id && p.state === 'offline');
  if (stopped) return followAgain(stopped);
  const file = await pendingPhotoSolveFile(id);
  if (!file) return;
  await setPendingState(id, 'solving');
  let jobId: string;
  try {
    const hint = solveHints.get(id);
    ({ jobId } = await submitPlateSolve(
      file,
      onlineSolveHints(hint?.target, hint ? hintFovDeg(hint.fov) : null),
    ));
  } catch (error) {
    await setPendingState(id, 'failed', { error: messageOf(error) });
    return;
  }
  await setPendingState(id, 'solving', {
    jobId,
    sentAt: new Date().toISOString(),
    fits: isFitsFile(file.name),
  });
  void follow(id, jobId);
}

/**
 * "Récupérer le résultat d'astrometry.net": follows again the submission of a solve astrometry.net goes on with ("En
 * cours"); nothing is sent again.
 */
export async function fetchPendingResult(id: string): Promise<void> {
  const photo = pendingPhotos.value.find((p) => p.id === id);
  if (!photo?.submissionId || following.has(id)) return;
  if (photo.state !== 'unfinished' && photo.state !== 'offline') return;
  await setPendingState(id, 'solving', { submissionId: photo.submissionId });
  void follow(id, '', true);
}

/**
 * Places a waiting photo with the solution of a job already solved on the astrometry.net account (the desktop's
 * "Réutiliser une solution astrometry.net…"): the picture is not sent to astrometry.net. The photo shows "Résolution"
 * meanwhile, and is then placed, waiting for Enregistrer on its page. When the solution cannot be used (another picture's, astrometry.net refusing), the
 * photo is back as it was and the reason shows in a red toast.
 */
export async function reusePendingSolution(id: string, jobId: number): Promise<void> {
  const photo = pendingPhotos.value.find((p) => p.id === id);
  const file = await pendingPhotoFile(id);
  if (!photo || !file) return;
  const before = { jobId: photo.jobId, submissionId: photo.submissionId, error: photo.error };
  await setPendingState(id, 'solving');
  try {
    const result = await reuseAstrometrySubmission(file, jobId);
    if (result.success && result.correspondences && result.correspondences.length > 0) {
      await holdSolved(id, file, result.correspondences, result.dsoIds, false);
      return;
    }
    await setPendingState(id, photo.state, before);
    await useErrorToast().showError(result.error || t('modal.reuseFailed'));
  } catch (error) {
    reportError('pending-solve.reuse', error);
    await setPendingState(id, photo.state, before);
    await useErrorToast().showError(messageOf(error));
  }
}

/** Follows again a solve stopped for want of the network, once the phone is online. */
async function followAgain(photo: PendingPhoto): Promise<void> {
  if (isOffline() || following.has(photo.id) || !photo.jobId) return;
  await setPendingState(photo.id, 'solving', {
    jobId: photo.jobId,
    submissionId: photo.submissionId,
  });
  void follow(photo.id, photo.jobId, true);
}

/**
 * Follows again the solves that were running when the app was left, and, once the phone is online, those stopped for
 * want of the network. A photo marked as being solved whose job was never created (the app stopped while sending it)
 * is marked as failed, so that it can be sent again.
 */
export async function resumePendingSolves(): Promise<void> {
  for (const photo of pendingPhotos.value) {
    if (following.has(photo.id)) continue;
    if (photo.state === 'offline') await followAgain(photo);
    if (photo.state !== 'solving') continue;
    if (photo.jobId) void follow(photo.id, photo.jobId);
    else await setPendingState(photo.id, 'failed', { error: t('modal.solveFailed') });
  }
}
