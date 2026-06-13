import type { Photo } from './types';

export interface PhotoQueryMatch {
  photo: Photo;
  matchingDsoIds: string[];
  matchingLabels: string[];
}

export function buildPhotoQueryMatches(photos: Photo[], query: string): PhotoQueryMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: PhotoQueryMatch[] = [];
  for (const photo of photos) {
    const matchingDsoIds = photo.dsoIds.filter((id) => id.toLowerCase().includes(q));
    const matchingLabels = photo.labels.filter((label) => label.toLowerCase().includes(q));
    const matchesName = photo.originalName.toLowerCase().includes(q);
    const matchesNotes = photo.notes.toLowerCase().includes(q);

    if (!matchesName && !matchesNotes && matchingDsoIds.length === 0 && matchingLabels.length === 0) {
      continue;
    }

    matches.push({
      photo,
      matchingDsoIds,
      matchingLabels,
    });
  }

  return matches;
}
