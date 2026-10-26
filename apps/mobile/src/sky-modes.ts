/**
 * The modes of the Ciel map that take the whole screen: placing a waiting photo by hand (board "Placer la photo"),
 * choosing a star for a point of the star identification (board "Identifier les étoiles, choisir sur la carte"),
 * drawing a sky region (board "Dessiner une région") and showing one (board "Voir une région").
 * A screen asks for one by setting it and going to the Ciel tab; the tab bar is hidden while one is on.
 */
import { computed, shallowRef } from 'vue';
import type { Star } from '@myastrosky/core/types';
import type { SkyRegionData } from '@myastrosky/core/domain/regions';

/** The waiting photo being placed by hand on the map, or null. */
export const skyPlacement = shallowRef<{ pendingId: string } | null>(null);

/**
 * A star being chosen on the map for a point of the identification (`point` counts from 1), or null. `done` receives
 * the star chosen, or null when the choice is given up; the map then opens `returnTo` again (the identification's
 * page, which the map replaced: a page pushed above the tabs that pushes a tab is shown over the wrong tab).
 */
export const skyStarPick = shallowRef<{
  point: number;
  done: (star: Star | null) => void;
  returnTo: string;
} | null>(null);

/** A sky region being drawn on the map, or null; the map then opens `returnTo` again (the regions page). */
export const skyRegionDraw = shallowRef<{ returnTo: string } | null>(null);

/** A saved sky region shown on the map, or null; the map then opens `returnTo` again (the regions page). */
export const skyRegionView = shallowRef<{ region: SkyRegionData; returnTo: string } | null>(null);

/** The tab bar is hidden while the map is in a mode of its own. */
export const tabBarHidden = computed(
  () =>
    skyPlacement.value !== null ||
    skyStarPick.value !== null ||
    skyRegionDraw.value !== null ||
    skyRegionView.value !== null,
);
