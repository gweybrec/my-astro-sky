/**
 * The modes of the Ciel map that take the whole screen: placing a waiting photo by hand (board "Placer la photo"),
 * choosing a star for a point of the star identification (board "Identifier les étoiles, choisir sur la carte"),
 * drawing a sky region (board "Dessiner une région"), showing one (board "Voir une région"), showing a target
 * (board "Ciel, voir une cible") and showing a plan's frames (board "Ciel, contours de champ d'un plan").
 * A screen asks for one by setting it and going to the Ciel tab; the tab bar is hidden while one is on.
 */
import { computed, shallowRef } from 'vue';
import type { Star } from '@myastrosky/core/types';
import type { SkyRegionData } from '@myastrosky/core/domain/regions';
import type { FovSelection } from '@myastrosky/app-state/stores/fov-frames';
import type { Tab } from './tab-navigation';

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

/**
 * A target shown on the map by "Afficher sur la carte" of its page (board "Ciel, voir une cible"), or null. `frameId` is
 * the setup's frame put on it (null without a setup), a preview: the mode removes it when it ends and puts back the
 * frames as they were (`frames`: shown or not, and which set). The target is the object that frame is anchored to,
 * `dsoId` (named `name`) at first. The mode ends by opening `tab`, the `pages` under the target's page, then the
 * target's page: `page` while it is the same target, `pageOf(id)` once the frame was moved onto another object.
 */
export const skyTargetView = shallowRef<{
  frameId: string | null;
  frames: { visible: boolean; selection: FovSelection };
  dsoId: string;
  name: string;
  tab: Tab;
  pages: string[];
  page: string;
  pageOf: (dsoId: string) => string;
} | null>(null);

/**
 * A plan shown on the map by "Afficher sur la carte" of its page, or null: its frames shown, with the frames' sheet on
 * it. The mode ends by putting back the frames as they were (`frames`: shown or not, and which set) and opening the
 * Plans tab, then `returnTo` (the plan's page).
 */
export const skyPlanView = shallowRef<{
  planId: string;
  name: string;
  frames: { visible: boolean; selection: FovSelection };
  returnTo: string;
} | null>(null);

/** The tab bar is hidden while the map is in a mode of its own. */
export const tabBarHidden = computed(
  () =>
    skyPlacement.value !== null ||
    skyStarPick.value !== null ||
    skyRegionDraw.value !== null ||
    skyRegionView.value !== null ||
    skyTargetView.value !== null ||
    skyPlanView.value !== null,
);
