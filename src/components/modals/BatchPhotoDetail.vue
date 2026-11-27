<template>
  <div ref="rootEl" class="flex flex-col gap-7 min-w-0" :data-item-id="item.id">
    <!-- 1. Where the photo stands -->
    <div class="flex gap-7 items-start">
      <div
        class="shrink-0 w-[128px] h-[86px] rounded-md overflow-hidden bg-[var(--bg-input)] border border-[var(--border-white-xs)] flex items-center justify-center text-muted"
      >
        <img
          v-if="item.thumbBlobUrl"
          :src="item.thumbBlobUrl"
          alt=""
          class="w-full h-full object-cover"
        />
        <span v-else class="[&_svg]:w-7 [&_svg]:h-7" v-html="imageSvg"></span>
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-3">
        <div class="flex items-center gap-4">
          <span class="flex-1 min-w-0 truncate text-large text-bright" :title="displayName">{{
            displayName
          }}</span>
          <button
            v-if="canRemove"
            type="button"
            class="btn-icon--danger !px-2"
            :title="t('batch.removeItem')"
            :aria-label="t('batch.removeItem')"
            @click="emit('remove')"
          >
            <span class="flex [&_svg]:w-4 [&_svg]:h-4" v-html="trashSvg"></span>
          </button>
        </div>
        <span v-if="item.rawName" class="text-base text-dim truncate">{{
          t('batch.rawConvertedBadge', { rawName: item.rawName })
        }}</span>
        <BatchSolveStatus :item="item" @cancel="emit('cancel')" />
        <div v-if="wcsError || item.wcsNotice" class="text-base text-[var(--status-warn-text)]">
          {{ wcsError || item.wcsNotice }}
        </div>
        <div v-if="item.fitsHeaders?.length">
          <button
            type="button"
            class="btn-cancel !py-1h !px-6 !text-base"
            data-test="fits-headers-btn"
            :title="t('modal.fitsHeadersTitle')"
            @click="showFitsHeaders(item.fitsHeaders!)"
          >
            {{ t('modal.fitsHeadersButton') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 2. Equipment and labels, at the top so they are not forgotten -->
    <div
      class="grid grid-cols-[260px_1fr] gap-x-7 items-start [&>*:has(>select)]:order-first [&>.metadata-field]:!mt-0 [&_select]:!py-[var(--space-2h)] [&_select]:!h-[25.2px] [&_.tag-chips:empty]:hidden"
    >
      <MetadataEditorPanel
        fields="top"
        v-model:displayName="item.customName"
        v-model:dsoIds="item.dsoIds"
        v-model:labels="item.labels"
        v-model:pointsOfInterest="item.pointsOfInterest"
        v-model:integrations="item.integrations"
        v-model:observationDate="item.observationDate"
        v-model:captureDetails="item.captureDetails"
        v-model:gearSetupId="item.gearSetupId"
        v-model:notes="item.notes"
        :knownFilterMap="knownFilterMap"
        :gearSetups="gearSetups"
        :photo="item.photo"
        @update:labels="changed"
        @update:gearSetupId="changed"
      />
    </div>

    <!-- 3. Placement -->
    <section v-if="showsPlacedLine" class="flex flex-col gap-4">
      <h3 class="bw-section-title">{{ t('batch.placementTitle') }}</h3>
      <div
        class="flex items-center gap-4 px-7 py-6 border border-[var(--border-panel)] rounded-lg bg-card text-secondary"
        data-test="placed-line"
      >
        {{ placedLine }}
      </div>
    </section>
    <section v-else class="flex flex-col gap-4">
      <h3 class="bw-section-title">{{ t('mobile.gallery.chooseMethod') }}</h3>

      <!-- The hint both solves use: the target icon marks it and each solve that sends it -->
      <div class="bw-hint" :class="{ 'opacity-45': anyOff }" data-test="hint">
        <span class="bw-hint-mark--lg" aria-hidden="true" v-html="targetSvg"></span>
        <label class="bw-field-label shrink-0" :for="`hint-target-${item.id}`">{{
          t('batch.hintTarget')
        }}</label>
        <span class="relative flex-1 min-w-0">
          <input
            :id="`hint-target-${item.id}`"
            type="text"
            class="bw-hint-input"
            :placeholder="t('modal.hintsPlaceholder')"
            v-model="hintQuery"
            :disabled="anyOff"
            @input="onHintInput"
            @keydown.enter.prevent="selectFirstHintResult"
          />
          <span
            v-if="showHintDropdown && hintResults.length"
            class="search-results-dropdown left-0 right-0 top-full"
          >
            <span
              v-for="r in hintResults"
              :key="r.label"
              class="result-item cursor-pointer block"
              @click="selectHint(r)"
            >
              <span class="block">{{ r.label }}</span>
              <span class="star-coords block"
                >RA: {{ r.ra.toFixed(2) }}° Dec: {{ r.dec.toFixed(2) }}°</span
              >
            </span>
          </span>
        </span>
        <label class="bw-field-label shrink-0" :for="`hint-fov-${item.id}`">{{
          t('batch.hintFov')
        }}</label>
        <span class="shrink-0 flex items-center gap-3 text-dim">
          <input
            :id="`hint-fov-${item.id}`"
            type="number"
            min="0.1"
            max="180"
            step="0.1"
            class="bw-hint-input !w-[80px]"
            :placeholder="t('batch.hintFovPlaceholder')"
            :value="item.fovDeg ?? ''"
            :disabled="anyOff"
            @change="onFovChange"
          />°
        </span>
      </div>

      <!-- Methods that run on this computer -->
      <div class="bw-method-group" role="group" :aria-label="t('batch.groupLocal')">
        <div class="bw-method-group-head">
          <span class="inline-flex" aria-hidden="true" v-html="monitorSvg"></span
          >{{ t('batch.groupLocal') }}
        </div>

        <!-- Solve on the computer -->
        <div :class="methodClass('local')" data-test="method-local">
          <div class="flex items-center gap-7">
            <div class="flex-1 min-w-0 flex flex-col gap-1" :class="{ 'opacity-45': localOff }">
              <span class="flex items-center gap-4" :class="titleClass('local')"
                >{{ doneMark('local') }}{{ t('batch.methodLocal')
                }}<span
                  class="bw-hint-mark"
                  role="img"
                  :title="t('batch.usesHint')"
                  :aria-label="t('batch.usesHint')"
                  v-html="targetSvg"
                ></span
              ></span>
              <span class="text-small text-dim">{{
                hasLocalSolver ? t('batch.methodLocalSub') : t('modal.solverNoPath')
              }}</span>
            </div>
            <div class="shrink-0 flex items-center gap-4">
              <template v-if="isDone('local')">
                <button
                  type="button"
                  class="btn-cancel bw-method-control !text-primary"
                  @click="removePlacement"
                >
                  {{ t('batch.removePlacement') }}
                </button>
              </template>
              <template v-else>
                <select
                  v-if="hasLocalSolver"
                  v-model="localSolver"
                  class="input-base bw-method-control !w-auto"
                  :aria-label="t('batch.solverLabel')"
                  :disabled="localOff"
                >
                  <option v-if="solverAvailability.astap" value="astap">ASTAP</option>
                  <option v-if="solverAvailability.solveField" value="solve-field">
                    solve-field
                  </option>
                </select>
                <button
                  type="button"
                  class="btn-action bw-method-control"
                  :disabled="localOff"
                  data-test="solve-local"
                  @click="emit('solve', localSolver)"
                >
                  {{ t('batch.methodSolve') }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- An already solved file -->
        <div :class="methodClass('file')" data-test="method-file">
          <div class="flex items-center gap-7">
            <div
              class="flex-1 min-w-0 flex flex-col gap-1"
              :class="{ 'opacity-45': offFor('file') }"
            >
              <span :class="titleClass('file')"
                >{{ doneMark('file')
                }}{{
                  isDone('file') && item.wcsFileName
                    ? t('batch.placedByFile', { file: item.wcsFileName })
                    : t('gallery.loadFromWcs')
                }}</span
              >
              <span class="text-small text-dim">{{ t('batch.methodWcsSub') }}</span>
            </div>
            <button
              v-if="isDone('file')"
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              @click="removePlacement"
            >
              {{ t('batch.removePlacement') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              :disabled="offFor('file') || wcsLoading"
              @click="triggerWcsFile"
            >
              {{ wcsLoading ? '…' : t('batch.methodChooseFile') }}
            </button>
            <input
              ref="wcsInputEl"
              type="file"
              :accept="RAW_COMPANION_ACCEPT"
              class="hidden"
              @change="handleWcsFile"
            />
          </div>
        </div>

        <!-- Identify 3 stars -->
        <div :class="methodClass('stars')" data-test="method-stars">
          <div class="flex items-center gap-7">
            <div
              class="flex-1 min-w-0 flex flex-col gap-1"
              :class="{ 'opacity-45': offFor('stars') }"
            >
              <span :class="titleClass('stars')"
                >{{ doneMark('stars') }}{{ t('mobile.gallery.identifyStars') }}</span
              >
              <span class="text-small text-dim">{{ t('batch.methodStarsSub') }}</span>
            </div>
            <button
              v-if="isDone('stars')"
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              @click="removePlacement"
            >
              {{ t('batch.removePlacement') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              :disabled="offFor('stars') || manualBusy"
              @click="openStars"
            >
              {{ t('batch.methodOpen') }}
            </button>
          </div>
        </div>

        <!-- Place by hand -->
        <div :class="methodClass('hand')" data-test="method-hand">
          <div class="flex items-center gap-7">
            <div
              class="flex-1 min-w-0 flex flex-col gap-1"
              :class="{ 'opacity-45': offFor('hand') }"
            >
              <span :class="titleClass('hand')"
                >{{ doneMark('hand') }}{{ t('mobile.gallery.placeByHand') }}</span
              >
              <span class="text-small text-dim">{{ t('mobile.gallery.placeByHandSub') }}</span>
            </div>
            <button
              v-if="isDone('hand')"
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              @click="removePlacement"
            >
              {{ t('batch.removePlacement') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              :disabled="offFor('hand') || manualBusy"
              @click="openHand"
            >
              {{ t('batch.methodOpen') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Methods that go through astrometry.net -->
      <div class="bw-method-group" role="group" :aria-label="t('batch.groupOnline')">
        <div class="bw-method-group-head">
          <span class="inline-flex" aria-hidden="true" v-html="cloudSvg"></span
          >{{ t('batch.groupOnline') }}
        </div>

        <!-- Fetch the result of a solve astrometry.net goes on with -->
        <div v-if="canFetch" class="bw-method" data-test="method-fetch">
          <div class="flex items-center gap-7">
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <span class="text-base text-primary">{{ t('batch.methodFetch') }}</span>
              <span class="text-small text-dim">{{ t('batch.methodFetchSub') }}</span>
            </div>
            <button type="button" class="btn-action bw-method-control" @click="emit('fetch')">
              {{ t('batch.methodFetchButton') }}
            </button>
          </div>
        </div>

        <!-- Solve online -->
        <div :class="methodClass('online')" data-test="method-online">
          <div class="flex items-center gap-7">
            <div class="flex-1 min-w-0 flex flex-col gap-1" :class="{ 'opacity-45': onlineOff }">
              <span class="flex items-center gap-4" :class="titleClass('online')"
                >{{ doneMark('online') }}{{ t('mobile.gallery.solveOnline')
                }}<span
                  class="bw-hint-mark"
                  role="img"
                  :title="t('batch.usesHint')"
                  :aria-label="t('batch.usesHint')"
                  v-html="targetSvg"
                ></span
              ></span>
              <span class="text-small text-dim">{{ onlineSub }}</span>
            </div>
            <button
              v-if="isDone('online')"
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              @click="removePlacement"
            >
              {{ t('batch.removePlacement') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-action bw-method-control"
              :disabled="onlineOff"
              data-test="solve-online"
              @click="emit('solve', 'astrometry')"
            >
              {{ t('batch.methodSolve') }}
            </button>
          </div>
        </div>

        <!-- Re-use a solution of the astrometry.net account -->
        <div :class="methodClass('reuse')" data-test="method-reuse">
          <div class="flex items-center gap-7">
            <div class="flex-1 min-w-0 flex flex-col gap-1" :class="{ 'opacity-45': reuseOff }">
              <span :class="titleClass('reuse')"
                >{{ doneMark('reuse') }}{{ t('batch.methodReuse') }}</span
              >
              <span class="text-small text-dim">{{
                solverAvailability.astrometry
                  ? t('mobile.gallery.reuseSolutionSub')
                  : t('modal.solverNoApiKey')
              }}</span>
            </div>
            <button
              v-if="isDone('reuse')"
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              @click="removePlacement"
            >
              {{ t('batch.removePlacement') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-cancel bw-method-control !text-primary"
              :disabled="reuseOff || reuseLoading"
              @click="handleReuse"
            >
              {{ reuseLoading ? '…' : t('batch.methodChoose') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. The rest of the metadata -->
    <section class="flex flex-col gap-4">
      <h3 class="bw-section-title">{{ t('batch.informations') }}</h3>
      <div class="flex flex-col">
        <MetadataEditorPanel
          fields="rest"
          v-model:displayName="item.customName"
          v-model:dsoIds="item.dsoIds"
          v-model:labels="item.labels"
          v-model:pointsOfInterest="item.pointsOfInterest"
          v-model:integrations="item.integrations"
          v-model:observationDate="item.observationDate"
          v-model:captureDetails="item.captureDetails"
          v-model:gearSetupId="item.gearSetupId"
          v-model:notes="item.notes"
          :knownFilterMap="knownFilterMap"
          :gearSetups="gearSetups"
          :photo="item.photo"
          @update:displayName="changed"
          @update:dsoIds="changed"
          @update:pointsOfInterest="changed"
          @update:integrations="changed"
          @update:observationDate="changed"
          @update:captureDetails="changed"
          @update:notes="changed"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BatchItem, BatchPlacedBy, SolverType } from '../../batch-types';
import type { SolverAvailability, GearSetupData } from '../../api';
import { reuseAstrometrySubmission } from '../../api';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { searchUnified } from '@myastrosky/core/search';
import { stripExtension, getFileDimensions } from '../../file-utils';
import { showToast, showErrorToast } from '../../toast';
import { clearWcsSolution, isItemPlaced, markChanged } from '../../batch-utils';
import { applyWcsResultToItem } from '../../batch-wcs';
import { photoSkyModel } from '@myastrosky/core/photo-placement';
import { noSolutionMessage, readWcsFileForPhoto } from '../../wcs-load-flow';
import { showFitsHeaders } from '../../wcs-dialogs';
import { RAW_COMPANION_ACCEPT } from '@myastrosky/core/photo-formats';
import BatchSolveStatus from './BatchSolveStatus.vue';
import MetadataEditorPanel from './MetadataEditorPanel.vue';
import trashSvg from '../../icons/trash.svg?raw';
import imageSvg from '../../icons/image.svg?raw';
import targetSvg from '../../icons/target.svg?raw';
import monitorSvg from '../../icons/monitor.svg?raw';
import cloudSvg from '../../icons/cloud.svg?raw';

const props = defineProps<{
  item: BatchItem;
  solverAvailability: SolverAvailability;
  knownFilterMap: Map<string, string>;
  gearSetups: GearSetupData[];
}>();

const emit = defineEmits<{
  remove: [];
  /** Solve this photo now with this solver. */
  solve: [SolverType];
  /** Fetch the result of the solve astrometry.net goes on with. */
  fetch: [];
  cancel: [];
}>();

const canvasStore = useCanvasStore();
const rootEl = ref<HTMLElement | null>(null);

const displayName = computed(() => props.item.customName || stripExtension(props.item.file.name));

/** A field changed: a saved photo is "À réenregistrer". */
function changed() {
  markChanged(props.item);
}

// ─── Which rows can act ───────────────────────────────────────────────────────
const busy = computed(
  () =>
    ['solving', 'waiting', 'converting'].includes(props.item.status) ||
    props.item.saveState === 'saving',
);
const placed = computed(() => isItemPlaced(props.item));
/** Every method is locked while the photo is busy, and the others once it is placed. */
const anyOff = computed(() => busy.value || placed.value);
const offFor = (_m: BatchPlacedBy) => anyOff.value;
const isDone = (m: BatchPlacedBy) => placed.value && props.item.placedBy === m;
const doneMark = (m: BatchPlacedBy) => (isDone(m) ? '✓ ' : '');
const methodClass = (m: BatchPlacedBy) => (isDone(m) ? 'bw-method--done' : 'bw-method');
const titleClass = (m: BatchPlacedBy) =>
  isDone(m) ? 'text-base text-[var(--status-success-text)]' : 'text-base text-primary';

const hasLocalSolver = computed(
  () => props.solverAvailability.astap || props.solverAvailability.solveField,
);
const localOff = computed(() => anyOff.value || !hasLocalSolver.value);
const unfinished = computed(() => props.item.status === 'unfinished');
const onlineOff = computed(
  () => anyOff.value || !props.solverAvailability.astrometry || unfinished.value,
);
const onlineSub = computed(() =>
  !props.solverAvailability.astrometry
    ? t('modal.solverNoApiKey')
    : unfinished.value
      ? t('batch.onlineRunning')
      : t('batch.methodOnlineSub'),
);
const reuseOff = computed(() => anyOff.value || !props.solverAvailability.astrometry);
const canFetch = computed(
  () =>
    unfinished.value && !!props.item.online?.submissionId && props.solverAvailability.astrometry,
);

/** The local solver the row runs: the item's own when it is a local one, else the first available. */
const localSolver = ref<SolverType>(
  props.item.solver !== 'astrometry'
    ? props.item.solver
    : props.solverAvailability.astap
      ? 'astap'
      : 'solve-field',
);
watch(localSolver, (s) => {
  if (props.item.solver !== 'astrometry') props.item.solver = s;
});

// A saved photo whose placement is stored shows one line instead of the methods.
const showsPlacedLine = computed(
  () => placed.value && props.item.saveState !== 'new' && props.item.placementSaved,
);
const SOLVER_NAMES: Record<SolverType, string> = {
  'solve-field': 'solve-field',
  astap: 'ASTAP',
  astrometry: 'astrometry.net',
};
const placedLine = computed(() => {
  const item = props.item;
  switch (item.placedBy) {
    case 'file':
      return `✓ ${t('batch.placedByFile', { file: item.wcsFileName ?? item.rawName ?? item.file.name })}`;
    case 'reuse':
      return `✓ ${t('batch.placedByReuse')}`;
    case 'hand':
      return t('mobile.gallery.placedByHand');
    case 'stars':
      return t('mobile.gallery.placedByStars', {
        n: String(item.solveCorrespondences?.length ?? 3),
      });
    case 'online':
      return `✓ ${t('batch.placedBySolver', { solver: SOLVER_NAMES.astrometry })}`;
    default:
      return `✓ ${t('batch.placedBySolver', { solver: SOLVER_NAMES[item.solver] })}`;
  }
});

const canRemove = computed(() => props.item.saveState === 'new' && !busy.value);

/** "Retirer le placement": back to "À résoudre". */
function removePlacement() {
  clearWcsSolution(props.item);
  wcsError.value = '';
  if (wcsInputEl.value) wcsInputEl.value.value = '';
}

/** A placement was found by one of this panel's methods. */
function placedBy(by: BatchPlacedBy) {
  props.item.placedBy = by;
  props.item.status = 'success';
  props.item.error = '';
  props.item.diagnostics = undefined;
  markChanged(props.item, { placement: true });
}

// ─── An already solved file ───────────────────────────────────────────────────
const wcsInputEl = ref<HTMLInputElement | null>(null);
const wcsLoading = ref(false);
const wcsError = ref('');

function triggerWcsFile() {
  if (!wcsInputEl.value) return;
  wcsInputEl.value.value = '';
  wcsInputEl.value.click();
}

async function handleWcsFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  wcsLoading.value = true;
  wcsError.value = '';
  try {
    const item = props.item;
    const { width, height } = await getFileDimensions(item.file);
    const skyModel =
      width && height && (item.solveCorrespondences?.length || item.manualPlacement)
        ? photoSkyModel({
            width,
            height,
            correspondences: item.solveCorrespondences ?? [],
            manualPlacement: item.manualPlacement ?? undefined,
          })
        : null;
    const outcome = await readWcsFileForPhoto(f, {
      width,
      height,
      dsoIds: item.dsoIds,
      skyModel,
      gearSetupId: item.gearSetupId,
    });
    if (outcome.kind === 'error') {
      wcsError.value = outcome.message;
      return;
    }
    if (outcome.kind === 'cancelled') return;
    const applied = applyWcsResultToItem(
      item,
      outcome.result,
      width,
      height,
      outcome.suggestedSetup?.id ?? null,
    );
    markChanged(item);
    if (applied.applied) {
      item.wcsNotice = '';
      item.wcsFileName = f.name;
      placedBy('file');
    } else {
      // No plate solution: the capture data was taken, the photo still has to be placed.
      item.wcsNotice = noSolutionMessage(f.name);
    }
  } catch (err: any) {
    wcsError.value = t('modal.wcsParseError', {
      filename: f.name,
      detail: err?.message || 'unknown error',
    });
  } finally {
    wcsLoading.value = false;
  }
}

// ─── Re-use a solution of the account ─────────────────────────────────────────
const reuseLoading = ref(false);

async function handleReuse() {
  reuseLoading.value = true;
  try {
    const choice = await canvasStore.overlay!.showSubmissionSelectionDialog({ allowUpload: false });
    if (choice.action !== 'reuse' || !choice.jobId) return;
    const result = await reuseAstrometrySubmission(props.item.file, choice.jobId);
    if (result.success && result.correspondences && result.correspondences.length >= 1) {
      props.item.wcsResult = result;
      props.item.solveCorrespondences = result.correspondences;
      props.item.manualPlacement = null;
      props.item.dsoIds = [...new Set([...props.item.dsoIds, ...(result.dsoIds ?? [])])];
      props.item.online = null;
      placedBy('reuse');
    } else {
      showToast({ message: result.error || t('modal.reuseFailed'), type: 'error', duration: 3000 });
    }
  } catch (err: any) {
    showErrorToast(err, 'modal.reuseFailed', { category: 'batch_reuse_failed' });
  } finally {
    reuseLoading.value = false;
  }
}

// ─── Identify 3 stars / place by hand ─────────────────────────────────────────
const manualBusy = ref(false);
const hostBackdrop = () => rootEl.value?.closest<HTMLElement>('.modal-backdrop') ?? null;

async function openStars() {
  manualBusy.value = true;
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
      hostBackdrop: hostBackdrop(),
      starsOnly: true,
    });
    if (result.action === 'validate') {
      props.item.solveCorrespondences = result.correspondences;
      props.item.manualPlacement = null;
      props.item.wcsResult = null;
      placedBy('stars');
    }
  } finally {
    manualBusy.value = false;
  }
}

async function openHand() {
  manualBusy.value = true;
  try {
    const placement = await canvasStore.overlay!.openManualPlacement(
      props.item.file,
      hostBackdrop(),
    );
    if (placement) {
      props.item.solveCorrespondences = placement.correspondences;
      props.item.manualPlacement = placement.placement;
      props.item.wcsResult = null;
      if (props.item.dsoIds.length === 0) props.item.dsoIds = placement.dsoIds;
      placedBy('hand');
    }
  } finally {
    manualBusy.value = false;
  }
}

// ─── The hint both solvers use ────────────────────────────────────────────────
const hintQuery = ref(props.item.hintTargetName);
const hintResults = ref<{ label: string; ra: number; dec: number }[]>([]);
const showHintDropdown = ref(false);
let hintDebounce: ReturnType<typeof setTimeout> | null = null;

function onHintInput() {
  if (hintDebounce) clearTimeout(hintDebounce);
  const q = hintQuery.value.trim();
  if (q.length < 2) {
    showHintDropdown.value = false;
    if (!q) {
      props.item.hintCoords = null;
      props.item.hintTargetName = '';
    }
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

function selectHint(r: { label: string; ra: number; dec: number }) {
  props.item.hintCoords = { ra: r.ra, dec: r.dec };
  props.item.hintTargetName = r.label;
  hintQuery.value = r.label;
  showHintDropdown.value = false;
}

function selectFirstHintResult() {
  if (hintResults.value.length > 0) selectHint(hintResults.value[0]);
}

function onFovChange(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value);
  props.item.fovDeg = isNaN(v) ? null : v;
}
</script>
