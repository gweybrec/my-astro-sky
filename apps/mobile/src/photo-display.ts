import { ref } from 'vue';
import { storage } from '@myastrosky/core/platform/storage';
import { quarterTurnsOf } from '@myastrosky/core/photo-rotation';
import type { QuarterTurns } from '@myastrosky/core/types';

/**
 * How a photo is shown on its own screen (board "Réglages, affichage"): with the phone upright, a landscape photo the
 * user has not turned is shown a quarter to the right, to fill the screen. Only the screen turns it: the photo's own
 * rotation (`quarterTurns`, the Pivoter button's, saved with it) is never written by this.
 */
const KEY = 'photo-auto-rotate-v1';

/** Whether landscape photos are turned on an upright phone; on unless switched off. A change is stored at once. */
export const autoRotateLandscape = ref(true);

/** Reads the stored choice (the storage is set up at start-up, after this module may have loaded). */
export function loadPhotoDisplay(): void {
  autoRotateLandscape.value = storage().get(KEY) !== 'false';
}

export function setAutoRotateLandscape(on: boolean): void {
  autoRotateLandscape.value = on;
  storage().set(KEY, on ? 'true' : 'false');
}

/**
 * The quarter turns a photo is shown with on its screen: the user's own rotation when there is one, else a quarter for
 * a photo wider than tall on an upright phone with the setting on, else none.
 */
export function shownQuarterTurns(
  photo: { width: number; height: number; quarterTurns?: number | null },
  options: { autoRotate: boolean; portrait: boolean },
): QuarterTurns {
  const own = quarterTurnsOf(photo);
  if (own) return own;
  return options.autoRotate && options.portrait && photo.width > photo.height ? 1 : 0;
}

/**
 * How many quarter turns to add to the photo's own rotation (`saved`) so that, after a press of Pivoter, it shows a
 * quarter further right than it shows now (`shown`). One, unless the screen turned the photo by itself: its own
 * rotation is then behind what is seen.
 */
export function turnsForNextQuarter(saved: QuarterTurns, shown: QuarterTurns): number {
  const target = (shown + 1) % 4;
  return (target - saved + 4) % 4;
}
