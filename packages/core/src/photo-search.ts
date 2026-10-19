import type { Photo, PointOfInterest } from './types';

export interface PhotoQueryMatch {
  photo: Photo;
  matchingDsoIds: string[];
  matchingLabels: string[];
  matchingPois: PointOfInterest[];
}

export function buildPhotoQueryMatches(photos: Photo[], query: string): PhotoQueryMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: PhotoQueryMatch[] = [];
  for (const photo of photos) {
    const matchingDsoIds = photo.dsoIds.filter((id) => id.toLowerCase().includes(q));
    const matchingLabels = photo.labels.filter((label) => label.toLowerCase().includes(q));
    const matchingPois = (photo.pointsOfInterest ?? []).filter((poi) =>
      poi.name.toLowerCase().includes(q),
    );
    const matchesName = photo.originalName.toLowerCase().includes(q);
    const matchesNotes = photo.notes.toLowerCase().includes(q);

    if (
      !matchesName &&
      !matchesNotes &&
      matchingDsoIds.length === 0 &&
      matchingLabels.length === 0 &&
      matchingPois.length === 0
    ) {
      continue;
    }

    matches.push({
      photo,
      matchingDsoIds,
      matchingLabels,
      matchingPois,
    });
  }

  return matches;
}

/**
 * Smart sorting for astronomical catalog names
 * e.g., M31, M100, NGC224, NGC1976, IC1805, SH2-106
 * Ensures M100 comes after M99, not before M2
 */
export function smartSortPhotos(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const nameA = a.originalName;
    const nameB = b.originalName;

    // Extract catalog prefix and number if present
    const parseFilename = (
      name: string,
    ): { catalog: string; number: number | null; rest: string } => {
      // Match patterns like M31, NGC224, IC1805, SH2-106, Sh2-106, etc.
      const match = name.match(/^([A-Za-z]+)[\s-]?(\d+)/);
      if (match) {
        const catalog = match[1].toUpperCase();
        const number = parseInt(match[2], 10);
        const rest = name.substring(match[0].length);
        return { catalog, number, rest };
      }
      return { catalog: '', number: null, rest: name };
    };

    const parsedA = parseFilename(nameA);
    const parsedB = parseFilename(nameB);

    // If both have catalog prefixes
    if (parsedA.number !== null && parsedB.number !== null) {
      // First sort by catalog name (M before NGC before IC, etc.)
      const catalogCompare = parsedA.catalog.localeCompare(parsedB.catalog);
      if (catalogCompare !== 0) return catalogCompare;

      // Then by catalog number
      if (parsedA.number !== parsedB.number) {
        return parsedA.number - parsedB.number;
      }

      // Finally by the rest of the filename
      return parsedA.rest.localeCompare(parsedB.rest);
    }

    // If only one has a catalog prefix, it comes first
    if (parsedA.number !== null) return -1;
    if (parsedB.number !== null) return 1;

    // Neither has catalog prefix, use simple alphabetical
    return nameA.localeCompare(nameB);
  });
}
