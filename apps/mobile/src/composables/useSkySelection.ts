import { shallowRef } from 'vue';
import type { UnifiedSearchResult } from '@myastrosky/core/search';
import type { DSO } from '@myastrosky/core/types';
import type { StarSearchResult } from '@myastrosky/core/domain/stars';

/** The object selected on the sky map: a deep-sky object or a star. */
export type SkySelection = { kind: 'dso'; dso: DSO } | { kind: 'star'; star: StarSearchResult };

/** Where the map should go: the sky position and the zoom to keep at least. */
export interface SkyFocus {
  ra: number;
  dec: number;
  scale: number;
}

/** The zoom a searched object is shown at, at least: a deep-sky object is smaller than a star's surroundings. */
const DSO_SCALE = 1200;
const STAR_SCALE = 800;

/** What is selected on the map; the Ciel page highlights it and the search page sets it. */
export const skySelection = shallowRef<SkySelection | null>(null);
/** A request to move the map to a position, set once by the search page and taken by the Ciel page. */
export const skyFocus = shallowRef<SkyFocus | null>(null);

/** Selects a search result and asks the map to go to it. */
export function selectSearchResult(result: UnifiedSearchResult) {
  if (result.type === 'dso' && result.dso) {
    skySelection.value = { kind: 'dso', dso: result.dso };
  } else if (result.type === 'star' && result.star) {
    skySelection.value = { kind: 'star', star: result.star };
  } else {
    return;
  }
  skyFocus.value = {
    ra: result.ra,
    dec: result.dec,
    scale: result.type === 'dso' ? DSO_SCALE : STAR_SCALE,
  };
}

export function clearSkySelection() {
  skySelection.value = null;
}
