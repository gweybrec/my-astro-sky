/**
 * What the lists say about a photo not stored yet (the gallery's waiting tiles, "Importer des photos", the page "Photo
 * à ajouter"), and the way back to its page from a placement method.
 */
import type { Router } from 'vue-router';
import type { PhotoMetadataDraft } from '@myastrosky/core/photo-metadata-draft';
import type { Photo } from '@myastrosky/core/types';
import { t } from '@myastrosky/core/i18n/index';
import { pendingPhotos, type PendingPhoto } from './pending-photos';

/** Where a photo not stored yet stands, in a few words; a gallery tile (`tile`) says an unfinished solve shorter. */
export function pendingStateText(photo: PendingPhoto, tile = false): string {
  switch (photo.state) {
    case 'solving':
      return t('mobile.gallery.solving');
    case 'offline':
      return t('mobile.gallery.solvingOffline');
    case 'failed':
      return t('batch.statusFailed');
    case 'unfinished':
      return t(tile ? 'mobile.gallery.unfinished' : 'mobile.gallery.solveUnfinished');
    case 'placed':
      switch (photo.placedBy) {
        case 'file':
          return t('mobile.gallery.alreadySolved');
        case 'hand':
          return t('mobile.gallery.placedByHand');
        case 'stars':
          return t('mobile.gallery.placedByStars', { n: photo.starCount ?? 0 });
        default:
          return t('mobile.gallery.placedSolved');
      }
    default:
      return t('mobile.gallery.toPlace');
  }
}

/** What a gallery tile says about a photo stored "À résoudre", from its astrometry.net solve. */
export function storedStateText(photo: Photo): string {
  switch (photo.onlineSolve?.state) {
    case 'solving':
      return t('mobile.gallery.solving');
    case 'offline':
      return t('mobile.gallery.solvingOffline');
    case 'failed':
      return t('batch.statusFailed');
    case 'unfinished':
      return t('mobile.gallery.unfinished');
    default:
      return t('mobile.gallery.toPlace');
  }
}

/** The colour of that text: placed in green, being solved with the spinner, failed in red, unfinished in orange. */
export function pendingStatus(
  photo: PendingPhoto,
): 'success' | 'busy' | 'danger' | 'warn' | undefined {
  switch (photo.state) {
    case 'placed':
      return 'success';
    case 'solving':
      return 'busy';
    case 'failed':
      return 'danger';
    case 'unfinished':
      return 'warn';
    default:
      return undefined;
  }
}

/**
 * Opens the page "Photo à ajouter" of a photo again, after a placement method: over the import list when the photo is
 * in it, else over the gallery. The method may have been shown over another tab (the map), so the pages under it are
 * opened again from the Galerie tab.
 */
export async function openPendingPage(router: Router, id: string): Promise<void> {
  const photo = pendingPhotos.value.find((p) => p.id === id);
  await router.replace('/tabs/gallery');
  if (!photo) return;
  if (photo.inImport) await router.push('/gallery/import');
  await router.push(`/gallery/pending/${id}`);
}

/**
 * The metadata typed on the page "Photo à ajouter" and not saved yet, kept while a placement method is open: the page
 * opened again after it shows them. Enregistrer, Annuler and deleting the photo forget them.
 */
export const unsavedDrafts = new Map<string, PhotoMetadataDraft>();
