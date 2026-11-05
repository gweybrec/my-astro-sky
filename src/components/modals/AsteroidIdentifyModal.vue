<template>
  <IdentifyModalShell
    :photo="photo"
    modal-class="asteroid-identify-modal"
    :title="t('asteroid.title')"
    :intro="t('asteroid.intro')"
    :can-search="canSearch"
    :searching="searching"
    :error-message="searchErrorMessage"
    :selected-count="selected.size"
    @close="$emit('close')"
    @search="onSearch"
    @add="onAdd"
    @photo-click="onPhotoClick"
  >
    <!-- Start · End · Radius: the same column template in the labels row and the
         inputs row, so a label wrapping to two lines (a longer translation) never
         pushes its input out of line. Start/end are split date + time inputs (not
         datetime-local): they are literal UTC, while a native datetime-local — and
         its "Today"/"Now" shortcuts — is always the viewer's local time. -->
    <template #labels>
      <div class="grid grid-cols-[1fr_1fr_110px] gap-x-4">
        <label class="metadata-label">{{ t('asteroid.startTimeLabel') }}</label>
        <label class="metadata-label">{{ t('asteroid.endTimeLabel') }}</label>
        <label class="metadata-label">{{ t('asteroid.radiusLabel') }}</label>
      </div>
    </template>
    <template #inputs>
      <div class="grid grid-cols-[1fr_1fr_110px] gap-x-4">
        <div class="flex gap-1">
          <input type="date" class="dialog-input flex-[3_1_0%]" v-model="startDateStr" />
          <input type="time" class="dialog-input flex-[2_1_0%]" v-model="startTimeStr" />
        </div>
        <div class="flex gap-1">
          <input type="date" class="dialog-input flex-[3_1_0%]" v-model="endDateStr" />
          <input type="time" class="dialog-input flex-[2_1_0%]" v-model="endTimeStr" />
        </div>
        <input type="number" min="1" max="60" class="dialog-input" v-model.number="radiusArcmin" />
      </div>
    </template>

    <!-- Which end of the trail the next click on the photo marks — or, while a result's
         Adjust button is pressed, that the click moves its pin instead. -->
    <template #photo-hint>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-icon"
          :class="{ 'btn-icon--active': !adjustingKey && activeMarker === 'start' }"
          @click="markTrail('start')"
        >
          {{ t('asteroid.markStart') }}
        </button>
        <button
          type="button"
          class="btn-icon"
          :class="{ 'btn-icon--active': !adjustingKey && activeMarker === 'end' }"
          @click="markTrail('end')"
        >
          {{ t('asteroid.markEnd') }}
        </button>
        <span class="text-hint">
          {{
            adjustingCandidate
              ? t('asteroid.clickToAdjust', { name: formatCandidateName(adjustingCandidate) })
              : t('asteroid.markHint')
          }}
        </span>
      </div>
    </template>

    <template #markers="{ toDisplay }">
      <span
        v-if="startPx && toDisplay(startPx)"
        class="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 border-solid border-[var(--status-success-text)] pointer-events-none"
        :style="{ left: `${toDisplay(startPx)!.left}px`, top: `${toDisplay(startPx)!.top}px` }"
      ></span>
      <span
        v-if="endPx && toDisplay(endPx)"
        class="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 border-solid border-[var(--color-danger)] pointer-events-none"
        :style="{ left: `${toDisplay(endPx)!.left}px`, top: `${toDisplay(endPx)!.top}px` }"
      ></span>
      <!-- A pin per selected asteroid, at its predicted position (the trail's middle
           time) or where the user moved it; the one being adjusted is larger. -->
      <template v-for="c in selectedCandidates" :key="candidateKey(c)">
        <span
          v-if="pinPixel(c) && toDisplay(pinPixel(c)!)"
          class="absolute w-[28px] h-[28px] -ml-[14px] -mt-[14px] pointer-events-none transition-transform [&>svg]:w-full [&>svg]:h-full"
          :class="{ 'scale-150': adjustingKey === candidateKey(c) }"
          :style="{
            left: `${toDisplay(pinPixel(c)!)!.left}px`,
            top: `${toDisplay(pinPixel(c)!)!.top}px`,
            color: pinColor,
          }"
          v-html="pinSvg"
        ></span>
      </template>
    </template>

    <!-- Results, paginated so a wide search radius doesn't dump hundreds of rows.
         The selection is kept across pages. -->
    <template #results>
      <div v-if="ranked !== null" class="flex flex-col gap-2">
        <div v-if="ranked.length === 0" class="text-hint">{{ t('asteroid.noCandidates') }}</div>
        <template v-else>
          <div class="flex flex-col gap-1">
            <label
              v-for="c in pagedResults"
              :key="candidateKey(c)"
              class="flex items-start gap-3 py-2 px-3 border border-solid rounded-sm cursor-pointer"
              :class="
                adjustingKey === candidateKey(c)
                  ? 'border-[var(--border-focus)] bg-[var(--accent-fill-sm)]'
                  : 'border-[var(--border-panel)]'
              "
            >
              <input
                type="checkbox"
                class="mt-1"
                :checked="selected.has(candidateKey(c))"
                @change="toggle(candidateKey(c), ($event.target as HTMLInputElement).checked)"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 min-w-0">
                  <span class="font-medium truncate">{{ formatCandidateName(c) }}</span>
                  <span v-if="overrides.has(candidateKey(c))" class="tag-chip-sm">
                    {{ t('comet.adjusted') }}
                  </span>
                </div>
                <div class="text-hint text-small">
                  {{ formatAsteroidClass(c.className) }} · {{ t('asteroid.colMag') }}
                  {{ c.vMag?.toFixed(1) ?? '—' }} · {{ t('asteroid.colError') }}
                  {{ c.positionErrorArcsec.toFixed(1) }}
                  <span v-if="c.uncertainOrbit" class="text-[var(--text-warning-sm)]">
                    · {{ t('asteroid.uncertainOrbit') }}
                  </span>
                  <template v-if="overrides.has(candidateKey(c))">
                    ·
                    <button
                      type="button"
                      class="settings-link bg-transparent border-none p-0 cursor-pointer text-small"
                      @click.stop.prevent="resetPosition(candidateKey(c))"
                    >
                      {{ t('comet.resetPosition') }}
                    </button>
                  </template>
                </div>
              </div>
              <!-- Moves this asteroid's pin with the next clicks on the photo; only a
                   selected asteroid becomes a point of interest, so only it adjusts. -->
              <button
                type="button"
                class="self-center"
                :class="adjustingKey === candidateKey(c) ? 'btn-icon--active' : 'btn-icon'"
                :disabled="!selected.has(candidateKey(c))"
                @click.stop.prevent="toggleAdjust(candidateKey(c))"
              >
                {{ t('asteroid.adjust') }}
              </button>
            </label>
          </div>

          <!-- Same pagination widget (markup, classes, page-range algorithm) as the
               Targets tab's result list (src/targets-view.ts). Centred: the widget's
               own margin-left:auto (style.css) would fight justify-center here. -->
          <div v-if="totalPages > 1" class="flex justify-center">
            <div class="targets-pagination !ml-0">
              <button
                type="button"
                class="targets-pagination-btn"
                :title="t('targets.pagination.first')"
                @click="resultPage = 0"
              >
                «
              </button>
              <button
                type="button"
                class="targets-pagination-btn"
                :title="t('targets.pagination.prev')"
                @click="resultPage = Math.max(0, resultPage - 1)"
              >
                ‹
              </button>
              <template v-for="(p, i) in pageList" :key="i">
                <span v-if="p === null" class="targets-pagination-ellipsis">…</span>
                <button
                  v-else
                  type="button"
                  class="targets-pagination-btn targets-pagination-btn--page"
                  :class="{ 'targets-pagination-btn--active': p === resultPage }"
                  @click="resultPage = p"
                >
                  {{ p + 1 }}
                </button>
              </template>
              <button
                type="button"
                class="targets-pagination-btn"
                :title="t('targets.pagination.next')"
                @click="resultPage = Math.min(totalPages - 1, resultPage + 1)"
              >
                ›
              </button>
              <button
                type="button"
                class="targets-pagination-btn"
                :title="t('targets.pagination.last')"
                @click="resultPage = totalPages - 1"
              >
                »
              </button>
              <span class="targets-pagination-info">
                {{ ranked.length }} {{ t('targets.pagination.results') }}
              </span>
            </div>
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
import {
  asteroidPixels,
  asteroidPois,
  asteroidSearchPlan,
  rankAsteroids,
  type PhotoPixel,
} from '@myastrosky/core/photo-identify';
import { photoAsShown } from '@myastrosky/core/photo-rotation';
import { skybotConesearchAPI } from '../../api';
import { buildPageList } from '@myastrosky/core/targets/sorting';
import {
  formatCandidateName,
  formatAsteroidClass,
  defaultTimeWindow,
  type RankedCandidate,
} from '@myastrosky/core/asteroid-identify';
import { useUtcDateTime } from '../../composables/useUtcDateTime';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { resolveCategory } from '@myastrosky/core/poi';
import pinSvg from '../../icons/supernova-pin.svg?raw';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';

const ASTEROID_CATEGORY_ID = 'cat-asteroid';
const RESULTS_PAGE_SIZE = 3;

const props = defineProps<{ photo: Photo }>();
// The photo as it is shown, turned: the clicks and the markers of the shell are in its pixels.
const shown = computed(() => photoAsShown(props.photo));
// `identified` hands the target photo and the chosen POIs to the caller — the modal
// never persists itself. PoiEditor.vue pushes them into its own (possibly not yet
// saved) `pois` v-model, so it works the same for a placed photo (gallery) and a
// BatchUploadModal card still pending its initial save.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const categoriesStore = usePoiCategoriesStore();
void categoriesStore.ensureLoaded();
const pinColor = computed(
  () => resolveCategory(ASTEROID_CATEGORY_ID, categoriesStore.categories).color,
);

// ─── Trail markers ──────────────────────────────────────────────────────────
type MarkerKey = 'start' | 'end';
const activeMarker = ref<MarkerKey>('start');
const startPx = ref<{ x: number; y: number } | null>(null);
const endPx = ref<{ x: number; y: number } | null>(null);

function onPhotoClick(px: { x: number; y: number }) {
  if (adjustingKey.value) {
    const next = new Map(overrides.value);
    next.set(adjustingKey.value, px);
    overrides.value = next;
    return;
  }
  if (activeMarker.value === 'start') {
    startPx.value = px;
    activeMarker.value = 'end';
  } else {
    endPx.value = px;
  }
}

// ─── Times ──────────────────────────────────────────────────────────────────
// Authoritative state is the ISO string; the date/time inputs are a derived UTC
// view onto it (same pattern as SkyTimeControl.vue's dateStr/timeStr).
const initialWindow = defaultTimeWindow(props.photo);
const startIso = ref(initialWindow?.startIso ?? '');
const endIso = ref(initialWindow?.endIso ?? '');
const { dateStr: startDateStr, timeStr: startTimeStr } = useUtcDateTime(startIso);
const { dateStr: endDateStr, timeStr: endTimeStr } = useUtcDateTime(endIso);
const radiusArcmin = ref(5);

// ─── Search ─────────────────────────────────────────────────────────────────
const searching = ref(false);
const searchErrorMessage = ref('');
const ranked = ref<RankedCandidate[] | null>(null);
const resultPage = ref(0);
const selected = ref(new Set<string>());
/** The asteroid whose pin a click on the photo moves (its Adjust button is pressed); null = marking the trail. */
const adjustingKey = ref<string | null>(null);
/** Pixel positions the user put the pins on, per candidate key — they win over the prediction. */
const overrides = ref(new Map<string, PhotoPixel>());

const canSearch = computed(
  () => !!startPx.value && !!endPx.value && !!startIso.value && !!endIso.value,
);

const totalPages = computed(() =>
  ranked.value ? Math.max(1, Math.ceil(ranked.value.length / RESULTS_PAGE_SIZE)) : 0,
);
const pageList = computed(() => buildPageList(resultPage.value, totalPages.value));
const pagedResults = computed(() => {
  if (!ranked.value) return [];
  const start = resultPage.value * RESULTS_PAGE_SIZE;
  return ranked.value.slice(start, start + RESULTS_PAGE_SIZE);
});

function candidateKey(c: Pick<RankedCandidate, 'number' | 'name'>): string {
  return `${c.number ?? ''}|${c.name}`;
}

/** Each result's predicted pixel on the photo, by candidate key. */
const predictedPixels = computed(() => {
  const map = new Map<string, PhotoPixel>();
  if (!ranked.value) return map;
  const pixels = asteroidPixels(shown.value, ranked.value);
  ranked.value.forEach((c, i) => {
    if (pixels) map.set(candidateKey(c), pixels[i]);
  });
  return map;
});
const selectedCandidates = computed(() =>
  (ranked.value ?? []).filter((c) => selected.value.has(candidateKey(c))),
);
const adjustingCandidate = computed(
  () => (ranked.value ?? []).find((c) => candidateKey(c) === adjustingKey.value) ?? null,
);

/** An asteroid's pin in photo pixels: where the user put it, else the prediction. */
function pinPixel(c: RankedCandidate): PhotoPixel | null {
  const key = candidateKey(c);
  return overrides.value.get(key) ?? predictedPixels.value.get(key) ?? null;
}

function toggleAdjust(key: string) {
  adjustingKey.value = adjustingKey.value === key ? null : key;
}

function markTrail(marker: MarkerKey) {
  adjustingKey.value = null;
  activeMarker.value = marker;
}

function resetPosition(key: string) {
  const next = new Map(overrides.value);
  next.delete(key);
  overrides.value = next;
}

async function onSearch() {
  if (!startPx.value || !endPx.value) return;
  searching.value = true;
  searchErrorMessage.value = '';
  ranked.value = null;
  resultPage.value = 0;
  selected.value = new Set();
  adjustingKey.value = null;
  overrides.value = new Map();
  try {
    const plan = asteroidSearchPlan(
      shown.value,
      startPx.value,
      endPx.value,
      startIso.value,
      endIso.value,
      radiusArcmin.value,
    );
    if (!plan) return;
    ranked.value = rankAsteroids(await skybotConesearchAPI(plan.params), plan);
    // The best match is pre-selected; the others are opt-in.
    if (ranked.value.length) selected.value = new Set([candidateKey(ranked.value[0])]);
  } catch (err) {
    searchErrorMessage.value = t('asteroid.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

function toggle(key: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(key);
  else next.delete(key);
  selected.value = next;
  // An unselected asteroid is not added, so there is nothing left to adjust (its moved pin is kept).
  if (!on && adjustingKey.value === key) adjustingKey.value = null;
}

// Persistence is the caller's job — see the `identified` emit doc above.
function onAdd() {
  if (!ranked.value) return;
  emit(
    'identified',
    props.photo,
    asteroidPois(
      shown.value,
      selectedCandidates.value,
      overrides.value,
      candidateKey,
      ASTEROID_CATEGORY_ID,
    ),
  );
}
</script>
