import { mergeIdentifiedPois } from '@myastrosky/core/photo-identify';
import { draftFromPhoto, draftToMetadata } from '@myastrosky/core/photo-metadata-draft';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';
import { updatePhotoMetadata } from '@myastrosky/app-state/api';

/**
 * Where the points of interest found on a photo go (the identification pages and "Ajouter un point d'intérêt"). Opened
 * from the photo's edit page, they join its form, saved with Enregistrer as the desktop's editor does; opened from the
 * photo's page, they are saved on the photo at once. A point already on the photo (same name and type) is not added
 * twice: `deliverPois` gives back the ones actually added.
 */
type Receiver = (pois: PointOfInterest[]) => PointOfInterest[];

let receiver: { photoId: string; receive: Receiver } | null = null;

/** The edit page of `photoId` takes the points found while it is open; the returned function stops that. */
export function receivePois(photoId: string, receive: Receiver): () => void {
  const entry = { photoId, receive };
  receiver = entry;
  return () => {
    if (receiver === entry) receiver = null;
  };
}

export async function deliverPois(
  photo: Photo,
  pois: PointOfInterest[],
): Promise<PointOfInterest[]> {
  if (receiver?.photoId === photo.id) return receiver.receive(pois);
  const { merged, fresh } = mergeIdentifiedPois(photo.pointsOfInterest ?? [], pois);
  if (fresh.length) {
    await updatePhotoMetadata(
      photo.id,
      draftToMetadata({ ...draftFromPhoto(photo), pointsOfInterest: merged }, photo.originalName),
    );
  }
  return fresh;
}
