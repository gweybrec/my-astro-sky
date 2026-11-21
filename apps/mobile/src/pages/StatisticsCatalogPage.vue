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
import PhoneButton from '../components/PhoneButton.vue';
import AppIcon from '../components/AppIcon.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import PhoneObjectRow from '../components/PhoneObjectRow.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import SkyCheckSheet from './sky/SkyCheckSheet.vue';
import { catalogsReady } from '../catalogs';
import {
  statisticsConstellations,
  useStatisticsConstellations,
} from '../composables/useStatisticsFilter';
import { useShowTargetOnMap } from '../composables/useShowTargetOnMap';
import caretIcon from '../icons/chevron-down.svg?raw';
import sortIcon from '../icons/arrow-up-down.svg?raw';

// The board "Réglages, statistiques, un catalogue": one catalogue's objects in the constellations chosen on the
// statistics page (changed here too), all, the missing or the photographed ones, by constellation in folds, sorted by
// photographic interest, number or magnitude; the search and these choices stay at the top while the list scrolls. Each object's map button shows it on the sky map; the map's back button comes back here.
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
  loadConstellations();
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
const show = ref<CatalogEntryShow>('all');
const sort = ref<CatalogEntrySort>('interest');
const sortOpen = ref(false);
const constellationsOpen = ref(false);
const {
  options: constellationOptions,
  selected: selectedConstellations,
  load: loadConstellations,
} = useStatisticsConstellations();
const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
const fieldAria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });
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
/** The order on its button, in a short name that fits half the toolbar in every language (the sheet keeps the full one). */
const SORT_SHORT_KEYS: Record<CatalogEntrySort, string> = {
  interest: 'mobile.stats.sortShort.interest',
  number: 'mobile.stats.sortShort.number',
  magnitude: 'mobile.stats.sortShort.magnitude',
};
const sortShort = computed(() => t(SORT_SHORT_KEYS[sort.value]));

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
          <div class="stats-catalog-filters">
            <PhoneButton
              variant="field"
              :aria-label="
                countAria(
                  t('targets.constellationFilter'),
                  selectedConstellations.length,
                  constellationOptions.length,
                )
              "
              @click="constellationsOpen = true"
            >
              <span class="mob-btn-label">{{
                selectedConstellations.length === 1
                  ? t('mobile.stats.constellationsValueOne')
                  : t('mobile.stats.constellationsValue', { n: selectedConstellations.length })
              }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
            <PhoneButton
              variant="field"
              :aria-label="fieldAria(t('targets.sort.label'), sortLabel)"
              @click="sortOpen = true"
            >
              <AppIcon cls="mob-icon--sm" :svg="sortIcon" />
              <span class="mob-btn-label">{{ sortShort }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
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
    <SkyCheckSheet
      v-model:open="constellationsOpen"
      v-model:selected="selectedConstellations"
      :title="t('targets.constellationFilter')"
      :options="constellationOptions"
    />
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
/* The search and the choices stay at the top while the list scrolls (sticky through .mob-search-tabs); a hairline
   marks where the list starts. */
.stats-catalog-tools {
  border-bottom: 1px solid var(--border-panel);
}
/* The constellations and the order are two field buttons sharing a line, as wide as the search field above them, each
   showing its value as on the Targets tab (the order after the sort icon), then the caret. */
.stats-catalog-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: var(--space-4);
  padding: 0 var(--mobile-gutter-end) var(--space-4) var(--mobile-gutter);
}
/* The inset is the label's own (`.mob-btn-content`), never the host's, so that it is not counted twice. */
.stats-catalog-filters > ion-button.mob-btn--field {
  padding: 0;
}
.stats-catalog-filters > ion-button.mob-btn--field :deep(.mob-btn-content) {
  gap: var(--space-3);
  padding: 0 var(--space-5);
}
.stats-catalog-filters .mob-btn-label {
  flex: 1;
  text-align: start;
}
/* In landscape the search and the choice of objects share a line, then the two buttons, each under one of them, so that
   the list keeps some height. */
@media (orientation: landscape) {
  .stats-catalog-tools {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
  }
  .stats-catalog-tools > .mob-form-row + .mob-form-row {
    padding-inline-start: 0;
  }
  .stats-catalog-filters {
    display: contents;
  }
  .stats-catalog-filters > .mob-btn--field {
    margin: 0 var(--mobile-gutter-end) var(--space-4) var(--mobile-gutter);
  }
  .stats-catalog-filters > .mob-btn--field + .mob-btn--field {
    margin-inline-start: 0;
  }
}
</style>
