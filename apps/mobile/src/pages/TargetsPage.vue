<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import { ALL_DSO_TYPES } from '@myastrosky/core/targets/filters';
import { formatClock24, todayISO } from '@myastrosky/core/targets/format';
import { planSearchPrefs } from '@myastrosky/core/targets/night';
import { matchesTargetQuery } from '@myastrosky/core/targets/query';
import type { GearLists } from '@myastrosky/core/targets/plan-setup';
import {
  runTargetRecommendationSliced,
  type RecommendationEmptyReason,
} from '@myastrosky/core/targets/recommend';
import { shuffleArray, sortSuggestions } from '@myastrosky/core/targets/sorting';
import type { TargetSuggestion } from '@myastrosky/core/target-recommender';
import { getGearSetups, getPhotos } from '@myastrosky/app-state/api';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import { useLandscape } from '../composables/useLandscape';
import { useGrowingList } from '../composables/useGrowingList';
import { reloadTargetsPrefs, targetsPrefs, updateTargetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
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
import shuffleIcon from '../icons/shuffle.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The Cibles tab, from the boards "Cibles", "Cibles, types d'objets", "Cibles, paramètres de recherche", "Cibles,
// aucun setup" and "Cibles, aucun résultat": the targets worth imaging on the chosen night with the chosen setup. Beside
// the search field, one button opens the search settings (sort, night, location, sky, observation window, filters);
// under it, the setup and the number of object types. The list is searched again when one of them has changed.
// Opened from a plan's plus (`/plans/:id/targets`, boards "Plan, ajouter une cible"), the list is that plan's, as the
// desktop's "Trouver des cibles" of a plan: a title bar with the plan's name (in landscape the search shares it), the
// search run for the plan's place, night and setup (the setup shown as text: it is changed on the plan), and a result
// opens its page for that plan. The Cibles settings are not changed by it.
// The shuffle button (boards "Cibles, au hasard") is the desktop's "Cibles aléatoires": each tap mixes what the search
// found again, and the chosen sort still orders it, so only the targets that tie change places.
const route = useRoute();
const router = useRouter();
const plans = usePlansStore();
const { showError, showNotice } = useErrorToast();
const horizonStore = useHorizonProfileStore();
const regionsStore = useSkyRegionsStore();

/** Rows drawn at first, and added each time the list is scrolled to its end (the search can find thousands). */
const CHUNK = 15;

const search = ref('');
const loading = ref(true);
const gear = shallowRef<GearLists | null>(null);
/** What the search found, in its own order: every sort starts from it, as on the desktop. */
let found: TargetSuggestion[] = [];
/** What the sort orders: what the search found, or it shuffled by the shuffle button until the next search. */
let pool: TargetSuggestion[] = [];
let shuffled = false;
const sorted = shallowRef<TargetSuggestion[]>([]);
const scroller = ref<HTMLElement | null>(null);
/** Why the list is empty: the search found nothing, or it could not run (each reason has its own board). */
const emptyKind = ref<RecommendationEmptyReason | 'no-match'>('no-match');
const typesOpen = ref(false);
const settingsOpen = ref(false);
const setupsOpen = ref(false);
let lastKey = '';
/** Counts the searches: one that a newer search started after writes nothing when it ends. */
let searchRun = 0;

/** The plan the list adds to, when it was opened from one. */
const planId = computed(() => (route.params.id ? String(route.params.id) : null));
const plan = computed(() =>
  planId.value ? plans.plans.find((p) => p.id === planId.value) : undefined,
);
/** What the search reads: the Cibles settings, with the plan's place, night and setup over them. */
const searchPrefs = computed(() =>
  plan.value ? planSearchPrefs({ ...targetsPrefs }, plan.value) : { ...targetsPrefs },
);

// In landscape the plan's title bar holds the search too (one bar, as the landscape board draws it).
const landscape = useLandscape();

const setup = computed(() => gear.value?.setups.find((s) => s.id === searchPrefs.value.setupId));
const setupName = computed(() => setup.value?.name ?? t('targets.gear.noSetup'));
const typeCount = computed(() => targetsPrefs.enabledTypes?.length ?? ALL_DSO_TYPES.length);
const typesValue = computed(() => t('mobile.targets.typesValue', { n: typeCount.value }));
const aria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });
/** The night searched: the last one chosen, as on the desktop, else today. */
const nightISO = computed(() => searchPrefs.value.lastDateISO ?? todayISO());
const setupOptions = computed(() =>
  (gear.value?.setups ?? []).map((s) => ({ value: s.id, label: s.name })),
);
const chosenSetupId = computed<string | undefined>({
  get: () => setup.value?.id,
  set: (id) => {
    if (!id) return;
    updateTargetsPrefs({ setupId: id });
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
    if (planId.value) await plans.load();
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
  const { sortBy: _sortBy, pageSize: _pageSize, ...inputs } = searchPrefs.value;
  const key = JSON.stringify([
    inputs,
    gear.value.setups,
    nightISO.value,
    horizonStore.profile ? 1 : 0,
    regionsStore.regions,
  ]);
  // The photos can change without the preferences changing: this filter always searches again.
  const run = ++searchRun;
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
        prefs: searchPrefs.value,
        dateStr: nightISO.value,
        gear: gear.value,
        photographedIds,
        horizonProfile: horizonStore.profile,
        regions: regionsStore.regions,
      },
      nextPaint,
    );
    if (run !== searchRun) return;
    // The same settings searched again (only the photos may have changed): a shuffle is kept.
    const keepShuffle = shuffled && key === lastKey;
    lastKey = key;
    if (result.kind === 'ok') {
      found = result.suggestions;
      pool = keepShuffle ? inOrderOf(found, pool) : found;
      shuffled = keepShuffle;
      sorted.value = sortSuggestions(pool, targetsPrefs.sortBy ?? 'rating');
      emptyKind.value = 'no-match';
    } else {
      found = pool = [];
      shuffled = false;
      sorted.value = [];
      emptyKind.value = result.reason;
    }
    resetVisible();
  } catch (error) {
    if (run !== searchRun) return;
    lastKey = '';
    found = pool = [];
    shuffled = false;
    sorted.value = [];
    emptyKind.value = 'no-match';
    void showError(error);
  } finally {
    if (run === searchRun) loading.value = false;
  }
}

function sort() {
  sorted.value = sortSuggestions(pool, targetsPrefs.sortBy ?? 'rating');
  loading.value = false;
}

/** `list` in the order its targets have in `order`; those not in it come last. */
function inOrderOf(list: TargetSuggestion[], order: TargetSuggestion[]): TargetSuggestion[] {
  const rank = new Map(order.map((s, i) => [s.dso.id, i]));
  const at = (s: TargetSuggestion) => rank.get(s.dso.id) ?? order.length;
  return [...list].sort((a, b) => at(a) - at(b));
}

/** Mixes what the search found again, shows the list from its top, and says so. */
function shuffle() {
  pool = shuffleArray(found);
  shuffled = true;
  sort();
  resetVisible();
  scroller.value?.scrollTo({ top: 0 });
  void showNotice(t('mobile.targets.shuffled'));
}

void load();
onIonViewWillEnter(load);

/** A sheet closed: the changes it made are searched for again. */
function closed(open: boolean) {
  if (!open) void runSearch();
}

function openTarget(id: string) {
  const path = planId.value ? `/plans/${planId.value}/targets` : '/targets';
  void router.push(`${path}/${encodeURIComponent(id)}`);
}
</script>

<template>
  <IonPage>
    <PhoneTopBar v-if="planId && !landscape">
      <PhoneBackButton :fallback="`/plans/${planId}`" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ plan?.name }}</h1>
    </PhoneTopBar>
    <PhoneTopBar>
      <template v-if="planId && landscape">
        <PhoneBackButton :fallback="`/plans/${planId}`" />
        <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ plan?.name }}</h1>
      </template>
      <PhoneSearch
        v-model="search"
        :placeholder="t('mobile.targets.searchPlaceholder')"
        :label="t('mobile.targets.searchLabel')"
      />
      <PhoneIconButton
        :label="t('targets.generateRandom')"
        :disabled="loading || shown.length === 0"
        @click="shuffle"
        ><AppIcon :svg="shuffleIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('targets.formTitle')" @click="settingsOpen = true"
        ><AppIcon :svg="slidersIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <div class="mob-context" style="flex: none">
      <span v-if="planId" class="mob-context-setup mob-btn-label m-secondary">{{ setupName }}</span>
      <PhoneButton
        v-else
        variant="field"
        :aria-label="aria(t('mobile.targets.fieldGear'), setupName)"
        @click="setupsOpen = true"
      >
        <span class="mob-btn-label">{{ setupName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
      <PhoneButton
        class="mob-context-types"
        :class="{ 'mob-context-types--grow': planId }"
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
        ref="scroller"
        class="mob-scroll mob-page-fill"
        :class="{ 'mob-page-safe': planId }"
        style="background: var(--bg-panel)"
        @scroll.passive="onScroll"
      >
        <div v-if="loading" class="mob-empty"><PhoneBusy page /></div>
        <PhoneEmptyState
          v-else-if="emptyKind === 'no-setup'"
          :text="t('fovOverlay.noSetups')"
          :button-label="t('fovOverlay.addSetup')"
          :button-icon="plusIcon"
          @action="router.push('/settings/setups')"
        />
        <PhoneEmptyState
          v-else-if="emptyKind === 'no-location'"
          :text="t('targets.location.notSet')"
          :button-label="t('targets.location.label')"
          :button-icon="mapPinIcon"
          @action="router.push('/settings/location')"
        />
        <PhoneEmptyState
          v-else-if="emptyKind === 'no-window-overlap'"
          :text="t('targets.results.noWindowOverlap')"
          :button-label="t('targets.formTitle')"
          :button-icon="slidersIcon"
          @action="settingsOpen = true"
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
            @click="openTarget(row.id)"
          />
        </div>
      </div>
    </IonContent>
    <TypesSheet v-model:open="typesOpen" @update:open="closed" />
    <SearchSettingsSheet v-model:open="settingsOpen" :plan-mode="!!planId" @update:open="closed" />
    <PhoneRadioSheet
      v-model:open="setupsOpen"
      v-model:value="chosenSetupId"
      :title="t('targets.gear.setup')"
      :options="setupOptions"
      @update:open="closed"
    />
  </IonPage>
</template>
