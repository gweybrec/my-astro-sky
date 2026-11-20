import { shallowRef } from 'vue';

/**
 * The constellations chosen on the statistics page (null: all of them). A catalogue's page, opened from there, lists
 * its objects in the same constellations.
 */
export const statisticsConstellations = shallowRef<string[] | null>(null);
