import { computed, shallowRef } from 'vue';
import { getLang } from '@myastrosky/core/i18n/index';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';

/**
 * The constellations chosen on the statistics page (null: all of them). A catalogue's page, opened from there, lists
 * its objects in the same constellations, and changing them there changes them on the statistics page too.
 */
export const statisticsConstellations = shallowRef<string[] | null>(null);

/** The constellations by their name in the language, once each (the registry lists a few twice). */
function readConstellations(): { value: string; label: string }[] {
  const seen = new Set<string>();
  return getConstellationInfos()
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ value: c.id, label: c.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, getLang()));
}

/**
 * The "Constellations" row of the statistics pages: the choices of its sheet (read by `load()` once the star registry
 * is there) and the chosen ones, every one when nothing was chosen. Choosing them all again stores null.
 */
export function useStatisticsConstellations() {
  const options = shallowRef<{ value: string; label: string }[]>([]);
  const selected = computed<string[]>({
    get: () => statisticsConstellations.value ?? options.value.map((o) => o.value),
    set: (chosen) => {
      statisticsConstellations.value = chosen.length === options.value.length ? null : [...chosen];
    },
  });
  function load() {
    options.value = readConstellations();
  }
  return { options, selected, load };
}
