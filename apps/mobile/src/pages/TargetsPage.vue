<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import { ALL_DSO_TYPES } from '@myastrosky/core/targets/filters';
import { formatClock24, todayISO } from '@myastrosky/core/targets/format';
import { matchesTargetQuery } from '@myastrosky/core/targets/query';
import type { GearLists } from '@myastrosky/core/targets/plan-setup';
import { runTargetRecommendationSliced } from '@myastrosky/core/targets/recommend';
import { sortSuggestions } from '@myastrosky/core/targets/sorting';
import type { TargetSuggestion } from '@myastrosky/core/target-recommender';
import { getGearSetups, getPhotos } from '@myastrosky/app-state/api';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import { useGrowingList } from '../composables/useGrowingList';
import { reloadTargetsPrefs, targetsPrefs, updateTargetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneTargetRow from '../components/PhoneTargetRow.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import TypesSheet from './targets/TypesSheet.vue';
import SearchSettingsSheet from './targets/SearchSettingsSheet.vue';
import slidersIcon from '../icons/sliders.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// The Cibles tab, from the boards "Cibles", "Cibles, types d'objets", "Cibles, paramètres de recherche", "Cibles,
// aucun setup" and "Cibles, aucun résultat": the targets worth imaging on the chosen night with the chosen setup. Beside
// the search field, one button opens the search settings (sort, night, location, sky, observation window, filters);
// under it, the setup and the number of object types. The list is searched again when one of them has changed.
const router = useRouter();
const { showError } = useErrorToast();
const horizonStore = useHorizonProfileStore();
const regionsStore = useSkyRegionsStore();

/** Rows drawn at first, and added each time the list is scrolled to its end (the search can find thousands). */
const CHUNK = 15;

const search = ref('');
const loading = ref(true);
const gear = shallowRef<GearLists | null>(null);
/** What the search found, in its own order: every sort starts from it, as on the desktop. */
let found: TargetSuggestion[] = [];
const sorted = shallowRef<TargetSuggestion[]>([]);
const emptyKind = ref<'no-setup' | 'no-match'>('no-match');
const typesOpen = ref(false);
const settingsOpen = ref(false);
const setupsOpen = ref(false);
let lastKey = '';

const setup = computed(() => gear.value?.setups.find((s) => s.id === targetsPrefs.setupId));
const setupName = computed(() => setup.value?.name ?? t('targets.gear.noSetup'));
const typeCount = computed(() => targetsPrefs.enabledTypes?.length ?? ALL_DSO_TYPES.length);
const typesValue = computed(() => t('mobile.targets.typesValue', { n: typeCount.value }));
const aria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });
/** The night searched: the last one chosen, as on the desktop, else today. */
const nightISO = computed(() => targetsPrefs.lastDateISO ?? todayISO());
const setupOptions = computed(() =>
  (gear.value?.setups ?? []).map((s) => ({ value: s.id, label: s.name })),
);
const chosenSetupId = computed<string | undefined>({
  get: () => setup.value?.id,
  set: (id) => {
    if (!id) return;
    updateTargetsPrefs({ setupId: id });
    setupsOpen.value = false;
  },
});

const shown = computed(() => {
  const query = search.value.trim();
  const all = query ? sorted.value.filter((s) => matchesTargetQuery(s.dso, query)) : sorted.value;
  return all;
});
// The list is drawn a part at a time: thousands of rows at once froze the page.
const {
  shown: visibleTargets,
  onScroll,
  reset: resetVisible,
} = useGrowingList(() => shown.value, CHUNK);
const rows = computed(() =>
  visibleTargets.value.map((s) => {
    const { dso } = s;
    const mag = dso.mag !== null ? `${t('stars.magnitude')} ${dso.mag.toFixed(1)}` : undefined;
    return {
      id: dso.id,
      title: dso.displayName || dso.catalogs[0] || dso.id,
      designation: dso.displayName ? dso.catalogs[0] || dso.id : undefined,
      typeLabel:
        dso.type === 'MS' && dso.multiplicity
          ? formatMultiplicity(dso.multiplicity, t)
          : t(`dso.types.${dso.type}`),
      constellation: dso.constellation?.toUpperCase(),
      magnitude: mag,
      rating: dso.rating !== null ? '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating) : undefined,
      altitude: formatAlt(s.maxAltDeg),
      time: formatClock24(s.bestTimeUtc),
    };
  }),
);

/** Lets the browser paint the spinner before the long computation blocks the page. */
const nextPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The search in progress, so that the first view's two triggers (mount and entering) do not search twice. */
let loadRunning: Promise<void> | null = null;
function load(): Promise<void> {
  loadRunning ??= loadOnce().finally(() => {
    loadRunning = null;
  });
  return loadRunning;
}

async function loadOnce() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    const [setups, telescopes, cameras, accessories] = await Promise.all([
      getGearSetups(),
      getTelescopes(),
      getCameras(),
      getAccessories(),
      regionsStore.ensureLoaded(),
    ]);
    gear.value = { setups, telescopes, cameras, accessories };
    if (!setups.some((s) => s.id === targetsPrefs.setupId) && setups.length > 0) {
      updateTargetsPrefs({ setupId: setups[0].id });
    }
    await runSearch();
  } catch (error) {
    loading.value = false;
    void showError(error);
  }
}

/** Searches again, unless nothing the search reads has changed since the last time. */
async function runSearch() {
  if (!gear.value) return;
  const { sortBy: _sortBy, pageSize: _pageSize, ...inputs } = targetsPrefs;
  const key = JSON.stringify([
    inputs,
    gear.value.setups,
    nightISO.value,
    horizonStore.profile ? 1 : 0,
    regionsStore.regions,
  ]);
  // The photos can change without the preferences changing: this filter always searches again.
  if (key === lastKey && !targetsPrefs.excludePhotographed) {
    sort();
    return;
  }
  loading.value = true;
  await nextPaint();
  try {
    const photographedIds = targetsPrefs.excludePhotographed
      ? new Set((await getPhotos()).flatMap((p) => p.dsoIds))
      : null;
    const result = await runTargetRecommendationSliced(
      {
        prefs: { ...targetsPrefs },
        dateStr: nightISO.value,
        gear: gear.value,
        photographedIds,
        horizonProfile: horizonStore.profile,
        regions: regionsStore.regions,
      },
      nextPaint,
    );
    lastKey = key;
    if (result.kind === 'ok') {
      found = result.suggestions;
      sorted.value = sortSuggestions(found, targetsPrefs.sortBy ?? 'rating');
      emptyKind.value = 'no-match';
    } else {
      found = [];
      sorted.value = [];
      emptyKind.value = result.reason === 'no-setup' ? 'no-setup' : 'no-match';
    }
    resetVisible();
  } catch (error) {
    lastKey = '';
    found = [];
    sorted.value = [];
    void showError(error);
  } finally {
    loading.value = false;
  }
}

function sort() {
  sorted.value = sortSuggestions(found, targetsPrefs.sortBy ?? 'rating');
  loading.value = false;
}

void load();
onIonViewWillEnter(load);

/** A sheet closed: the changes it made are searched for again. */
function closed(open: boolean) {
  if (!open) void runSearch();
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        v-model="search"
        :placeholder="t('mobile.targets.searchPlaceholder')"
        :label="t('mobile.targets.searchLabel')"
      />
      <PhoneIconButton :label="t('targets.formTitle')" @click="settingsOpen = true"
        ><AppIcon :svg="slidersIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <div class="mob-context" style="flex: none">
      <PhoneButton
        variant="field"
        :aria-label="aria(t('mobile.targets.fieldGear'), setupName)"
        @click="setupsOpen = true"
      >
        <span class="mob-btn-label">{{ setupName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
      <PhoneButton
        class="mob-context-types"
        variant="field"
        :aria-label="aria(t('targets.typeFilter'), typesValue)"
        @click="typesOpen = true"
      >
        <span class="mob-btn-label">{{ typesValue }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <IonContent :scroll-y="false">
      <div
        class="mob-scroll mob-page-fill"
        style="background: var(--bg-panel)"
        @scroll.passive="onScroll"
      >
        <div v-if="loading" class="mob-empty"><PhoneBusy page /></div>
        <PhoneEmptyState
          v-else-if="emptyKind === 'no-setup' && sorted.length === 0"
          :text="t('fovOverlay.noSetups')"
          :button-label="t('fovOverlay.addSetup')"
          :button-icon="plusIcon"
          @action="router.push('/settings/setups')"
        />
        <div v-else-if="rows.length === 0" class="mob-empty">
          <p class="mob-empty-text m-body">{{ t('targets.results.empty') }}</p>
        </div>
        <div v-else class="mob-cols2">
          <PhoneTargetRow
            v-for="row in rows"
            :key="row.id"
            :title="row.title"
            :designation="row.designation"
            :type-label="row.typeLabel"
            :constellation="row.constellation"
            :magnitude="row.magnitude"
            :rating="row.rating"
            :altitude="row.altitude"
            :time="row.time"
            @click="router.push(`/targets/${encodeURIComponent(row.id)}`)"
          />
        </div>
      </div>
    </IonContent>
    <TypesSheet v-model:open="typesOpen" @update:open="closed" />
    <SearchSettingsSheet v-model:open="settingsOpen" @update:open="closed" />
    <PhoneRadioSheet
      v-model:open="setupsOpen"
      v-model:value="chosenSetupId"
      :title="t('targets.gear.setup')"
      :options="setupOptions"
      @update:open="closed"
    />
  </IonPage>
</template>
