<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewDidEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { searchUnified, type UnifiedSearchResult } from '@myastrosky/core/search';
import { buildPhotoQueryMatches, smartSortPhotos } from '@myastrosky/core/photo-search';
import type { Photo } from '@myastrosky/core/types';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { presetForSetupId } from '@myastrosky/core/targets/plan-setup';
import { targetFigures } from '@myastrosky/core/targets/figures';
import type { GearPreset } from '@myastrosky/core/gear-presets';
import { getGearSetups, getPhotos } from '@myastrosky/app-state/api';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { targetCard } from '../target-card';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import { isPlaced } from '../sky-map-setup';
import { photoTags } from '../photo-tags';
import { selectSearchResult, skyPhotoFocus, skySelection } from '../composables/useSkySelection';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneTargetRow from '../components/PhoneTargetRow.vue';
import PhoneSegmented from '../components/PhoneSegmented.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneTags from '../components/PhoneTags.vue';
import imageIcon from '@icons/image.svg?raw';

// The boards "Ciel, recherche" and "Ciel, recherche, photos": the results in two tabs. "Ciel": a star or a deep-sky
// object by name or catalogue number. A deep-sky object is listed as the targets of Cibles are, its score and field fit
// for the setup chosen in Cibles; its highest point and its score need the night, so they show only with the sky of
// the day on and a location (the night of the map's date). A star keeps its magnitude line. "Photos": the photos placed on the map, found as the desktop's photo field finds them (by
// name, notes, object, label or point of interest, in its order), each with the chips of what matched. A result is
// chosen with a tap: the map goes to it and selects it.
const router = useRouter();
const field = ref<InstanceType<typeof PhoneSearch> | null>(null);
const query = ref('');
const results = ref<UnifiedSearchResult[]>([]);
let debounce: ReturnType<typeof setTimeout> | undefined;

/** How long a pause in typing is waited for before searching. */
const SEARCH_DELAY_MS = 250;

watch(query, (value) => {
  clearTimeout(debounce);
  const text = value.trim();
  if (!text) {
    results.value = [];
    return;
  }
  debounce = setTimeout(async () => {
    try {
      await catalogsReady();
      const found = await searchUnified(text);
      if (query.value.trim() === text) results.value = found;
    } catch (error) {
      reportError('SkySearchPage.search', error);
    }
  }, SEARCH_DELAY_MS);
});

/** The tab of results shown; it stays while the query changes. */
const tab = ref<'sky' | 'photos'>('sky');
const tabs = computed(() => [
  { value: 'sky' as const, label: t('mobile.tabs.sky') },
  { value: 'photos' as const, label: t('photos.section') },
]);

// The photos placed on the map, read when the page opens.
const placed = ref<Photo[]>([]);
const poiCategories = usePoiCategoriesStore();
async function readPhotos() {
  try {
    const [photos] = await Promise.all([getPhotos(), poiCategories.ensureLoaded()]);
    placed.value = photos.filter(isPlaced);
  } catch (error) {
    reportError('SkySearchPage.photos', error);
  }
}
void readPhotos();

const photoResults = computed(() => {
  const matches = buildPhotoQueryMatches(placed.value, query.value);
  const byId = new Map(matches.map((m) => [m.photo.id, m]));
  return smartSortPhotos(matches.map((m) => m.photo)).map((photo) => {
    const match = byId.get(photo.id)!;
    return {
      photo,
      tags: photoTags(
        { pois: match.matchingPois, labels: match.matchingLabels, dsoIds: match.matchingDsoIds },
        poiCategories.categories,
      ),
    };
  });
});

// The setup chosen in Cibles, read when the page opens: the figures of a deep-sky object are scored with it.
const preset = shallowRef<GearPreset | null>(null);
async function readSetup() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    const [setups, telescopes, cameras, accessories] = await Promise.all([
      getGearSetups(),
      getTelescopes(),
      getCameras(),
      getAccessories(),
    ]);
    const setupId = targetsPrefs.setupId ?? setups[0]?.id ?? null;
    preset.value = presetForSetupId(setupId, { setups, telescopes, cameras, accessories });
  } catch (error) {
    reportError('SkySearchPage.setup', error);
  }
}
void readSetup();

/** The night of the map's date at its location: only with the sky of the day on. */
const time = useSkyTimeStore();
const place = computed(() =>
  time.mode === 'date' && time.lat !== null && time.lon !== null
    ? { lat: time.lat, lon: time.lon, date: time.simDate }
    : null,
);

onIonViewDidEnter(() => field.value?.focus());
onBeforeUnmount(() => clearTimeout(debounce));

/** A star's designation under its name: its Bayer letter and constellation. */
function starDesignation(result: UnifiedSearchResult): string | undefined {
  const { star } = result;
  return star?.name && star.bayer && star.constellation
    ? `${star.bayer} ${star.constellation}`
    : undefined;
}

function row(result: UnifiedSearchResult) {
  const { dso, star } = result;
  if (dso) {
    return targetCard(
      dso,
      targetFigures(dso, place.value, preset.value, targetsPrefs),
      query.value,
    );
  }
  return {
    title: star?.name || result.label,
    designation: starDesignation(result),
    typeLabel: undefined,
    constellation: star?.constellation?.toUpperCase(),
    magnitude: Number.isFinite(result.mag)
      ? `${t('stars.magnitude')} ${result.mag.toFixed(1)}`
      : undefined,
  };
}

/** The rows of the "Ciel" tab, computed again when the results, the map's night or the setup change. */
const skyRows = computed(() => results.value.map((result) => ({ result, row: row(result) })));

function choose(result: UnifiedSearchResult) {
  selectSearchResult(result);
  router.back();
}

/** A photo chosen: the map selects it (its sheet opens) and frames it. */
function choosePhoto(photo: Photo) {
  skySelection.value = { kind: 'photo', photo };
  skyPhotoFocus.value = photo.id;
  router.back();
}

const cancel = () => router.back();
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        ref="field"
        v-model="query"
        clearable
        :placeholder="t('search.placeholder')"
        :label="t('search.placeholder')"
      />
      <PhoneButton variant="text" @click="cancel">{{ t('modal.cancel') }}</PhoneButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-safe mob-page-column mob-page-stack">
        <div class="mob-search-tabs">
          <PhoneSegmented v-model="tab" :options="tabs" :label="t('search.section')" />
        </div>
        <template v-if="tab === 'sky'">
          <PhoneTargetRow
            v-for="({ result, row: r }, index) in skyRows"
            :key="`${result.type}-${index}-${result.label}`"
            v-bind="r"
            @click="choose(result)"
          />
        </template>
        <template v-else-if="query.trim()">
          <PhoneRow
            v-for="r in photoResults"
            :key="r.photo.id"
            :title="r.photo.originalName"
            :thumb="imageIcon"
            roomy
            button
            @click="choosePhoto(r.photo)"
          >
            <template #below><PhoneTags :tags="r.tags" /></template>
          </PhoneRow>
          <div v-if="photoResults.length === 0" class="mob-empty">
            <p class="mob-empty-text m-body">{{ t('photos.searchEmpty') }}</p>
          </div>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>
