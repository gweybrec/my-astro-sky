<template>
  <BaseModal
    modal-class="asteroid-identify-modal"
    body-class="modal-form-body--scroll flex flex-col gap-4"
    @close="$emit('close')"
  >
    <template #title>
      <h2>{{ t('asteroid.title') }}</h2>
    </template>

    <!-- No photo picker: this modal always opens pre-targeted at an already-solved
         photo — its one trigger (PoiEditor.vue's "Identifier un astéroïde", next to
         "+ Ajouter un point d'intérêt") only renders once such a photo is in scope. -->
    <template v-if="photoToProj">
      <!-- Marker selection -->
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

      <!-- Marking area: click to place the selected marker; wheel/drag/buttons to
           zoom & pan (createImageZoomPan — same widget the manual-placement dialog
           in photo-overlay.ts uses) so a short trail can be marked precisely.
           The outer flex/overflow-hidden box mirrors that dialog's .modal-photo-side:
           .modal-photo-container itself is display:inline-block (sized to the image),
           so it needs a bounded, centering parent to stay inside the modal's width. -->
      <div class="flex items-center justify-center w-full overflow-hidden">
        <div ref="photoContainerEl" class="modal-photo-container select-none" @click="onImageClick">
          <img
            ref="imgEl"
            :src="`/uploads/${photo.filename}`"
            :alt="photo.originalName"
            class="modal-photo"
            draggable="false"
          />
          <span
            v-if="startMark"
            class="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 border-solid border-[var(--status-success-text)] pointer-events-none"
            :style="{ left: `${startMark.dispX}px`, top: `${startMark.dispY}px` }"
          ></span>
          <span
            v-if="endMark"
            class="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 border-solid border-[var(--color-danger)] pointer-events-none"
            :style="{ left: `${endMark.dispX}px`, top: `${endMark.dispY}px` }"
          ></span>
          <!-- Zoom controls (+/−/reset) are appended here imperatively by
               createImageZoomPan; kept free of v-if/v-for children so Vue's own
               patching never touches or removes them. -->
          <div ref="zoomControlsHost"></div>
        </div>
      </div>

      <!-- Times + radius: a fixed 3-col × 2-row grid (label row, then input row) —
           not flex-wrap, and not per-field label+input stacks — so a label that
           happens to wrap to 2 lines (e.g. "Rayon de recherche (arcmin)" in a
           narrow column, or a longer translation) only grows the shared label
           row and can never push just that one input out of line with the others.
           Deliberately NOT .metadata-field: its "+ .metadata-field { margin-top }"
           sibling rule is written for a vertically-stacked single column (see
           MetadataEditorPanel) and would stagger later columns downward here.

           Start/end are split into type="date" + type="time" (not
           type="datetime-local"): these fields are explicitly UTC, and a native
           datetime-local's own values — and its browser "Today"/"Now" shortcuts —
           are always in the viewer's local timezone, silently wrong against the
           "(UTC)" label. Splitting also matches this app's own established
           date+time pattern (see SkyTimeControl.vue's dateStr/timeStr). -->
      <div class="grid grid-cols-[1fr_1fr_140px] grid-rows-[auto_auto] gap-x-4 gap-y-2">
        <label class="metadata-label">{{ t('asteroid.startTimeLabel') }}</label>
        <label class="metadata-label">{{ t('asteroid.endTimeLabel') }}</label>
        <label class="metadata-label">{{ t('asteroid.radiusLabel') }}</label>
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

      <button
        type="button"
        class="btn-action"
        :disabled="!canSearch || searching"
        @click="onIdentify"
      >
        {{ searching ? t('asteroid.searching') : t('asteroid.identifyButton') }}
      </button>

      <div v-if="searchErrorMessage" class="text-[var(--color-danger)]">
        {{ searchErrorMessage }}
      </div>

      <!-- Results, paginated so a wide search radius doesn't dump hundreds of rows. -->
      <div v-if="ranked !== null" class="flex flex-col gap-2">
        <div v-if="ranked.length === 0" class="text-hint">{{ t('asteroid.noCandidates') }}</div>
        <template v-else>
          <div class="flex flex-col gap-1">
            <div
              v-for="c in pagedResults"
              :key="`${c.number}|${c.name}`"
              class="flex items-center gap-3 py-2 px-3 border border-[var(--border-panel)] rounded-sm"
            >
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
              <button type="button" class="btn-confirm" @click="onAddAsPoi(c)">
                {{ t('asteroid.addAsPoi') }}
              </button>
            </div>
          </div>

          <!-- Same pagination widget (markup, classes, page-range algorithm) as the
               Targets tab's result list (src/targets-view.ts) — first/prev, up to a
               few numbered pages around the current one with an ellipsis, next/last,
               a result count. Centred: .targets-pagination's own margin-left:auto
               (style.css) exists to push it to the right of Targets' toolbar row,
               which has other siblings to push away from — there are none here, so
               that margin instead fights this wrapper's justify-center outright
               (auto margins always win over justify-content on their own axis) and
               must be neutralised. -->
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
                {{ ranked!.length }} {{ t('targets.pagination.results') }}
              </span>
            </div>
          </div>
        </template>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { computePhotoToProjMatrix } from '../../photo-placement';
import { skybotConesearchAPI } from '../../api';
import { createImageZoomPan, type ZoomPanController } from '../../image-zoom';
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
import type { Photo, AffineMatrix, PointOfInterest } from '../../types';

const ASTEROID_CATEGORY_ID = 'cat-asteroid';
const RESULTS_PAGE_SIZE = 6;

// Always opened pre-targeted at one already-solved photo — see PoiEditor.vue's
// "Identifier un astéroïde" trigger, the modal's only entry point.
const props = defineProps<{ photo: Photo }>();
// `identified` hands the target photo and the chosen POI to the caller — the
// modal never persists itself. PoiEditor.vue pushes the POI into its own
// (possibly not-yet-saved) `pois` v-model rather than writing to the server
// directly, so it works the same whether it's editing a placed photo (gallery)
// or a BatchUploadModal card still pending its initial save.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest] }>();

const photoToProj = computed<AffineMatrix | null>(() => computePhotoToProjMatrix(props.photo));

// ─── Markers ────────────────────────────────────────────────────────────────
type MarkerKey = 'start' | 'end';
const activeMarker = ref<MarkerKey>('start');
const imgEl = ref<HTMLImageElement | null>(null);
const photoContainerEl = ref<HTMLElement | null>(null);
const zoomControlsHost = ref<HTMLElement | null>(null);
const startPx = ref<{ x: number; y: number } | null>(null);
const endPx = ref<{ x: number; y: number } | null>(null);

// ─── Zoom / pan — mirrors the manual-placement dialog's options in photo-overlay.ts ──
let zoom: ZoomPanController | null = null;
let unsubTransform: (() => void) | null = null;
// Bumped whenever the zoom/pan transform changes, so the marker-position computeds
// (which read live getBoundingClientRect() values, not tracked by Vue's reactivity)
// re-run and follow the image instead of staying pinned to their pre-zoom spot.
const markerVersion = ref(0);

function teardownZoom() {
  unsubTransform?.();
  unsubTransform = null;
  zoom?.destroy();
  zoom = null;
}

function setupZoom() {
  teardownZoom();
  if (!imgEl.value || !photoContainerEl.value) return;
  zoom = createImageZoomPan(imgEl.value, photoContainerEl.value, {
    minScale: 1,
    maxScale: 5,
    fitButtons: true,
    dblClick: 'none',
  });
  zoomControlsHost.value?.appendChild(zoom.controls);
  unsubTransform = zoom.onTransformChange(() => {
    markerVersion.value++;
  });
}

// The marking block (and its <img ref>) only exists in the DOM while the photo
// is solved (v-if="photoToProj"), so wire zoom up/down as that ref
// appears/disappears rather than in onMounted (which only fires once).
watch(imgEl, (el) => {
  if (el) setupZoom();
  else teardownZoom();
});
onUnmounted(teardownZoom);

function onImageClick(e: MouseEvent) {
  if (zoom?.wasDrag) return;
  const img = imgEl.value;
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  const relY = (e.clientY - rect.top) / rect.height;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return;
  const px = { x: relX * props.photo.width, y: relY * props.photo.height };
  if (activeMarker.value === 'start') {
    startPx.value = px;
    activeMarker.value = 'end';
  } else {
    endPx.value = px;
  }
}

/** Screen position of a marked photo-pixel, relative to the (possibly zoomed/panned)
 *  image's current on-screen box — recomputed live rather than cached, so it tracks
 *  pan/zoom exactly like the click handler above already does via getBoundingClientRect. */
function computeMarkerScreenPos(px: { x: number; y: number } | null) {
  const _dep = markerVersion.value; // establish reactive dependency; see markerVersion doc above
  if (!px || !imgEl.value || !photoContainerEl.value) return null;
  const imgRect = imgEl.value.getBoundingClientRect();
  const containerRect = photoContainerEl.value.getBoundingClientRect();
  return {
    dispX: imgRect.left - containerRect.left + (px.x / props.photo.width) * imgRect.width,
    dispY: imgRect.top - containerRect.top + (px.y / props.photo.height) * imgRect.height,
  };
}
const startMark = computed(() => computeMarkerScreenPos(startPx.value));
const endMark = computed(() => computeMarkerScreenPos(endPx.value));

// ─── Times ──────────────────────────────────────────────────────────────────
// Authoritative state is the ISO string, not the two <input> values — the
// date/time pair below is a derived view onto it (get/set computed), same
// pattern as SkyTimeControl.vue's dateStr/timeStr over store.simDate. This
// keeps "what does the search actually use" unambiguous (always startIso/endIso,
// literal UTC), independent of how the two split inputs render it.
const startIso = ref('');
const endIso = ref('');
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

// `photo` never changes within one mounted instance of this modal (each open
// creates a fresh instance targeted at one photo — see PoiEditor.vue), so this
// only needs to run once, not as a reactive watcher.
const initialWindow = defaultTimeWindow(props.photo);
startIso.value = initialWindow?.startIso ?? '';
endIso.value = initialWindow?.endIso ?? '';

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

async function onIdentify() {
  if (!photoToProj.value || !startPx.value || !endPx.value) return;
  searching.value = true;
  searchErrorMessage.value = '';
  ranked.value = null;
  resultPage.value = 0;
  try {
    const startRaDec = photoPixelToRaDec(photoToProj.value, startPx.value.x, startPx.value.y);
    const endRaDec = photoPixelToRaDec(photoToProj.value, endPx.value.x, endPx.value.y);
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
  } catch (err) {
    searchErrorMessage.value = t('asteroid.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

// ─── Add as POI ─────────────────────────────────────────────────────────────
// Persistence is the caller's job — see the `identified` emit doc above.
function onAddAsPoi(candidate: RankedCandidate) {
  const poi = candidateToPoi(candidate, ASTEROID_CATEGORY_ID);
  emit('identified', props.photo, poi);
}
</script>
