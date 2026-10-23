import { reactive } from 'vue';
import { storage } from '@myastrosky/core/platform/storage';

/** How the phone is held: the gallery keeps a number of photos per line for each. */
export type Orientation = 'portrait' | 'landscape';

/** The numbers of photos per line the "Affichage" sheet offers (boards "Galerie, affichage"). */
export const PER_LINE_CHOICES: Record<Orientation, readonly number[]> = {
  portrait: [1, 2, 3],
  landscape: [3, 4, 5, 6],
};
const DEFAULTS: Record<Orientation, number> = { portrait: 2, landscape: 6 };
const KEY = 'gallery-display-v1';

function read(): Record<Orientation, number> {
  let stored: Partial<Record<Orientation, unknown>> = {};
  try {
    stored = JSON.parse(storage().get(KEY) ?? '{}') ?? {};
  } catch {
    // An unreadable record is as good as none.
  }
  const valid = (o: Orientation) =>
    PER_LINE_CHOICES[o].includes(stored[o] as number) ? (stored[o] as number) : DEFAULTS[o];
  return { portrait: valid('portrait'), landscape: valid('landscape') };
}

/** The photos per line in each orientation; a change is stored at once. */
export const photosPerLine = reactive<Record<Orientation, number>>({ ...DEFAULTS });

/** Reads the stored choice (the storage is set up at start-up, after this module may have loaded). */
export function loadGalleryDisplay(): void {
  Object.assign(photosPerLine, read());
}

export function setPhotosPerLine(orientation: Orientation, count: number): void {
  if (!PER_LINE_CHOICES[orientation].includes(count)) return;
  photosPerLine[orientation] = count;
  storage().set(KEY, JSON.stringify({ ...photosPerLine }));
}
