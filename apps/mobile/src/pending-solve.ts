/**
 * Online solving of the photos that wait for a placement: the picture is sent to astrometry.net, its job is followed
 * until it ends, and a solved photo is stored placed, as the desktop's "Ajouter des photos" window does. The job is
 * written on the waiting photo, so a solve started earlier is followed again when the app comes back.
 */
import { ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { findDSOIdsFromCorrespondences } from '@myastrosky/core/catalog/dso-registry';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { PhotoCorrespondence } from '@myastrosky/core/types';
import { pollPlateSolve, submitPlateSolve, uploadPhoto } from '@myastrosky/app-state/api';
import {
  pendingPhotoFile,
  pendingPhotos,
  removePendingPhoto,
  setPendingState,
} from './pending-photos';

/** How often a job is asked where it stands, as on the desktop. */
export const POLL_INTERVAL_MS = 2000;

/** Counts the photos stored after a solve: a screen that lists the photos reads them again when it changes. */
export const solvedPhotoCount = ref(0);

const following = new Set<string>();
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
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

/** Follows a job until it ends: the photo is then stored placed, or marked as failed with the reason. */
async function follow(id: string, jobId: string): Promise<void> {
  if (following.has(id)) return;
  following.add(id);
  try {
    for (;;) {
      await wait(POLL_INTERVAL_MS);
      if (!pendingPhotos.value.some((p) => p.id === id)) return;
      const status = await pollPlateSolve(jobId);
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

/** Sends a waiting photo to the online solver. The photo shows "Résolution" until the solve ends. */
export async function solvePendingOnline(id: string): Promise<void> {
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

/**
 * Follows again the solves that were running when the app was left. A photo marked as being solved whose job was
 * never created (the app stopped while sending it) is marked as failed, so that it can be sent again.
 */
export async function resumePendingSolves(): Promise<void> {
  for (const photo of pendingPhotos.value) {
    if (photo.state !== 'solving' || following.has(photo.id)) continue;
    if (photo.jobId) void follow(photo.id, photo.jobId);
    else await setPendingState(photo.id, 'failed', { error: t('modal.solveFailed') });
  }
}
