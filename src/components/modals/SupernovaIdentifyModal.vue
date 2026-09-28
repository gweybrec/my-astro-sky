<template>
  <BaseModal
    modal-class="supernova-identify-modal"
    body-class="modal-form-body--scroll flex flex-col gap-4"
    @close="$emit('close')"
  >
    <template #title>
      <h2>{{ t('supernova.title') }}</h2>
    </template>

    <!-- Like AsteroidIdentifyModal, always opened pre-targeted at an already-solved
         photo (PoiEditor.vue's trigger only renders once one is in scope). -->
    <template v-if="photoToProj">
      <p class="text-hint m-0">{{ t('supernova.intro') }}</p>

      <!-- Observation date (UTC) + search, one row. Split date/time inputs rather than
           datetime-local, for the same "literal UTC" reason as the asteroid modal. -->
      <div class="flex flex-col gap-2">
        <label class="metadata-label">{{ t('supernova.obsDateLabel') }}</label>
        <div class="flex items-stretch gap-2">
          <input v-model="obsDateStr" type="date" class="dialog-input flex-[3_1_0%]" />
          <input v-model="obsTimeStr" type="time" class="dialog-input flex-[2_1_0%]" />
          <button
            type="button"
            class="btn-action flex-none"
            :disabled="!obsIso || searching"
            @click="onSearch"
          >
            {{ searching ? t('supernova.searching') : t('supernova.searchButton') }}
          </button>
        </div>
        <div v-if="!obsIso" class="text-[var(--text-warning-sm)]">
          {{ t('supernova.dateRequired') }}
        </div>
      </div>

      <!-- Photo with a starburst pin per candidate (same rays as the POI chip icon,
           no centre dot, so the transient itself stays visible). -->
      <div class="flex items-center justify-center w-full overflow-hidden">
        <div ref="photoContainerEl" class="modal-photo-container select-none">
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

      <div v-if="field?.truncated" class="text-hint">{{ t('supernova.fieldTruncated') }}</div>

      <div v-if="searchErrorMessage" class="text-[var(--color-danger)]">
        {{ searchErrorMessage }}
      </div>

      <div v-if="results !== null" class="flex flex-col gap-1">
        <div v-if="results.length === 0" class="text-hint">{{ t('supernova.noCandidates') }}</div>
        <label
          v-for="c in results"
          :key="c.name"
          class="flex items-start gap-3 py-2 px-3 border border-[var(--border-panel)] rounded-sm cursor-pointer"
          @mouseenter="hovered = c.name"
          @mouseleave="hovered = null"
        >
          <input
            type="checkbox"
            class="mt-1"
            :checked="selected.has(c.name)"
            @change="toggle(c.name, ($event.target as HTMLInputElement).checked)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ c.name }}</span>
              <span v-if="c.type" class="tag-chip-sm">{{ c.type }}</span>
              <span
                v-if="!c.classified"
                class="tag-chip-sm text-[var(--text-warning-sm)]"
                :title="t('supernova.unconfirmedHint')"
              >
                {{ t('supernova.unconfirmed') }}
              </span>
              <a
                :href="c.tnsUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="settings-link ml-auto text-small"
                @click.stop
                >{{ t('supernova.viewOnTns') }}</a
              >
            </div>
            <div class="text-hint text-small">
              {{ c.discoveryDate?.slice(0, 10) ?? '—' }} ·
              {{ formatDaysFromDiscovery(c.daysFromDiscovery) }} · {{ t('supernova.colMag') }}
              {{ c.discoveryMag?.toFixed(1) ?? '—' }}
              <template v-if="c.hostName">
                · {{ t('supernova.colHost') }} {{ c.hostName }}</template
              >
            </div>
          </div>
        </label>
      </div>
    </template>

    <template #footer>
      <button type="button" class="btn-cancel" @click="$emit('close')">
        {{ t('modal.cancel') }}
      </button>
      <button type="button" class="btn-confirm" :disabled="selected.size === 0" @click="onAdd">
        {{ t('supernova.addSelected', { n: selected.size }) }}
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
import { tnsConesearchAPI } from '../../api';
import { createImageZoomPan, type ZoomPanController } from '../../image-zoom';
import { isoToUtcParts, utcPartsToIso } from '../../asteroid-identify';
import {
  photoFieldCircle,
  searchWindow,
  placeInImage,
  rankTransients,
  formatDaysFromDiscovery,
  candidateToPoi,
  SUPERNOVA_CATEGORY_ID,
  type FieldCircle,
  type PlacedTransient,
} from '../../supernova-identify';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { resolveCategory } from '../../poi';
import pinSvg from '../../icons/supernova-pin.svg?raw';
import type { Photo, AffineMatrix, PointOfInterest } from '../../types';

const props = defineProps<{ photo: Photo }>();
// The modal never persists: the caller (PoiEditor.vue) pushes the POIs into its own
// v-model, exactly like AsteroidIdentifyModal's `identified`.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const photoToProj = computed<AffineMatrix | null>(() => computePhotoToProjMatrix(props.photo));

const categoriesStore = usePoiCategoriesStore();
void categoriesStore.ensureLoaded();
const pinColor = computed(
  () => resolveCategory(SUPERNOVA_CATEGORY_ID, categoriesStore.categories).color,
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

// ─── Zoom / pan (same options as the asteroid modal) ─────────────────────────
const imgEl = ref<HTMLImageElement | null>(null);
const photoContainerEl = ref<HTMLElement | null>(null);
const zoomControlsHost = ref<HTMLElement | null>(null);
let zoom: ZoomPanController | null = null;
let unsubTransform: (() => void) | null = null;
// Bumped on zoom/pan and whenever the image box resizes (image load, or the
// "date required" line disappearing and giving the photo more room), so pin
// positions — read from live getBoundingClientRect — are recomputed.
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

// ─── Search ─────────────────────────────────────────────────────────────────
const searching = ref(false);
const searchErrorMessage = ref('');
const field = ref<FieldCircle | null>(null);
const results = ref<PlacedTransient[] | null>(null);
const selected = ref(new Set<string>());
const hovered = ref<string | null>(null);

async function onSearch() {
  // Sky geometry runs in the canonical pole projection: the zenith-centred display
  // mode clips a field that is currently below the horizon (see
  // withCanonicalProjection), which would collapse the photo's fit.
  const fieldCircle = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(props.photo);
    return matrix ? photoFieldCircle(matrix, props.photo.width, props.photo.height) : null;
  });
  const dateWindow = obsIso.value ? searchWindow(obsIso.value) : null;
  if (!fieldCircle || !dateWindow) return;
  searching.value = true;
  searchErrorMessage.value = '';
  results.value = null;
  try {
    field.value = fieldCircle;
    const candidates = await tnsConesearchAPI({
      raDeg: field.value.raDeg,
      decDeg: field.value.decDeg,
      radiusArcmin: field.value.radiusArcmin,
      ...dateWindow,
    });
    const placed = withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(props.photo);
      return matrix
        ? placeInImage(candidates, matrix, props.photo.width, props.photo.height, obsIso.value)
        : [];
    });
    results.value = rankTransients(placed);
    // Confirmed supernovae are pre-selected; unclassified transients are opt-in.
    selected.value = new Set(results.value.filter((c) => c.classified).map((c) => c.name));
  } catch (err) {
    searchErrorMessage.value = t('supernova.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

// One search on open when the date is already known — cached server-side, so
// re-opening the modal on the same photo doesn't hit TNS's rate limit again.
if (photoToProj.value && obsIso.value) void onSearch();

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(name);
  else next.delete(name);
  selected.value = next;
}

/** Screen position of each candidate, relative to the (possibly zoomed) image box. */
const pinMarks = computed(() => {
  const _dep = layoutVersion.value; // reactive dependency — see layoutVersion
  if (!results.value || !imgEl.value || !photoContainerEl.value) return [];
  const imgRect = imgEl.value.getBoundingClientRect();
  const containerRect = photoContainerEl.value.getBoundingClientRect();
  if (imgRect.width <= 0) return [];
  return results.value.map((c) => ({
    name: c.name,
    dispX: imgRect.left - containerRect.left + (c.x / props.photo.width) * imgRect.width,
    dispY: imgRect.top - containerRect.top + (c.y / props.photo.height) * imgRect.height,
  }));
});

function onAdd() {
  if (!results.value) return;
  const pois = results.value.filter((c) => selected.value.has(c.name)).map(candidateToPoi);
  emit('identified', props.photo, pois);
}
</script>
