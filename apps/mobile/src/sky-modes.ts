/**
 * The modes of the Ciel map that take the whole screen: placing a waiting photo by hand (board "Placer la photo").
 * A screen asks for one by setting it and going to the Ciel tab; the tab bar is hidden while one is on.
 */
import { computed, shallowRef } from 'vue';

/** The waiting photo being placed by hand on the map, or null. */
export const skyPlacement = shallowRef<{ pendingId: string } | null>(null);

/** The tab bar is hidden while the map is in a mode of its own. */
export const tabBarHidden = computed(() => skyPlacement.value !== null);
