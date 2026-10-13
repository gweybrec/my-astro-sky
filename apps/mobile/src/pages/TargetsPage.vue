<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatLatLon } from '@myastrosky/core/observer-location';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import { ALL_DSO_TYPES } from '@myastrosky/core/targets/filters';
import { formatClock24, todayISO } from '@myastrosky/core/targets/format';
import { matchesTargetQuery } from '@myastrosky/core/targets/query';
import { formatPlanDate } from '@myastrosky/core/targets/plan';
import type { GearLists } from '@myastrosky/core/targets/plan-setup';
import { runTargetRecommendationSliced } from '@myastrosky/core/targets/recommend';
import { sortSuggestions } from '@myastrosky/core/targets/sorting';
import type { TargetSuggestion } from '@myastrosky/core/target-recommender';
import { getGearSetups, getPhotos } from '@myastrosky/app-state/api';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import { reloadTargetsPrefs, targetsPrefs, updateTargetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneTargetRow from '../components/PhoneTargetRow.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import PhoneNativePicker from '../components/PhoneNativePicker.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import TypesSheet from './targets/TypesSheet.vue';
import FiltersSheet from './targets/FiltersSheet.vue';
import filterIcon from '../icons/filter.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// The Cibles tab, from the boards "Cibles", "Cibles, types d'objets", "Cibles, filtres", "Cibles, aucun setup" and
// "Cibles, aucun résultat": the targets worth imaging on the chosen night with the chosen setup, searched again when the
// setup, the night, the location or a filter has changed. The three fields at the top are the desktop form's setup,
// date and location: a list of the setups, the phone's date picker, and the "Lieu d'observation" page.
const router = useRouter();
const { showError } = useErrorToast();
const horizonStore = useHorizonProfileStore();
const regionsStore = useSkyRegionsStore();

/** Rows drawn at first, and added each time the list is scrolled to its end (the search can find thousands). */
const CHUNK = 15;

const search = ref('');
const loading = ref(true);
const gear = shallowRef<GearLists | null>(null);
const sorted = shallowRef<TargetSuggestion[]>([]);
const emptyKind = ref<'no-setup' | 'no-match'>('no-match');
const visible = ref(CHUNK);
const typesOpen = ref(false);
const filtersOpen = ref(false);
const setupsOpen = ref(false);
const nightPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
let lastKey = '';

const setup = computed(() => gear.value?.setups.find((s) => s.id === targetsPrefs.setupId));
const setupName = computed(() => setup.value?.name ?? t('targets.gear.noSetup'));
const place = computed(() =>
  formatLatLon({ lat: targetsPrefs.lat ?? null, lon: targetsPrefs.lon ?? null }),
);
const typeCount = computed(() => targetsPrefs.enabledTypes?.length ?? ALL_DSO_TYPES.length);
const typesValue = computed(() => t('mobile.targets.typesValue', { n: typeCount.value }));
/** The night searched: the last one chosen, as on the desktop, else today. */
const nightISO = computed(() => targetsPrefs.lastDateISO ?? todayISO());
const nightLabel = computed(() =>
  nightISO.value === todayISO()
    ? t('mobile.targets.tonight')
    : formatPlanDate(nightISO.value, getLang()),
);
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

function pickNight(dateISO: string) {
  updateTargetsPrefs({ lastDateISO: dateISO });
  void runSearch();
}
const aria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });

const shown = computed(() => {
  const query = search.value.trim();
  const all = query ? sorted.value.filter((s) => matchesTargetQuery(s.dso, query)) : sorted.value;
  return all;
});
const rows = computed(() =>
  shown.value.slice(0, visible.value).map((s) => {
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

function onScroll(event: Event) {
  const el = event.target as HTMLElement;
  if (
    el.scrollTop + el.clientHeight > el.scrollHeight - 400 &&
    visible.value < shown.value.length
  ) {
    visible.value += CHUNK;
  }
}

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
      sorted.value = sortSuggestions(result.suggestions, targetsPrefs.sortBy ?? 'rating');
      emptyKind.value = 'no-match';
    } else {
      sorted.value = [];
      emptyKind.value = result.reason === 'no-setup' ? 'no-setup' : 'no-match';
    }
    visible.value = CHUNK;
  } catch (error) {
    lastKey = '';
    sorted.value = [];
    void showError(error);
  } finally {
    loading.value = false;
  }
}

function sort() {
  sorted.value = sortSuggestions(sorted.value, targetsPrefs.sortBy ?? 'rating');
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
      <PhoneIconButton :label="t('targets.moreFilters')" @click="filtersOpen = true"
        ><AppIcon :svg="filterIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <div class="mob-context mob-context--wrap" style="flex: none">
      <div class="mob-context-row">
        <PhoneButton
          variant="field"
          :aria-label="aria(t('mobile.targets.fieldGear'), setupName)"
          @click="setupsOpen = true"
        >
          <span class="mob-btn-label">{{ setupName }}</span>
          <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
        </PhoneButton>
        <PhoneButton
          variant="field"
          :aria-label="aria(t('mobile.targets.fieldNight'), nightLabel.toLowerCase())"
          @click="nightPicker?.open()"
        >
          <span class="mob-btn-label">{{ nightLabel }}</span>
          <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
        </PhoneButton>
        <PhoneButton
          variant="field"
          :aria-label="aria(t('mobile.targets.fieldPlace'), place)"
          @click="router.push('/settings/location')"
        >
          <span class="mob-btn-label">{{ place }}</span>
          <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
        </PhoneButton>
        <PhoneNativePicker ref="nightPicker" type="date" :value="nightISO" @pick="pickNight" />
      </div>
      <PhoneButton
        class="mob-context-types"
        variant="field"
        block
        :aria-label="aria(t('targets.typeFilter'), typesValue)"
        @click="typesOpen = true"
      >
        <span class="mob-btn-key">{{ t('targets.typeFilter') }}</span>
        <span class="mob-btn-value">{{ typesValue }}</span>
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
          <!-- A tap on a target opens its sheet on the sky map, which is a later card: the row does nothing yet. -->
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
          />
        </div>
      </div>
    </IonContent>
    <TypesSheet v-model:open="typesOpen" @update:open="closed" />
    <FiltersSheet v-model:open="filtersOpen" @update:open="closed" />
    <PhoneRadioSheet
      v-model:open="setupsOpen"
      v-model:value="chosenSetupId"
      :title="t('targets.gear.setup')"
      :options="setupOptions"
      @update:open="closed"
    />
  </IonPage>
</template>
