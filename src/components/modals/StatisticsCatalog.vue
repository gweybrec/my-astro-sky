<template>
  <div class="flex flex-col flex-1 min-w-0 min-h-0">
    <!-- Constellations, search, which objects, sort: they stay at the top, only the list below scrolls -->
    <div
      class="shrink-0 flex flex-col gap-4 px-7 pt-7 pb-5 border-b border-b-solid border-[var(--border-subtle)]"
    >
      <ConstellationSelector v-model="constellations" />
      <div class="flex items-center gap-6 flex-wrap">
        <input
          v-model="query"
          class="input-base w-64"
          type="search"
          :placeholder="t('stats.catalog.search', { catalog: catalogLabel })"
          :aria-label="t('stats.catalog.search', { catalog: catalogLabel })"
        />
        <span class="flex gap-2" role="radiogroup" :aria-label="t('stats.catalog.shown')">
          <button
            v-for="s in SHOWS"
            :key="s"
            type="button"
            role="radio"
            :aria-checked="show === s"
            :class="show === s ? 'bw-filter--on' : 'bw-filter'"
            @click="show = s"
          >
            {{ t(SHOW_LABELS[s]) }} <b>{{ counts[s] }}</b>
          </button>
        </span>
        <span class="ml-auto flex items-center gap-4">
          <label for="stats-catalog-sort" class="targets-sort-label">{{
            t('targets.sort.label')
          }}</label>
          <select id="stats-catalog-sort" v-model="sort" class="targets-sort-select">
            <option v-for="s in SORTS" :key="s" :value="s">{{ t(SORT_LABELS[s]) }}</option>
          </select>
        </span>
      </div>
    </div>

    <!-- One fold per constellation -->
    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col px-7 pt-4 pb-7">
      <p v-if="groups.length === 0" class="text-body text-dim">{{ t('stats.catalog.empty') }}</p>
      <template v-for="g in groups" :key="g.constellation ?? ''">
        <button
          type="button"
          class="flex items-center gap-4 w-full box-border px-4 py-3 rounded-md bg-transparent border-none text-left text-primary text-body cursor-pointer hover:bg-[var(--bg-hover)]"
          :aria-expanded="isOpen(g)"
          @click="toggle(g)"
        >
          <span class="w-4 text-secondary" aria-hidden="true">{{ isOpen(g) ? '▾' : '▸' }}</span>
          <span class="flex-1 min-w-0 truncate">{{ groupName(g) }}</span>
          <span class="progress-track w-30 shrink-0">
            <span class="progress-fill" :style="{ width: `${groupPct(g)}%` }"></span>
          </span>
          <span class="w-20 text-right text-base text-secondary font-mono"
            >{{ g.photographed }} / {{ g.total }}</span
          >
        </button>
        <table v-if="isOpen(g)" class="w-full border-collapse mb-4 text-body">
          <thead>
            <tr class="text-small text-label text-left">
              <th class="font-normal py-2 px-4">{{ t('stats.catalog.designation') }}</th>
              <th class="font-normal py-2 px-4">{{ t('stats.catalog.name') }}</th>
              <th class="font-normal py-2 px-4">{{ t('stats.catalog.type') }}</th>
              <th class="font-normal py-2 px-4">{{ t('stats.catalog.mag') }}</th>
              <th class="font-normal py-2 px-4">{{ t('targets.sort.rating') }}</th>
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in g.entries"
              :key="e.dso.id"
              class="border-t border-solid border-0 border-[var(--border-subtle)]"
            >
              <td class="py-2 px-4 whitespace-nowrap">
                <span class="text-bright">{{ formatCatalogId(e.designation, e.dso) }}</span>
                <span v-if="e.photographed" class="bw-chip--ok border-solid ml-4">{{
                  t('stats.catalog.photographed')
                }}</span>
              </td>
              <td class="py-2 px-4 text-secondary">{{ properName(e) }}</td>
              <td class="py-2 px-4">
                <span class="bw-chip border-solid border-[var(--border-input)] text-secondary">{{
                  t(`dso.types.${e.dso.type}`)
                }}</span>
              </td>
              <td class="py-2 px-4 text-secondary">{{ e.dso.mag?.toFixed(1) ?? '' }}</td>
              <td
                class="py-2 px-4 whitespace-nowrap tracking-wide text-[var(--target-rating-text)]"
                :aria-label="
                  e.dso.rating !== null ? t('stats.catalog.ratingAria', { n: e.dso.rating }) : ''
                "
              >
                {{ formatRating(e.dso.rating) }}
              </td>
              <td class="py-1 px-2 text-right">
                <button
                  type="button"
                  class="btn-icon"
                  :title="
                    t('stats.catalog.showOnMap', { name: formatCatalogId(e.designation, e.dso) })
                  "
                  :aria-label="
                    t('stats.catalog.showOnMap', { name: formatCatalogId(e.designation, e.dso) })
                  "
                  @click="emit('showOnMap', e.dso)"
                >
                  <span v-html="mapPinSvg" class="inline-flex w-4 h-4" aria-hidden="true"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import ConstellationSelector from '../panels/ConstellationSelector.vue';
import { useI18n } from '../../composables/useI18n';
import {
  listCatalogEntries,
  filterCatalogEntries,
  sortCatalogEntries,
  groupCatalogEntries,
  type CatalogEntry,
  type CatalogEntryShow,
  type CatalogEntrySort,
  type CatalogGroup,
  type DSOCatalog,
} from '../../dso-catalog';
import { getConstellationInfos } from '../../star-catalog';
import { formatCatalogId } from '@myastrosky/core/dso-label';
import { formatRating } from '@myastrosky/core/format-utils';
import type { DSO } from '@myastrosky/core/types';
import mapPinSvg from '../../icons/map-pin.svg?raw';

const props = defineProps<{
  catalog: DSOCatalog;
  photographedIds: Set<string>;
}>();

/** The constellations chosen (shared with the statistics page), or null for all. */
const constellations = defineModel<string[] | null>('constellations', { required: true });

const emit = defineEmits<{ showOnMap: [dso: DSO] }>();

const { t, lang } = useI18n();

const SHOWS: CatalogEntryShow[] = ['missing', 'photographed', 'all'];
const SHOW_LABELS: Record<CatalogEntryShow, string> = {
  missing: 'stats.catalog.showMissing',
  photographed: 'stats.catalog.showPhotographed',
  all: 'stats.catalog.showAll',
};
const SORTS: CatalogEntrySort[] = ['interest', 'number', 'magnitude'];
const SORT_LABELS: Record<CatalogEntrySort, string> = {
  interest: 'targets.sort.rating',
  number: 'stats.catalog.sortNumber',
  magnitude: 'stats.catalog.sortMagnitude',
};

const query = ref('');
const show = ref<CatalogEntryShow>('all');
const sort = ref<CatalogEntrySort>('interest');
/** The constellations folded open (all of them while searching). */
const opened = ref<Set<string | null>>(new Set());

const catalogLabel = computed(() => t(`dso.catalogLabels.${props.catalog}`));

const constellationNames = new Map(getConstellationInfos().map((c) => [c.id, c.displayName]));

const all = computed(() =>
  listCatalogEntries(
    props.catalog,
    props.photographedIds,
    constellations.value ? new Set(constellations.value) : null,
  ),
);

const counts = computed(() => {
  const photographed = all.value.filter((e) => e.photographed).length;
  return {
    missing: all.value.length - photographed,
    photographed,
    all: all.value.length,
  };
});

const groups = computed(() =>
  groupCatalogEntries(
    sortCatalogEntries(filterCatalogEntries(all.value, show.value, query.value), sort.value),
    all.value,
    (c) => constellationNames.get(c) ?? c,
    lang,
  ),
);

function groupName(g: CatalogGroup): string {
  return g.constellation === null
    ? t('stats.catalog.noConstellation')
    : (constellationNames.get(g.constellation) ?? g.constellation);
}

function groupPct(g: CatalogGroup): number {
  return g.total > 0 ? Math.round((g.photographed / g.total) * 100) : 0;
}

function isOpen(g: CatalogGroup): boolean {
  return query.value.trim() !== '' || opened.value.has(g.constellation);
}

function toggle(g: CatalogGroup) {
  const next = new Set(opened.value);
  if (next.has(g.constellation)) next.delete(g.constellation);
  else next.add(g.constellation);
  opened.value = next;
}

/** The object's name in the language, when it is not just its designation again. */
function properName(e: CatalogEntry): string {
  const label = formatCatalogId(e.designation, e.dso);
  const name = e.dso.displayName ?? '';
  return name && name !== label && name !== e.designation && name !== e.dso.id ? name : '';
}
</script>
