/**
 * Online solving of the photos that wait for a placement: the picture is sent to astrometry.net, its job is followed
 * until it ends, and a solved photo is stored placed, as the desktop's "Ajouter des photos" window does. The job is
 * written on the waiting photo with its astrometry.net submission, so a solve started earlier is followed again when the
 * app comes back (the solver's jobs live in memory and are lost when it restarts). Without a network the following
 * stops and the photo shows "Hors ligne": astrometry.net goes on solving, and the result is fetched once the phone is
 * back online.
 */
import { ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { findDSOIdsFromCorrespondences } from '@myastrosky/core/catalog/dso-registry';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useErrorToast } from './composables/useErrorToast';
import type { AstrometrySolveStatus, PhotoCorrespondence } from '@myastrosky/core/types';
import {
  pollPlateSolve,
  resumePlateSolve,
  submitPlateSolve,
  uploadPhoto,
} from '@myastrosky/app-state/api';
import {
  type PendingPhoto,
  pendingPhotoFile,
  pendingPhotos,
  removePendingPhoto,
  setPendingState,
} from './pending-photos';

/** How often a job is asked where it stands, as on the desktop. */
export const POLL_INTERVAL_MS = 2000;

/** The codes of the errors that mean the solver is out of reach: no network, a server that answers badly, or no code. */
const TRANSIENT_CODES = new Set([undefined, 'NETWORK_ERROR', 'HTTP_ERROR']);

/** Counts the photos stored after a solve: a screen that lists the photos reads them again when it changes. */
export const solvedPhotoCount = ref(0);

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
const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');
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

async function storeSolved(
  id: string,
  file: File,
  correspondences: PhotoCorrespondence[],
  solverDsoIds: string[] | undefined,
): Promise<void> {
  let dsoIds = solverDsoIds ?? [];
  if (dsoIds.length === 0) {
    const { width, height } = await sizeOf(file);
    dsoIds = findDSOIdsFromCorrespondences(correspondences, width, height);
  }
  await uploadPhoto(file, correspondences, undefined, undefined, {
    dsoIds,
    displayName: stripExtension(file.name),
  });
  await removePendingPhoto(id);
  solvedPhotoCount.value += 1;
}

/**
 * Follows a job until it ends: the photo is then stored placed, or marked as failed with the reason. A job the solver
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
          ({ jobId } = await resumePlateSolve(file, photo.submissionId));
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
        if (file) await storeSolved(id, file, status.correspondences, status.dsoIds);
        return;
      }
      if (status.status === 'failed' || status.status === 'timeout') {
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
 * Sends a waiting photo to the online solver. The photo shows "Résolution" until the solve ends. A photo stopped for want
 * of the network is not sent again: its solve is followed again.
 */
export async function solvePendingOnline(id: string): Promise<void> {
  const stopped = pendingPhotos.value.find((p) => p.id === id && p.state === 'offline');
  if (stopped) return followAgain(stopped);
  const file = await pendingPhotoFile(id);
  if (!file) return;
  await setPendingState(id, 'solving');
  let jobId: string;
  try {
    ({ jobId } = await submitPlateSolve(file));
  } catch (error) {
    await setPendingState(id, 'failed', { error: messageOf(error) });
    return;
  }
  await setPendingState(id, 'solving', { jobId });
  void follow(id, jobId);
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
