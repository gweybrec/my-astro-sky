<template>
  <BaseModal
    modal-class="comet-identify-modal"
    body-class="modal-form-body--scroll flex flex-col gap-4"
    @close="$emit('close')"
  >
    <template #title>
      <h2>{{ t('comet.title') }}</h2>
    </template>

    <!-- Like the supernova modal, always opened pre-targeted at an already-solved
         photo (PoiEditor.vue's trigger only renders once one is in scope). -->
    <template v-if="photoToProj">
      <p class="text-hint m-0">{{ t('comet.intro') }}</p>

      <!-- Observation date (UTC). No search button: comet positions are computed
           locally, so the results follow every edit of the date or time. -->
      <div class="flex flex-col gap-2">
        <label class="metadata-label">{{ t('comet.obsDateLabel') }}</label>
        <div class="flex items-stretch gap-2">
          <input v-model="obsDateStr" type="date" class="dialog-input flex-[3_1_0%]" />
          <input v-model="obsTimeStr" type="time" class="dialog-input flex-[2_1_0%]" />
        </div>
        <div v-if="!obsIso" class="text-[var(--text-warning-sm)]">
          {{ t('comet.dateRequired') }}
        </div>
      </div>

      <!-- Photo with a starburst pin per comet; clicking the photo (not dragging it)
           moves the active comet's pin onto the nucleus actually seen. -->
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
            v-for="pin in pinMarks"
            :key="pin.name"
            class="absolute w-[28px] h-[28px] -ml-[14px] -mt-[14px] pointer-events-none transition-transform [&>svg]:w-full [&>svg]:h-full"
            :class="{
              'opacity-40': !selected.has(pin.name),
              'scale-150': hovered === pin.name,
            }"
            :style="{ left: `${pin.dispX}px`, top: `${pin.dispY}px`, color: pinColor }"
            v-html="pinSvg"
          ></span>
          <!-- Zoom controls are appended here imperatively by createImageZoomPan. -->
          <div ref="zoomControlsHost"></div>
        </div>
      </div>

      <div v-if="loading" class="text-hint">{{ t('comet.loading') }}</div>
      <div v-if="loadErrorMessage" class="text-[var(--color-danger)]">
        {{ loadErrorMessage }}
      </div>

      <div v-if="results" class="flex flex-col gap-1">
        <div v-if="results.inFrame.length === 0" class="text-hint">
          {{ t('comet.noCandidates') }}
        </div>
        <div v-else class="text-hint text-small">
          {{ t('comet.clickToAdjust', { name: activeName ?? '' }) }}
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

    <template #footer>
      <button type="button" class="btn-cancel" @click="$emit('close')">
        {{ t('modal.cancel') }}
      </button>
      <button type="button" class="btn-confirm" :disabled="selected.size === 0" @click="onAdd">
        {{ t('comet.addSelected', { n: selected.size }) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { computePhotoToProjMatrix } from '../../photo-placement';
import { withCanonicalProjection } from '../../projection';
import { cometElementsAPI } from '../../api';
import { createImageZoomPan, type ZoomPanController } from '../../image-zoom';
import { isoToUtcParts, utcPartsToIso, photoPixelToRaDec } from '../../asteroid-identify';
import {
  findComets,
  candidateToPoi,
  jplLookupUrl,
  COMET_CATEGORY_ID,
  type CometSearchResult,
} from '../../comet-identify';
import type { CometElements } from '../../comet-ephemeris';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { resolveCategory } from '../../poi';
import { reportUnknownRendererError } from '../../error-reporter';
import pinSvg from '../../icons/supernova-pin.svg?raw';
import type { Photo, AffineMatrix, PointOfInterest } from '../../types';

const props = defineProps<{ photo: Photo }>();
// The modal never persists: the caller (PoiEditor.vue) pushes the POIs into its own
// v-model, exactly like SupernovaIdentifyModal's `identified`.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const photoToProj = computed<AffineMatrix | null>(() => computePhotoToProjMatrix(props.photo));

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

// ─── Zoom / pan (same options as the supernova modal) ────────────────────────
const imgEl = ref<HTMLImageElement | null>(null);
const photoContainerEl = ref<HTMLElement | null>(null);
const zoomControlsHost = ref<HTMLElement | null>(null);
let zoom: ZoomPanController | null = null;
let unsubTransform: (() => void) | null = null;
// Bumped on zoom/pan and whenever the image box resizes, so pin positions —
// read from live getBoundingClientRect — are recomputed.
const layoutVersion = ref(0);
let resizeObserver: ResizeObserver | null = null;

function teardownZoom() {
  resizeObserver?.disconnect();
  resizeObserver = null;
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
    layoutVersion.value++;
  });
  imgEl.value.addEventListener('load', () => layoutVersion.value++, { once: true });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => layoutVersion.value++);
    resizeObserver.observe(imgEl.value);
  }
}

watch(imgEl, (el) => {
  if (el) setupZoom();
  else teardownZoom();
});
onUnmounted(teardownZoom);

// ─── Comet elements (fetched once per session, see cometElementsAPI) ─────────
const elements = ref<CometElements[] | null>(null);
const loading = ref(true);
const loadErrorMessage = ref('');

cometElementsAPI()
  .then((list) => {
    elements.value = list;
  })
  .catch((err: unknown) => {
    reportUnknownRendererError('comet_elements_load', err);
    loadErrorMessage.value = t('comet.loadError', { message: (err as Error).message });
  })
  .finally(() => {
    loading.value = false;
  });

// Recomputed whenever the date/time or the elements change. Fitted and projected
// in the canonical pole projection: the zenith-centred display mode clips a field
// that is currently below the horizon and rotates with the sky clock.
const results = computed<CometSearchResult | null>(() => {
  const comets = elements.value;
  if (!comets || !obsIso.value) return null;
  return withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(props.photo);
    if (!matrix) return null;
    return findComets(comets, matrix, props.photo.width, props.photo.height, obsIso.value);
  });
});

const selected = ref(new Set<string>());
const hovered = ref<string | null>(null);
/** The comet whose pin a click on the photo moves. */
const activeName = ref<string | null>(null);
/** Pixel positions the user clicked, per comet name — they win over the prediction. */
const overrides = ref(new Map<string, { x: number; y: number }>());

// Comets in the frame are pre-selected; the brightest one is the click target.
watch(results, (r) => {
  const names = r?.inFrame.map((c) => c.name) ?? [];
  selected.value = new Set(names);
  if (!activeName.value || !names.includes(activeName.value)) activeName.value = names[0] ?? null;
});

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(name);
  else next.delete(name);
  selected.value = next;
}

function onImageClick(e: MouseEvent) {
  if (zoom?.wasDrag || !activeName.value) return;
  const img = imgEl.value;
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  const relY = (e.clientY - rect.top) / rect.height;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return;
  const next = new Map(overrides.value);
  next.set(activeName.value, { x: relX * props.photo.width, y: relY * props.photo.height });
  overrides.value = next;
  toggle(activeName.value, true);
}

function resetPosition(name: string) {
  const next = new Map(overrides.value);
  next.delete(name);
  overrides.value = next;
}

/** Screen position of each pin (override or prediction), relative to the image box. */
const pinMarks = computed(() => {
  const _dep = layoutVersion.value; // reactive dependency — see layoutVersion
  if (!results.value || !imgEl.value || !photoContainerEl.value) return [];
  const imgRect = imgEl.value.getBoundingClientRect();
  const containerRect = photoContainerEl.value.getBoundingClientRect();
  if (imgRect.width <= 0) return [];
  return results.value.inFrame.map((c) => {
    const px = overrides.value.get(c.name) ?? c;
    return {
      name: c.name,
      dispX: imgRect.left - containerRect.left + (px.x / props.photo.width) * imgRect.width,
      dispY: imgRect.top - containerRect.top + (px.y / props.photo.height) * imgRect.height,
    };
  });
});

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
