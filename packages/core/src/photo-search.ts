import type { Photo, PointOfInterest } from './types';
import { DSO_CATALOGS_ALL, sortDsoIdsByImportance, type DSOCatalog } from './catalog/dso-registry';

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

/** Catalogue prefixes as written in file names, in {@link DSO_CATALOGS_ALL}'s order of importance; built on first use. */
let catalogPrefixes: [DSOCatalog, RegExp][] | null = null;
function getCatalogPrefixes(): [DSOCatalog, RegExp][] {
  catalogPrefixes ??= DSO_CATALOGS_ALL.map((cat) => [
    cat,
    // "SH2-101", "Sh2 101", "sh2_101"; the others: "M31", "NGC 7000", "vdB-142"…
    new RegExp(String.raw`^${cat === 'SH2' ? String.raw`sh\s*2` : cat}[\s_-]*(\d+)`, 'i'),
  ]);
  return catalogPrefixes;
}

interface ParsedName {
  /** Importance of the catalogue (0 = Messier); unknown catalogues after the known ones, plain names last. */
  rank: number;
  /** The prefix of an unknown catalogue ("Cr", "UGC"), compared alphabetically between themselves. */
  prefix: string;
  number: number;
  rest: string;
}

function parseName(name: string): ParsedName {
  const prefixes = getCatalogPrefixes();
  const unknownCatalog = prefixes.length;
  for (const [cat, re] of prefixes) {
    const m = name.match(re);
    if (m) {
      return {
        rank: DSO_CATALOGS_ALL.indexOf(cat),
        prefix: '',
        number: parseInt(m[1], 10),
        rest: name.slice(m[0].length),
      };
    }
  }
  // Another catalogue ("Cr399", "UGC-1234"): a short prefix glued to its number; "Moon 2" stays a plain name.
  const m = name.match(/^([A-Za-z]{1,5})[_-]?(\d+)/);
  if (m) {
    const prefix = m[1].toUpperCase();
    return {
      rank: unknownCatalog,
      prefix,
      number: parseInt(m[2], 10),
      rest: name.slice(m[0].length),
    };
  }
  return { rank: unknownCatalog + 1, prefix: '', number: 0, rest: name };
}

/**
 * A photo's place in the name order: its name's catalogue number, else its most important solved object (a photo
 * "Andromeda_stack" holding M31 sorts as M31, next to "M31_2024", by the rest of its name).
 */
function parsePhoto(photo: Photo): ParsedName {
  const byName = parseName(photo.originalName);
  if (byName.rank < getCatalogPrefixes().length + 1 || !photo.dsoIds?.length) return byName;
  for (const id of sortDsoIdsByImportance(photo.dsoIds)) {
    const byObject = parseName(id);
    if (byObject.rank < byName.rank) return { ...byObject, rest: photo.originalName };
  }
  return byName;
}

/** Natural text order: digits compare as numbers ("Pass 2" before "Pass 10"), case ignored. */
const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Natural order of photo names: catalogue names first, the most important catalogue first (Messier, NGC, IC, SH2,
 * LBN, LDN, vdB, Abell, LPN, Barnard, then other catalogues alphabetically), numbers in numeric order within a
 * catalogue (M4 before M10 before M100). A photo whose name holds no catalogue number takes the place of its most
 * important solved object. The other photos come last, in natural text order of their names.
 */
export function smartSortPhotos(photos: Photo[]): Photo[] {
  const parsed = new Map(photos.map((p) => [p, parsePhoto(p)]));
  return [...photos].sort((a, b) => {
    const pa = parsed.get(a)!;
    const pb = parsed.get(b)!;
    return (
      pa.rank - pb.rank ||
      pa.prefix.localeCompare(pb.prefix) ||
      pa.number - pb.number ||
      naturalCompare(pa.rest, pb.rest) ||
      naturalCompare(a.originalName, b.originalName)
    );
  });
}
