<template>
  <div
    ref="cardEl"
    :class="[
      'batch-item-card',
      {
        'status-success': item.status === 'success' || item.status === 'placing',
        'status-placed': item.status === 'placed',
        'status-failed': item.status === 'failed' || item.status === 'canceled',
      },
    ]"
    :data-item-id="item.id"
  >
    <!-- Trash button (absolute corner) -->
    <button
      v-show="item.status !== 'solving' && item.status !== 'placing' && item.status !== 'placed'"
      type="button"
      class="batch-trash-btn"
      :title="t('batch.removeItem')"
      v-html="trashSvg"
      @click="$emit('remove')"
    ></button>

    <!-- Top row: thumbnail + info -->
    <div class="batch-item-top">
      <div class="batch-item-thumb-wrap">
        <div v-if="!thumbUrl" class="batch-item-thumb-placeholder">{{ t('app.imageLoading') }}</div>
        <img v-if="thumbUrl" class="batch-item-thumb" :src="thumbUrl" alt="" />
      </div>

      <div class="batch-item-info">
        <div class="batch-item-filename" :title="displayName">{{ displayName }}</div>

        <!-- Solver select -->
        <div class="batch-item-controls">
          <span class="batch-solver-label">{{ t('batch.solverLabel') }}</span>
          <select
            class="batch-solver-select"
            v-model="solverModel"
            :disabled="allSolversDisabled || isBusy"
          >
            <option v-if="allSolversDisabled" value="" disabled>
              {{ t('batch.noSolverConfigured') }}
            </option>
            <option
              value="solve-field"
              :disabled="!solverAvailability.solveField"
              :title="t('modal.solverNoPath')"
            >
              {{ t('modal.solveFieldButton') }}
            </option>
            <option
              value="astap"
              :disabled="!solverAvailability.astap"
              :title="t('modal.solverNoPath')"
            >
              {{ t('modal.astapButton') }}
            </option>
            <option
              value="astrometry"
              :disabled="!solverAvailability.astrometry"
              :title="t('modal.solverNoApiKey')"
            >
              {{ t('modal.onlineButton') }}
            </option>
          </select>
        </div>

        <!-- Reuse online solution (fills the space below the solver dropdown) -->
        <button
          type="button"
          :class="['batch-reuse-btn', 'mt-1', { 'wcs-loaded': reuseLoaded }]"
          :disabled="!solverAvailability.astrometry || reuseLoading || isBusy"
          :title="!solverAvailability.astrometry ? t('modal.solverNoApiKey') : undefined"
          @click="handleReuse"
        >
          {{ reuseLoaded ? t('batch.reuseLoaded') : reuseLoading ? '…' : t('batch.reuseOnline') }}
        </button>
      </div>
    </div>

    <!-- Solving actions (below the preview): Manual · WCS -->
    <div class="flex gap-1 mt-2">
      <button
        type="button"
        :class="['batch-wcs-btn', { 'wcs-loaded': manualLoaded }]"
        :disabled="manualBusy || isBusy"
        @click="openManual"
      >
        {{ manualLoaded ? t('batch.manualDone') : t('batch.manualButton') }}
      </button>
      <button
        type="button"
        :class="[
          'batch-wcs-btn',
          { 'wcs-loaded': wcsLoaded && !wcsWarning, 'wcs-warning': wcsWarning },
        ]"
        :disabled="wcsLoading || isBusy"
        @click="triggerWcsFile"
      >
        {{ wcsLoaded ? `✓ ${wcsFileName}` : wcsLoading ? '…' : t('modal.wcsButton') }}
      </button>
      <button
        v-if="
          wcsLoaded &&
          item.status !== 'solving' &&
          item.status !== 'placing' &&
          item.status !== 'placed'
        "
        type="button"
        class="integration-row-trash"
        :title="t('modal.wcsRemove')"
        v-html="trashSvg"
        @click="clearWcs"
      ></button>
      <input
        ref="wcsInputEl"
        type="file"
        accept=".fit,.fits,.tif,.tiff"
        class="hidden"
        @change="handleWcsFile"
      />
    </div>

    <!-- WCS / manual error message (inline, full single-modal parity) -->
    <div v-if="wcsError" class="batch-status-upload-error">{{ wcsError }}</div>

    <!-- Hints section -->
    <div :class="['solve-hints-section', { 'has-hint': item.hintTargetName }]">
      <div class="hints-header-row">
        <span class="hints-bulb-icon">💡</span>
        <span class="hints-label-text">{{ t('modal.hintsOptional') }}</span>
        <button
          v-if="item.hintTargetName"
          type="button"
          class="hints-clear-btn"
          :title="t('modal.hintsClear')"
          @click="clearHint"
        >
          ×
        </button>
      </div>

      <div class="relative">
        <input
          type="text"
          class="star-search-input batch-hint-input w-full text-base"
          :placeholder="t('modal.hintsPlaceholder')"
          v-model="hintQuery"
          @input="onHintInput"
          @keydown.enter.prevent="selectFirstHintResult"
        />
        <div
          v-if="showHintDropdown && hintResults.length"
          class="search-results-dropdown batch-hint-dropdown"
        >
          <div
            v-for="r in hintResults"
            :key="r.label"
            class="result-item cursor-pointer"
            @click="selectHint(r)"
          >
            <div>{{ r.label }}</div>
            <div class="star-coords">RA: {{ r.ra.toFixed(2) }}° Dec: {{ r.dec.toFixed(2) }}°</div>
          </div>
        </div>
      </div>

      <!-- FOV input -->
      <div class="fov-row">
        <label class="fov-label">{{ t('modal.fovLabel') }}</label>
        <input
          type="number"
          placeholder="e.g., 2.5"
          min="0.1"
          max="180"
          step="0.1"
          class="fov-input"
          :value="item.fovDeg ?? ''"
          @change="onFovChange"
        />
        <span class="fov-unit">°</span>
      </div>
    </div>

    <!-- Status area -->
    <BatchSolveStatus
      :item="item"
      @cancel="onCancel"
      @retry="$emit('retry')"
      @retry-upload="$emit('retry-upload')"
    />

    <!-- Collapsible metadata section -->
    <div class="batch-item-meta">
      <button
        type="button"
        :class="['batch-meta-toggle', { open: item.metaOpen }]"
        @click="item.metaOpen = !item.metaOpen"
      >
        {{ t('modal.metadataToggle') }}
      </button>

      <div v-show="item.metaOpen" class="batch-meta-body">
        <MetadataEditorPanel
          v-model:displayName="item.customName"
          v-model:dsoIds="item.dsoIds"
          v-model:labels="item.labels"
          v-model:pointsOfInterest="item.pointsOfInterest"
          v-model:integrations="item.integrations"
          v-model:observationDate="item.observationDate"
          v-model:notes="item.notes"
          :knownFilterMap="knownFilterMap"
          @update:displayName="scheduleMetaSave"
          @update:dsoIds="scheduleMetaSave"
          @update:labels="scheduleMetaSave"
          @update:pointsOfInterest="scheduleMetaSave"
          @update:integrations="scheduleMetaSave"
          @update:observationDate="scheduleMetaSave"
          @update:notes="scheduleMetaSave"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted } from 'vue';
import type { BatchItem, SolverType } from '../../batch-types';
import type { SolverAvailability } from '../../api';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { searchUnified } from '../../search';
import { solveWCS, reuseAstrometrySubmission, updatePhotoMetadata } from '../../api';
import { findDSOIdsFromCorrespondences } from '../../dso-catalog';
import { stripExtension, getFileDimensions } from '../../file-utils';
import { generateThumbnail } from '../../lazy-image';
import { showToast } from '../../toast';
import { sanitizeIntegrationRows, clearWcsSolution, wcsErrorMessage } from '../../batch-utils';
import BatchSolveStatus from './BatchSolveStatus.vue';
import MetadataEditorPanel from './MetadataEditorPanel.vue';
import trashSvg from '../../icons/trash.svg?raw';

const props = defineProps<{
  item: BatchItem;
  solverAvailability: SolverAvailability;
  knownFilterMap: Map<string, string>;
}>();

const emit = defineEmits<{
  remove: [];
  retry: [];
  'retry-upload': [];
}>();

const canvasStore = useCanvasStore();

// ─── Thumbnail lazy loading ───────────────────────────────────────────────────
const cardEl = ref<HTMLElement | null>(null);
const thumbUrl = ref('');
let cardObserver: IntersectionObserver | null = null;

onMounted(() => {
  if (!cardEl.value) return;
  cardObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !thumbUrl.value) {
          thumbUrl.value = 'pending'; // mark in-progress
          generateThumbnail(props.item.file, 240).then((url) => {
            thumbUrl.value = url || '';
          });
          cardObserver?.disconnect();
        }
      }
    },
    { rootMargin: '400px 0px' },
  );
  cardObserver.observe(cardEl.value);
});

onUnmounted(() => {
  cardObserver?.disconnect();
  if (thumbUrl.value && thumbUrl.value !== 'pending') {
    URL.revokeObjectURL(thumbUrl.value);
  }
});

// ─── Computed ─────────────────────────────────────────────────────────────────
const displayName = computed(() => props.item.customName || stripExtension(props.item.file.name));

const allSolversDisabled = computed(
  () =>
    !props.solverAvailability.solveField &&
    !props.solverAvailability.astap &&
    !props.solverAvailability.astrometry,
);

// Solving/placing in progress — lock the solver choice and solution-input controls
// so they can't be changed out from under a running solve.
const isBusy = computed(
  () =>
    props.item.status === 'solving' ||
    props.item.status === 'placing' ||
    props.item.status === 'placed',
);

const solverModel = computed({
  get: () => (allSolversDisabled.value ? '' : props.item.solver),
  set: (v: string) => {
    if (v) props.item.solver = v as SolverType;
  },
});

// ─── WCS loading ──────────────────────────────────────────────────────────────
const wcsInputEl = ref<HTMLInputElement | null>(null);
const wcsLoaded = ref(false);
const wcsLoading = ref(false);
const wcsFileName = ref('');
const wcsWarning = ref(false);
const wcsError = ref('');

function triggerWcsFile() {
  if (wcsInputEl.value) {
    wcsInputEl.value.value = '';
    wcsInputEl.value.click();
  }
}

async function handleWcsFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  wcsLoading.value = true;
  wcsError.value = '';
  try {
    const { width: imgWidth, height: imgHeight } = await getFileDimensions(props.item.file);
    const result = await solveWCS(f, imgWidth || undefined, imgHeight || undefined);
    if (result.success && result.correspondences && result.correspondences.length >= 1) {
      if (result.dimensionWarning?.aspectMismatch) {
        const { sourceW, sourceH, targetW, targetH } = result.dimensionWarning;
        showToast({
          message: t('modal.wcsDimensionMismatchBody', {
            fitsW: String(sourceW),
            fitsH: String(sourceH),
            jpegW: String(targetW),
            jpegH: String(targetH),
          }),
          type: 'warning',
          duration: 6000,
        });
        wcsWarning.value = true;
      }
      props.item.wcsResult = result;
      props.item.solveCorrespondences = result.correspondences;
      props.item.status = 'success';
      // WCS solving doesn't return DSOs from the server; derive them from the
      // solved correspondences against the local catalog (like the async solvers).
      props.item.dsoIds =
        result.dsoIds && result.dsoIds.length > 0
          ? [...result.dsoIds]
          : findDSOIdsFromCorrespondences(result.correspondences, imgWidth, imgHeight);
      if (result.dateObs && !props.item.observationDate) {
        props.item.observationDate = result.dateObs;
      }
      if (result.expTime && result.stackCnt && props.item.integrations.length === 0) {
        props.item.integrations = [
          { frames: Math.round(result.stackCnt), seconds: Math.round(result.expTime), filter: '' },
        ];
      }
      wcsLoaded.value = true;
      wcsFileName.value = f.name;
    } else {
      // Full single-modal parity: specific message per failure code, shown inline.
      const info = wcsErrorMessage(result, f.name);
      wcsError.value = t(info.key, info.params);
    }
  } catch (err: any) {
    wcsError.value = t('modal.wcsParseError', {
      filename: f.name,
      detail: err.message || 'unknown error',
    });
  } finally {
    wcsLoading.value = false;
  }
}

function clearWcs() {
  clearWcsSolution(props.item);
  wcsLoaded.value = false;
  wcsFileName.value = '';
  wcsWarning.value = false;
  wcsError.value = '';
  reuseLoaded.value = false; // reuse-online writes the same wcsResult/status
  manualLoaded.value = false; // manual identify writes the same correspondences/status
  if (wcsInputEl.value) wcsInputEl.value.value = '';
}

// ─── Manual star identification ────────────────────────────────────────────────
const manualLoaded = ref(false);
const manualBusy = ref(false);

async function openManual() {
  manualBusy.value = true;
  wcsError.value = '';
  try {
    const result = await canvasStore.overlay!.openManualIdentifyModal(props.item.file, {
      initialMeta: {
        originalName: props.item.customName || undefined,
        dsoIds: props.item.dsoIds,
        labels: props.item.labels,
        pointsOfInterest: props.item.pointsOfInterest,
        integrations: props.item.integrations,
        observationDate: props.item.observationDate || null,
        notes: props.item.notes,
      },
    });
    if (result.action === 'validate') {
      props.item.solveCorrespondences = result.correspondences;
      props.item.wcsResult = null;
      props.item.status = 'success';
      manualLoaded.value = true;
    } else if (result.action === 'manual-placement') {
      // The photo was handed off to free-drag placement (it self-saves & places).
      emit('remove');
    }
  } finally {
    manualBusy.value = false;
  }
}

// ─── Reuse online solution ────────────────────────────────────────────────────
const reuseLoaded = ref(false);
const reuseLoading = ref(false);

async function handleReuse() {
  reuseLoading.value = true;
  try {
    const choice = await canvasStore.overlay!.showSubmissionSelectionDialog({ allowUpload: false });
    if (choice.action === 'cancel') return;
    if (choice.action === 'reuse' && choice.jobId) {
      const result = await reuseAstrometrySubmission(props.item.file, choice.jobId);
      if (result.success && result.correspondences && result.correspondences.length >= 1) {
        props.item.wcsResult = result;
        props.item.solveCorrespondences = result.correspondences;
        props.item.status = 'success';
        props.item.dsoIds = result.dsoIds ?? [];
        reuseLoaded.value = true;
      } else {
        showToast({
          message: result.error || t('modal.reuseFailed'),
          type: 'error',
          duration: 3000,
        });
      }
    }
  } catch (err: any) {
    showToast({ message: err.message || t('modal.reuseFailed'), type: 'error', duration: 3000 });
  } finally {
    reuseLoading.value = false;
  }
}

// ─── Hint search ──────────────────────────────────────────────────────────────
const hintQuery = ref('');
const hintResults = ref<any[]>([]);
const showHintDropdown = ref(false);
let hintDebounce: ReturnType<typeof setTimeout> | null = null;

function onHintInput() {
  if (hintDebounce) clearTimeout(hintDebounce);
  const q = hintQuery.value.trim();
  if (q.length < 2) {
    showHintDropdown.value = false;
    return;
  }
  hintDebounce = setTimeout(async () => {
    try {
      const results = await searchUnified(q, 5);
      hintResults.value = results;
      showHintDropdown.value = results.length > 0;
    } catch {
      showHintDropdown.value = false;
    }
  }, 400);
}

function selectHint(r: any) {
  props.item.hintCoords = { ra: r.ra, dec: r.dec };
  props.item.hintTargetName = r.label;
  hintQuery.value = r.label;
  showHintDropdown.value = false;
}

function selectFirstHintResult() {
  if (hintResults.value.length > 0) selectHint(hintResults.value[0]);
}

function clearHint() {
  props.item.hintCoords = null;
  props.item.hintTargetName = '';
  hintQuery.value = '';
  showHintDropdown.value = false;
}

function onFovChange(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value);
  props.item.fovDeg = isNaN(v) ? null : v;
}

// ─── Cancel in-progress solve ─────────────────────────────────────────────────
function onCancel() {
  if (!props.item.solveAbort) return;
  props.item.solveAbort.abort();
  props.item.solveAbort = null;
}

// ─── Metadata save (debounced) ────────────────────────────────────────────────
let metaSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMetaSave() {
  if (!props.item.photo) return;
  if (metaSaveTimer !== null) clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => flushMetaSave(), 600);
}

async function flushMetaSave() {
  metaSaveTimer = null;
  if (!props.item.photo) return;
  const resolvedName = props.item.customName.trim() || props.item.photo.originalName;
  const payload = {
    dsoIds: [...props.item.dsoIds],
    labels: [...props.item.labels],
    pointsOfInterest: props.item.pointsOfInterest.map((p) => ({ ...p })),
    integrations: sanitizeIntegrationRows(props.item.integrations),
    observationDate: props.item.observationDate || null,
    notes: props.item.notes,
    originalName: resolvedName,
  };
  try {
    await updatePhotoMetadata(props.item.photo.id, payload);
    const updated = { ...props.item.photo, ...payload };
    props.item.photo = updated;
    const canvas = useCanvasStore();
    canvas.overlay?.updatePhotoData(updated);
    const photos = canvas.overlay?.getPlacedPhotos().map((p) => p.photo) ?? [];
    canvas.gallery?.loadPhotos(photos);
  } catch {
    /* silent */
  }
}

onBeforeUnmount(() => {
  if (metaSaveTimer !== null && props.item.photo) {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = null;
    flushMetaSave(); // fire-and-forget
  }
});
</script>
