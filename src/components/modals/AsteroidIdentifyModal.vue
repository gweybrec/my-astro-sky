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

    <!-- Which end of the trail the next click on the photo marks. -->
    <template #photo-hint>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-icon"
          :class="{ 'btn-icon--active': activeMarker === 'start' }"
          @click="activeMarker = 'start'"
        >
          {{ t('asteroid.markStart') }}
        </button>
        <button
          type="button"
          class="btn-icon"
          :class="{ 'btn-icon--active': activeMarker === 'end' }"
          @click="activeMarker = 'end'"
        >
          {{ t('asteroid.markEnd') }}
        </button>
        <span class="text-hint">{{ t('asteroid.markHint') }}</span>
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
              class="flex items-start gap-3 py-2 px-3 border border-[var(--border-panel)] rounded-sm cursor-pointer"
            >
              <input
                type="checkbox"
                class="mt-1"
                :checked="selected.has(candidateKey(c))"
                @change="toggle(candidateKey(c), ($event.target as HTMLInputElement).checked)"
              />
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">{{ formatCandidateName(c) }}</div>
                <div class="text-hint text-small">
                  {{ formatAsteroidClass(c.className) }} · {{ t('asteroid.colMag') }}
                  {{ c.vMag?.toFixed(1) ?? '—' }} · {{ t('asteroid.colError') }}
                  {{ c.positionErrorArcsec.toFixed(1) }}
                  <span v-if="c.uncertainOrbit" class="text-[var(--text-warning-sm)]">
                    · {{ t('asteroid.uncertainOrbit') }}
                  </span>
                </div>
              </div>
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
import { computePhotoToProjMatrix } from '../../photo-placement';
import { withCanonicalProjection } from '../../projection';
import { skybotConesearchAPI } from '../../api';
import { buildPageList } from '../../targets-view';
import {
  photoPixelToRaDec,
  buildSearch,
  rankCandidates,
  formatCandidateName,
  formatAsteroidClass,
  candidateToPoi,
  defaultTimeWindow,
  isoToJd,
  isoToUtcParts,
  utcPartsToIso,
  type RankedCandidate,
} from '../../asteroid-identify';
import type { Photo, PointOfInterest } from '../../types';

const ASTEROID_CATEGORY_ID = 'cat-asteroid';
const RESULTS_PAGE_SIZE = 6;

const props = defineProps<{ photo: Photo }>();
// `identified` hands the target photo and the chosen POIs to the caller — the modal
// never persists itself. PoiEditor.vue pushes them into its own (possibly not yet
// saved) `pois` v-model, so it works the same for a placed photo (gallery) and a
// BatchUploadModal card still pending its initial save.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

// ─── Trail markers ──────────────────────────────────────────────────────────
type MarkerKey = 'start' | 'end';
const activeMarker = ref<MarkerKey>('start');
const startPx = ref<{ x: number; y: number } | null>(null);
const endPx = ref<{ x: number; y: number } | null>(null);

function onPhotoClick(px: { x: number; y: number }) {
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
const startDateStr = computed({
  get: () => isoToUtcParts(startIso.value).date,
  set: (v) => {
    startIso.value = utcPartsToIso(v, isoToUtcParts(startIso.value).time);
  },
});
const startTimeStr = computed({
  get: () => isoToUtcParts(startIso.value).time,
  set: (v) => {
    startIso.value = utcPartsToIso(isoToUtcParts(startIso.value).date, v);
  },
});
const endDateStr = computed({
  get: () => isoToUtcParts(endIso.value).date,
  set: (v) => {
    endIso.value = utcPartsToIso(v, isoToUtcParts(endIso.value).time);
  },
});
const endTimeStr = computed({
  get: () => isoToUtcParts(endIso.value).time,
  set: (v) => {
    endIso.value = utcPartsToIso(isoToUtcParts(endIso.value).date, v);
  },
});
const radiusArcmin = ref(5);

// ─── Search ─────────────────────────────────────────────────────────────────
const searching = ref(false);
const searchErrorMessage = ref('');
const ranked = ref<RankedCandidate[] | null>(null);
const resultPage = ref(0);
const selected = ref(new Set<string>());

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

async function onSearch() {
  if (!startPx.value || !endPx.value) return;
  searching.value = true;
  searchErrorMessage.value = '';
  ranked.value = null;
  resultPage.value = 0;
  selected.value = new Set();
  try {
    // Fitted and unprojected in the canonical pole projection: the zenith-centred
    // display mode clips a field that is currently below the horizon (collapsing the
    // fit) and rotates with the sky clock (see withCanonicalProjection).
    const start = startPx.value;
    const end = endPx.value;
    const marks = withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(props.photo);
      return matrix
        ? {
            startRaDec: photoPixelToRaDec(matrix, start.x, start.y),
            endRaDec: photoPixelToRaDec(matrix, end.x, end.y),
          }
        : null;
    });
    if (!marks) return;
    const { startRaDec, endRaDec } = marks;
    const startJd = isoToJd(startIso.value);
    const endJd = isoToJd(endIso.value);
    const search = buildSearch(startRaDec, endRaDec, startJd, endJd);
    const effectiveRadius = Math.max(radiusArcmin.value, search.suggestedRadiusArcmin);

    const candidates = await skybotConesearchAPI({
      raDeg: search.raDeg,
      decDeg: search.decDeg,
      radiusArcmin: effectiveRadius,
      epochJd: search.epochJd,
    });

    ranked.value = rankCandidates(
      candidates,
      {
        start: { ...startRaDec, jd: startJd },
        end: { ...endRaDec, jd: endJd },
      },
      search.epochJd,
    );
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
}

// Persistence is the caller's job — see the `identified` emit doc above.
function onAdd() {
  if (!ranked.value) return;
  const pois = ranked.value
    .filter((c) => selected.value.has(candidateKey(c)))
    .map((c) => candidateToPoi(c, ASTEROID_CATEGORY_ID));
  emit('identified', props.photo, pois);
}
</script>
