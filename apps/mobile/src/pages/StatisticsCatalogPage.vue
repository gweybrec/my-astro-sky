<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t, getLang } from '@myastrosky/core/i18n/index';
import {
  DSO_CATALOGS_ALL,
  getDSOById,
  listCatalogEntries,
  filterCatalogEntries,
  sortCatalogEntries,
  groupCatalogEntries,
  type CatalogEntry,
  type CatalogEntryShow,
  type CatalogEntrySort,
  type CatalogGroup,
  type DSOCatalog,
} from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import { formatCatalogId } from '@myastrosky/core/dso-label';
import { formatRating } from '@myastrosky/core/format-utils';
import { getPhotos } from '@myastrosky/app-state/api';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneSegmented from '../components/PhoneSegmented.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneInfoButton from '../components/PhoneInfoButton.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import PhoneObjectRow from '../components/PhoneObjectRow.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import { catalogsReady } from '../catalogs';
import { statisticsConstellations } from '../composables/useStatisticsFilter';
import { useShowTargetOnMap } from '../composables/useShowTargetOnMap';

// The board "Réglages, statistiques, un catalogue": one catalogue's objects in the constellations chosen on the
// statistics page, the missing, photographed or all of them, by constellation in folds, sorted by photographic interest,
// number or magnitude. Each object's map button shows it on the sky map; the map's back button comes back here.
const route = useRoute();
const param = String(route.params.catalog);
const catalog: DSOCatalog = (DSO_CATALOGS_ALL as string[]).includes(param)
  ? (param as DSOCatalog)
  : 'M';
const catalogLabel = t(`dso.catalogLabels.${catalog}`);

const photographedIds = shallowRef<Set<string>>(new Set());
const ready = ref(false);
const constellationNames = shallowRef(new Map<string, string>());

onMounted(async () => {
  const [photos] = await Promise.all([getPhotos(), catalogsReady()]);
  constellationNames.value = new Map(getConstellationInfos().map((c) => [c.id, c.displayName]));
  const ids = new Set<string>();
  for (const photo of photos) {
    for (const dsoId of photo.dsoIds) {
      const dso = getDSOById(dsoId);
      if (dso) ids.add(dso.id);
    }
  }
  photographedIds.value = ids;
  ready.value = true;
});

const query = ref('');
const show = ref<CatalogEntryShow>('missing');
const sort = ref<CatalogEntrySort>('interest');
const sortOpen = ref(false);
/** The constellations folded open (all of them while searching). */
const opened = ref<Set<string | null>>(new Set());

const showOptions = [
  { value: 'missing' as const, label: t('stats.catalog.showMissing') },
  { value: 'photographed' as const, label: t('stats.catalog.showPhotographed') },
  { value: 'all' as const, label: t('stats.catalog.showAll') },
];
const sortOptions = [
  { value: 'interest' as const, label: t('targets.sort.rating') },
  { value: 'number' as const, label: t('stats.catalog.sortNumber') },
  { value: 'magnitude' as const, label: t('stats.catalog.sortMagnitude') },
];
const sortLabel = computed(() => sortOptions.find((o) => o.value === sort.value)?.label ?? '');

const all = computed<CatalogEntry[]>(() =>
  ready.value
    ? listCatalogEntries(
        catalog,
        photographedIds.value,
        statisticsConstellations.value ? new Set(statisticsConstellations.value) : null,
      )
    : [],
);
const photographedCount = computed(() => all.value.filter((e) => e.photographed).length);

const groups = computed(() =>
  groupCatalogEntries(
    sortCatalogEntries(filterCatalogEntries(all.value, show.value, query.value), sort.value),
    all.value,
    (c) => constellationNames.value.get(c) ?? c,
    getLang(),
  ),
);

function groupName(g: CatalogGroup): string {
  return g.constellation === null
    ? t('stats.catalog.noConstellation')
    : (constellationNames.value.get(g.constellation) ?? g.constellation);
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
function properName(e: CatalogEntry): string | undefined {
  const label = formatCatalogId(e.designation, e.dso);
  const name = e.dso.displayName ?? '';
  return name && name !== label && name !== e.designation && name !== e.dso.id ? name : undefined;
}

const page = `/settings/statistics/${catalog}`;
const showTargetOnMap = useShowTargetOnMap({
  tab: 'settings',
  pages: ['/settings/statistics'],
  page,
  pageOf: () => page,
});
async function showOnMap(e: CatalogEntry) {
  await showTargetOnMap(e.dso, null);
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/settings/statistics" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ catalogLabel }}</h1>
      <span class="stats-catalog-count m-mono">{{ photographedCount }} / {{ all.length }}</span>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-safe mob-page-column">
        <div class="mob-search-tabs stats-catalog-tools">
          <div class="mob-form-row stats-catalog-search">
            <PhoneSearch
              v-model="query"
              clearable
              :placeholder="t('stats.catalog.search', { catalog: catalogLabel })"
              :label="t('stats.catalog.search', { catalog: catalogLabel })"
            />
          </div>
          <PhoneSegmented v-model="show" :options="showOptions" :label="t('stats.catalog.shown')" />
          <div class="stats-catalog-sort">
            <PhoneRow
              :title="t('targets.sort.label')"
              :value="sortLabel"
              button
              chevron
              @click="sortOpen = true"
            />
            <PhoneInfoButton
              :title="t('targets.sort.rating')"
              :message="t('targets.tooltips.rating')"
            />
          </div>
        </div>
        <PhoneHelper v-if="ready && groups.length === 0">{{
          t('stats.catalog.empty')
        }}</PhoneHelper>
        <template v-for="g in groups" :key="g.constellation ?? ''">
          <PhoneRow
            :title="groupName(g)"
            :value="`${g.photographed} / ${g.total}`"
            mono
            button
            chevron
            :expanded="isOpen(g)"
            @click="toggle(g)"
          />
          <template v-if="isOpen(g)">
            <PhoneObjectRow
              v-for="e in g.entries"
              :key="e.dso.id"
              :designation="formatCatalogId(e.designation, e.dso)"
              :name="properName(e)"
              :photographed="e.photographed"
              :type-label="t(`dso.types.${e.dso.type}`)"
              :magnitude="
                e.dso.mag !== null
                  ? t('stats.catalog.magValue', { mag: e.dso.mag.toFixed(1) })
                  : undefined
              "
              :rating="formatRating(e.dso.rating) || undefined"
              :rating-label="
                e.dso.rating !== null
                  ? t('stats.catalog.ratingAria', { n: e.dso.rating })
                  : undefined
              "
              @map="showOnMap(e)"
            />
          </template>
        </template>
      </div>
    </IonContent>
    <PhoneRadioSheet
      v-model:open="sortOpen"
      v-model:value="sort"
      :title="t('targets.sort.label')"
      :options="sortOptions"
    />
  </IonPage>
</template>

<style scoped>
/* The count of the catalogue at the end of the top bar, on the title's line. */
.stats-catalog-count {
  flex: none;
  padding-inline-end: var(--mobile-gutter-end);
  color: var(--text-secondary);
}
/* The search field takes the whole row. */
.stats-catalog-search {
  display: flex;
}
.stats-catalog-search > * {
  flex: 1;
  min-width: 0;
}
/* "Trier par" and the "i" that explains the photographic interest share one line; the row gives way to the button. */
.stats-catalog-sort {
  display: flex;
  align-items: center;
  padding-inline-end: var(--mobile-gutter-end);
}
.stats-catalog-sort > :first-child {
  flex: 1;
  min-width: 0;
}
/* In landscape the search and the choice of objects share a line, so that the list keeps some height. */
@media (orientation: landscape) {
  .stats-catalog-tools {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
  }
  .stats-catalog-tools > .mob-form-row + .mob-form-row {
    padding-inline-start: 0;
  }
  .stats-catalog-tools > .stats-catalog-sort {
    grid-column: 1 / -1;
  }
}
</style>
