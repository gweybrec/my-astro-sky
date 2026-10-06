<template>
  <IdentifyModalShell
    :photo="photo"
    modal-class="comet-identify-modal"
    :title="t('comet.title')"
    :intro="t('comet.intro')"
    :can-search="!!obsIso"
    :searching="searching"
    :error-message="searchErrorMessage"
    :selected-count="selected.size"
    @close="$emit('close')"
    @search="onSearch"
    @add="onAdd"
    @photo-click="onPhotoClick"
  >
    <template #labels>
      <label class="metadata-label">{{ t('identify.obsDateLabel') }}</label>
    </template>
    <template #inputs>
      <div class="flex gap-2">
        <input v-model="obsDateStr" type="date" class="dialog-input flex-[3_1_0%]" />
        <input v-model="obsTimeStr" type="time" class="dialog-input flex-[2_1_0%]" />
      </div>
    </template>
    <template #fields-hint>
      <div v-if="!obsIso" class="text-[var(--text-warning-sm)]">
        {{ t('identify.dateRequired') }}
      </div>
    </template>

    <!-- Clicking the photo (not dragging it) moves the active comet's pin onto the
         nucleus actually seen, when the prediction is a few arcminutes off. -->
    <template #photo-hint>
      <div v-if="results?.inFrame.length" class="text-hint">
        {{ t('comet.clickToAdjust', { name: activeName ?? '' }) }}
      </div>
    </template>

    <template #markers="{ toDisplay }">
      <template v-for="c in results?.inFrame ?? []" :key="c.name">
        <span
          v-if="toDisplay(pinPixel(c))"
          class="absolute w-[28px] h-[28px] -ml-[14px] -mt-[14px] pointer-events-none transition-transform [&>svg]:w-full [&>svg]:h-full"
          :class="{ 'opacity-40': !selected.has(c.name), 'scale-150': hovered === c.name }"
          :style="{
            left: `${toDisplay(pinPixel(c))!.left}px`,
            top: `${toDisplay(pinPixel(c))!.top}px`,
            color: pinColor,
          }"
          v-html="pinSvg"
        ></span>
      </template>
    </template>

    <template #results>
      <div v-if="results" class="flex flex-col gap-1">
        <div v-if="results.inFrame.length === 0" class="text-hint">
          {{ t('comet.noCandidates') }}
        </div>
        <div
          v-for="c in results.inFrame"
          :key="c.name"
          class="flex items-start gap-3 py-2 px-3 border border-solid rounded-sm cursor-pointer"
          :class="
            activeName === c.name
              ? 'border-[var(--border-focus)] bg-[var(--accent-fill-sm)]'
              : 'border-[var(--border-panel)]'
          "
          @click="activeName = c.name"
          @mouseenter="hovered = c.name"
          @mouseleave="hovered = null"
        >
          <input
            type="checkbox"
            class="mt-1"
            :checked="selected.has(c.name)"
            @click.stop
            @change="toggle(c.name, ($event.target as HTMLInputElement).checked)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ c.name }}</span>
              <span v-if="overrides.has(c.name)" class="tag-chip-sm">
                {{ t('comet.adjusted') }}
              </span>
              <a
                :href="jplLookupUrl(c.designation)"
                target="_blank"
                rel="noopener noreferrer"
                class="settings-link ml-auto text-small"
                @click.stop
                >{{ t('comet.viewOnJpl') }}</a
              >
            </div>
            <div class="text-hint text-small">
              {{ t('comet.colMag') }} {{ c.mag?.toFixed(1) ?? '—' }} ·
              {{ t('comet.rate', { n: c.rateArcminPerHour.toFixed(1) }) }}
              <template v-if="overrides.has(c.name)">
                ·
                <button
                  type="button"
                  class="settings-link bg-transparent border-none p-0 cursor-pointer text-small"
                  @click.stop="resetPosition(c.name)"
                >
                  {{ t('comet.resetPosition') }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Comets just outside the frame: usually a sign that the observation date
             or time is off (a comet can move degrees in a few days). Not addable. -->
        <template v-if="results.nearby.length">
          <div class="metadata-label mt-3">{{ t('comet.nearbyTitle') }}</div>
          <div class="text-hint text-small">{{ t('comet.nearbyHint') }}</div>
          <div
            v-for="c in results.nearby"
            :key="c.name"
            class="flex items-center gap-2 py-1 px-3 text-small"
          >
            <span>{{ c.name }}</span>
            <span class="text-hint">
              · {{ t('comet.awayDeg', { n: c.separationDeg.toFixed(1) }) }} ·
              {{ t('comet.colMag') }} {{ c.mag?.toFixed(1) ?? '—' }}
            </span>
          </div>
        </template>
      </div>
    </template>
  </IdentifyModalShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import IdentifyModalShell from './IdentifyModalShell.vue';
import { t } from '../../i18n';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import { withCanonicalProjection } from '@myastrosky/core/projection';
import { cometElementsAPI } from '../../api';
import {
  isoToUtcParts,
  utcPartsToIso,
  photoPixelToRaDec,
} from '@myastrosky/core/asteroid-identify';
import {
  findComets,
  candidateToPoi,
  jplLookupUrl,
  COMET_CATEGORY_ID,
  type CometSearchResult,
  type PlacedComet,
} from '@myastrosky/core/comet-identify';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { resolveCategory } from '@myastrosky/core/poi';
import { reportUnknownRendererError } from '../../error-reporter';
import pinSvg from '../../icons/supernova-pin.svg?raw';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';

const props = defineProps<{ photo: Photo }>();
// The modal never persists: the caller (PoiEditor.vue) pushes the POIs into its own
// v-model, like the asteroid and supernova modals.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const categoriesStore = usePoiCategoriesStore();
void categoriesStore.ensureLoaded();
const pinColor = computed(
  () => resolveCategory(COMET_CATEGORY_ID, categoriesStore.categories).color,
);

// ─── Observation date (authoritative ISO; the two inputs are a UTC view onto it) ──
const obsIso = ref(props.photo.observationDate ?? '');
const obsDateStr = computed({
  get: () => isoToUtcParts(obsIso.value).date,
  set: (v) => {
    obsIso.value = utcPartsToIso(v, isoToUtcParts(obsIso.value).time);
  },
});
const obsTimeStr = computed({
  get: () => isoToUtcParts(obsIso.value).time,
  set: (v) => {
    obsIso.value = utcPartsToIso(isoToUtcParts(obsIso.value).date, v);
  },
});

// ─── Search ─────────────────────────────────────────────────────────────────
const searching = ref(false);
const searchErrorMessage = ref('');
const results = ref<CometSearchResult | null>(null);
const selected = ref(new Set<string>());
const hovered = ref<string | null>(null);
/** The comet whose pin a click on the photo moves. */
const activeName = ref<string | null>(null);
/** Pixel positions the user clicked, per comet name — they win over the prediction. */
const overrides = ref(new Map<string, { x: number; y: number }>());

/**
 * Propagates the MPC comet orbits (fetched once per session by cometElementsAPI,
 * so only the first search waits on the network) to the observation date. Fitted
 * and projected in the canonical pole projection: the zenith-centred display mode
 * clips a field that is currently below the horizon.
 */
async function onSearch() {
  if (!obsIso.value) return;
  const obs = obsIso.value;
  searching.value = true;
  searchErrorMessage.value = '';
  try {
    const comets = await cometElementsAPI();
    results.value = withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(props.photo);
      return matrix
        ? findComets(comets, matrix, props.photo.width, props.photo.height, obs)
        : { inFrame: [], nearby: [] };
    });
    // Comets in the frame are pre-selected; the brightest one is the click target.
    const names = results.value.inFrame.map((c) => c.name);
    selected.value = new Set(names);
    if (!activeName.value || !names.includes(activeName.value)) activeName.value = names[0] ?? null;
  } catch (err) {
    reportUnknownRendererError('comet_elements_load', err);
    results.value = null;
    searchErrorMessage.value = t('comet.loadError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

// One search on open when the date is already known, like the supernova modal.
if (computePhotoToProjMatrix(props.photo) && obsIso.value) void onSearch();

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(name);
  else next.delete(name);
  selected.value = next;
}

function onPhotoClick(px: { x: number; y: number }) {
  if (!activeName.value) return;
  const next = new Map(overrides.value);
  next.set(activeName.value, px);
  overrides.value = next;
  toggle(activeName.value, true);
}

function resetPosition(name: string) {
  const next = new Map(overrides.value);
  next.delete(name);
  overrides.value = next;
}

/** A comet's pin in photo pixels: where the user clicked, else the prediction. */
function pinPixel(c: PlacedComet): { x: number; y: number } {
  return overrides.value.get(c.name) ?? c;
}

function onAdd() {
  if (!results.value) return;
  const inFrame = results.value.inFrame;
  const pois = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(props.photo);
    return inFrame
      .filter((c) => selected.value.has(c.name))
      .map((c) => {
        const px = overrides.value.get(c.name);
        const position =
          px && matrix ? photoPixelToRaDec(matrix, px.x, px.y) : { ra: c.raDeg, dec: c.decDeg };
        return candidateToPoi(c, position);
      });
  });
  emit('identified', props.photo, pois);
}
</script>
