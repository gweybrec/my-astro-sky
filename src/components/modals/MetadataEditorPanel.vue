<template>
  <!-- Display name -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataFilename') }}</label>
    <input
      type="text"
      class="tag-input"
      :value="displayName"
      @input="emit('update:displayName', ($event.target as HTMLInputElement).value)"
    />
  </div>

  <!-- DSOs -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataDsos') }}</label>
    <div class="tag-chips">
      <span v-for="dsoId in dsoIds" :key="dsoId" class="tag-chip">
        {{ dsoId }}
        <button type="button" class="tag-chip-remove" @click="removeDso(dsoId)">×</button>
      </span>
    </div>
    <div class="tag-input-wrap relative">
      <input
        type="text"
        class="tag-input"
        :placeholder="t('modal.metadataDsosPlaceholder')"
        v-model="dsoQuery"
        @input="onDsoInput"
        @keydown.enter.prevent="addDsoFromInput"
        @blur="hideDsoSuggest"
      />
      <div v-if="showDsoSuggest && dsoResults.length" class="tag-suggest">
        <div
          v-for="r in dsoResults"
          :key="r.dso.id"
          class="tag-suggest-item"
          @mousedown.prevent="addDso(r.dso.id)"
        >
          {{ r.dso.id }}{{ r.dso.displayName ? ` — ${r.dso.displayName}` : '' }}
        </div>
      </div>
    </div>
  </div>

  <!-- Labels -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataLabels') }}</label>
    <div class="tag-chips">
      <span v-for="lbl in labels" :key="lbl" class="tag-chip label-chip">
        {{ lbl }}
        <button type="button" class="tag-chip-remove" @click="removeLabel(lbl)">×</button>
      </span>
    </div>
    <div class="tag-input-wrap relative">
      <input
        type="text"
        class="tag-input"
        :placeholder="t('modal.metadataLabelsPlaceholder')"
        v-model="labelInput"
        @input="showLabelSuggest = true"
        @focus="showLabelSuggest = true"
        @keydown="onLabelKeydown"
        @blur="onLabelBlur"
      />
      <div v-if="showLabelSuggest && labelSuggestions.length" class="tag-suggest">
        <div
          v-for="suggestion in labelSuggestions"
          :key="suggestion"
          class="tag-suggest-item"
          @mousedown.prevent="selectLabelSuggestion(suggestion)"
        >
          {{ suggestion }}
        </div>
      </div>
    </div>
  </div>

  <!-- Points of Interest -->
  <PoiEditor :pois="pointsOfInterest" @update:pois="emit('update:pointsOfInterest', $event)" />

  <!-- Integrations -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataIntegrations') }}</label>
    <div class="integration-rows">
      <template v-for="(row, idx) in rows" :key="row._id">
        <!-- Edit mode: N × Sec + filter inputs -->
        <div v-if="row._open" class="integration-row">
          <input
            type="number"
            min="0"
            step="1"
            class="tag-input integration-input integration-frames-input"
            :placeholder="t('modal.metadataIntegrationsFramesPlaceholder')"
            :title="t('modal.metadataIntegrationsFramesTooltip')"
            :value="row.frames >= 1 ? String(row.frames) : ''"
            @input="onFramesInput(idx, $event)"
          />
          <span class="integration-operator">x</span>
          <input
            type="number"
            min="0"
            step="1"
            class="tag-input integration-input integration-seconds-input"
            :placeholder="t('modal.metadataIntegrationsSecondsPlaceholder')"
            :title="t('modal.metadataIntegrationsSecondsTooltip')"
            :value="row.seconds >= 1 ? String(row.seconds) : ''"
            @input="onSecondsInput(idx, $event)"
          />
          <span class="integration-unit">{{ t('modal.metadataIntegrationsSecondsSuffix') }}</span>
          <FilterInput
            :model-value="row.filter"
            :known-filter-map="knownFilterMap"
            :placeholder="t('modal.metadataIntegrationsFilterPlaceholder')"
            :tooltip="t('modal.metadataIntegrationsFilterTooltip')"
            @update:model-value="(v) => onFilterSelect(idx, v)"
            @commit="onFilterCommit"
          />
          <button
            type="button"
            class="integration-row-validate btn-icon flex-none w-[24px] h-[24px] p-0 inline-flex items-center justify-center [&>svg]:w-[12px] [&>svg]:h-[12px] !text-[var(--status-success-text)]"
            :title="t('modal.metadataIntegrationsValidateRow')"
            :aria-label="t('modal.metadataIntegrationsValidateRow')"
            v-html="checkSvg"
            @click="validateRow(idx)"
          ></button>
          <button
            type="button"
            class="integration-row-trash"
            :title="t('modal.metadataIntegrationsRemoveRow')"
            v-html="trashSvg"
            @click="removeIntegrationRow(idx)"
          ></button>
        </div>

        <!-- Display mode: collapsed "N × Sec = Total" label. Either field may be
             left blank ("N/A"); the total + "=" show only when both are set. -->
        <div v-else class="integration-row min-h-[26px]">
          <span class="flex-1 min-w-0 truncate text-body text-secondary">
            {{ integrationRowLabel(row) }}
          </span>
          <span
            v-if="row.filter"
            :class="filterBadgeAttrs(row.filter).class"
            :style="filterBadgeAttrs(row.filter).style"
            :title="catalogBadgeTitle(row.filter) ?? row.filter"
            class="max-w-[40%] shrink-0 truncate"
            >{{ row.filter }}</span
          >
          <button
            type="button"
            class="integration-row-edit btn-icon flex-none w-[24px] h-[24px] p-0 inline-flex items-center justify-center [&>svg]:w-[12px] [&>svg]:h-[12px]"
            :title="t('modal.metadataIntegrationsEditRow')"
            :aria-label="t('modal.metadataIntegrationsEditRow')"
            v-html="penSvg"
            @click="openRow(idx)"
          ></button>
        </div>
      </template>
    </div>
    <button
      type="button"
      class="integration-add-btn integration-add-row"
      @click="addIntegrationRow"
    >
      {{ t('modal.metadataIntegrationsAddRow') }}
    </button>
  </div>

  <!-- Observation date -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataObsDate') }}</label>
    <input
      type="datetime-local"
      class="dialog-input"
      :title="t('modal.metadataObsDatePlaceholder')"
      :value="obsDateLocal"
      @input="onObsDateInput"
    />
  </div>

  <!-- Gear setup link -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataGearSetup') }}</label>
    <select
      class="dialog-input"
      :title="t('modal.metadataGearSetupPlaceholder')"
      :value="gearSetupId ?? ''"
      @change="onSetupChange"
    >
      <option value="">{{ t('modal.metadataGearSetupNone') }}</option>
      <option v-for="s in gearSetups" :key="s.id" :value="s.id">{{ s.name || s.id }}</option>
    </select>
  </div>

  <!-- Capture details (dynamic, opt-in fields) -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataCapture') }}</label>
    <div
      v-if="presentCaptureFields.length > 0"
      class="grid grid-cols-[max-content_1fr_max-content_max-content] items-center gap-x-2 gap-y-1"
    >
      <div v-for="f in presentCaptureFields" :key="f.id" class="contents">
        <span class="text-[length:var(--font-size-small)] text-label">{{ t(f.labelKey) }}</span>
        <input
          :type="f.type === 'number' ? 'number' : 'text'"
          class="tag-input gear-modal-number-input w-full min-w-0"
          :value="String(captureDetails[f.id] ?? '')"
          @input="onCaptureInput(f.id, $event)"
        />
        <span class="integration-unit">{{ f.unit }}</span>
        <button
          type="button"
          class="integration-row-trash"
          :title="t('modal.metadataCaptureRemove')"
          v-html="trashSvg"
          @click="removeCaptureField(f.id)"
        ></button>
      </div>
    </div>
    <div class="flex items-stretch gap-2 mt-1">
      <select v-model="captureFieldToAdd" class="dialog-input flex-1">
        <option value="">{{ t('modal.metadataCaptureAddPlaceholder') }}</option>
        <option v-for="f in addableCaptureFields" :key="f.id" :value="f.id">
          {{ t(f.labelKey) }}
        </option>
      </select>
      <button
        type="button"
        class="integration-add-btn !m-0 !self-stretch inline-flex items-center"
        :disabled="!captureFieldToAdd || addableCaptureFields.length === 0"
        @click="addCaptureField"
      >
        {{ t('modal.metadataCaptureAddField') }}
      </button>
    </div>
  </div>

  <!-- Notes -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataNotes') }}</label>
    <textarea
      class="notes-textarea"
      :rows="3"
      :placeholder="t('modal.metadataNotesPlaceholder')"
      :value="notes"
      @input="emit('update:notes', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { filterLabelCandidates } from '../../autocomplete-utils';
import { filterBadgeAttrs, catalogBadgeTitle } from '../../chip-utils';
import type { PhotoIntegration, PointOfInterest, CaptureDetails } from '../../types';
import type { GearSetupData } from '../../api';
import { CAPTURE_FIELDS } from '../../capture-fields';
import { t } from '../../i18n';
import { searchDSOs } from '../../search';
import { showToast } from '../../toast';
import { formatIntegrationTotal, normalizeIntegrationFilterKey } from '../../batch-utils';
import FilterInput from './FilterInput.vue';
import PoiEditor from './PoiEditor.vue';
import trashSvg from '../../icons/trash.svg?raw';
import penSvg from '../../icons/pen.svg?raw';
import checkSvg from '../../icons/check.svg?raw';

const props = defineProps<{
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  observationDate: string;
  captureDetails: CaptureDetails;
  gearSetupId: string | null;
  gearSetups: GearSetupData[];
  notes: string;
  displayName: string;
  knownFilterMap: Map<string, string>;
  knownLabels?: string[];
}>();

const emit = defineEmits<{
  'update:dsoIds': [string[]];
  'update:labels': [string[]];
  'update:pointsOfInterest': [PointOfInterest[]];
  'update:integrations': [PhotoIntegration[]];
  'update:observationDate': [string];
  'update:captureDetails': [CaptureDetails];
  'update:gearSetupId': [string | null];
  'update:notes': [string];
  'update:displayName': [string];
}>();

// ─── Gear setup link ──────────────────────────────────────────────────────────
function onSetupChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  emit('update:gearSetupId', val || null);
}

// ─── Capture details (dynamic fields) ─────────────────────────────────────────
// A field's row is shown only when its id is present in captureDetails (parsed or
// added by the user); the picker offers the rest, in catalog order.
const presentCaptureFields = computed(() =>
  CAPTURE_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(props.captureDetails, f.id)),
);
const addableCaptureFields = computed(() =>
  CAPTURE_FIELDS.filter((f) => !Object.prototype.hasOwnProperty.call(props.captureDetails, f.id)),
);
const captureFieldToAdd = ref('');

function onCaptureInput(id: string, e: Event) {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  const raw = (e.target as HTMLInputElement).value;
  // Keep the key (as '') while empty so the row stays editable; sanitize drops it on save.
  let value: number | string;
  if (field?.type === 'number') {
    value = raw.trim() === '' ? '' : Number(raw);
    if (typeof value === 'number' && !Number.isFinite(value)) return; // ignore junk mid-typing
  } else {
    value = raw;
  }
  emit('update:captureDetails', { ...props.captureDetails, [id]: value });
}

function removeCaptureField(id: string) {
  const next = { ...props.captureDetails };
  delete next[id];
  emit('update:captureDetails', next);
}

function addCaptureField() {
  const id = captureFieldToAdd.value;
  if (!id || Object.prototype.hasOwnProperty.call(props.captureDetails, id)) return;
  emit('update:captureDetails', { ...props.captureDetails, [id]: '' });
  captureFieldToAdd.value = '';
}

// ─── Observation date ─────────────────────────────────────────────────────────
const obsDateLocal = computed(() => {
  if (!props.observationDate) return '';
  const d = new Date(props.observationDate);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

function onObsDateInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  emit('update:observationDate', val ? new Date(val).toISOString() : '');
}

// ─── DSO search ───────────────────────────────────────────────────────────────
const dsoQuery = ref('');
const dsoResults = ref<any[]>([]);
const showDsoSuggest = ref(false);
let dsoSearchTimer: ReturnType<typeof setTimeout> | null = null;

function onDsoInput() {
  if (dsoSearchTimer) clearTimeout(dsoSearchTimer);
  const q = dsoQuery.value.trim();
  if (!q) {
    showDsoSuggest.value = false;
    return;
  }
  dsoSearchTimer = setTimeout(() => {
    const results = searchDSOs(q, 8);
    dsoResults.value = results;
    showDsoSuggest.value = results.length > 0;
  }, 200);
}

function addDso(id: string) {
  if (!props.dsoIds.includes(id)) {
    emit('update:dsoIds', [...props.dsoIds, id]);
  }
  dsoQuery.value = '';
  showDsoSuggest.value = false;
}

function addDsoFromInput() {
  const val = dsoQuery.value.trim().replace(/\s+/g, '');
  if (val && !props.dsoIds.includes(val)) {
    emit('update:dsoIds', [...props.dsoIds, val]);
  }
  dsoQuery.value = '';
  showDsoSuggest.value = false;
}

function removeDso(id: string) {
  emit(
    'update:dsoIds',
    props.dsoIds.filter((d) => d !== id),
  );
}

function hideDsoSuggest() {
  setTimeout(() => {
    showDsoSuggest.value = false;
  }, 150);
}

// ─── Labels ───────────────────────────────────────────────────────────────────
const labelInput = ref('');
const showLabelSuggest = ref(false);
const localKnownLabels = ref<string[]>([]);

onMounted(() => {
  const seed = new Set([...(props.knownLabels ?? []), ...props.labels]);
  localKnownLabels.value = [...seed];
});

const labelSuggestions = computed(() =>
  filterLabelCandidates(localKnownLabels.value, props.labels, labelInput.value),
);

function commitLabel(val: string) {
  const trimmed = val.trim();
  if (!trimmed || props.labels.includes(trimmed)) return;
  emit('update:labels', [...props.labels, trimmed]);
  if (!localKnownLabels.value.includes(trimmed)) localKnownLabels.value.push(trimmed);
}

function selectLabelSuggestion(suggestion: string) {
  commitLabel(suggestion);
  labelInput.value = '';
  showLabelSuggest.value = false;
}

function onLabelKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    commitLabel(labelInput.value);
    labelInput.value = '';
    showLabelSuggest.value = false;
  } else if (e.key === 'Escape') {
    showLabelSuggest.value = false;
  }
}

function onLabelBlur() {
  commitLabel(labelInput.value);
  labelInput.value = '';
  setTimeout(() => {
    showLabelSuggest.value = false;
  }, 150);
}

function removeLabel(lbl: string) {
  emit(
    'update:labels',
    props.labels.filter((l) => l !== lbl),
  );
}

// ─── Integration rows ─────────────────────────────────────────────────────────
// Each row carries transient view state: `_open` toggles between the editable
// inputs and the collapsed `N × Sec = Total` label; `_id` is a stable v-for key.
// Neither is ever emitted. We keep a local working copy so a mode toggle is a
// pure UI change (no emit) and per-row state survives re-renders.
type EditableRow = PhotoIntegration & { _open: boolean; _id: number };

let rowSeq = 0;
// A row is worth collapsing once it carries at least one value; either the frame
// count or the exposure may be left blank (rendered as "N/A" in display mode).
const hasData = (r: PhotoIntegration) => r.frames >= 1 || r.seconds >= 1;
const toRows = (list: PhotoIntegration[]): EditableRow[] =>
  list.map((r) => ({ ...r, _open: !hasData(r), _id: ++rowSeq }));

/** Collapsed-row text: "300 × N/A", "N/A × 10s", or "120 × 180s = 6h00". */
function integrationRowLabel(row: PhotoIntegration): string {
  const na = t('modal.metadataIntegrationsFieldNA');
  const sfx = t('modal.metadataIntegrationsSecondsSuffix');
  const framesText = row.frames >= 1 ? String(row.frames) : na;
  const secondsText = row.seconds >= 1 ? `${row.seconds}${sfx}` : na;
  let label = `${framesText} × ${secondsText}`;
  if (row.frames >= 1 && row.seconds >= 1) {
    label += ` = ${formatIntegrationTotal(row.frames * row.seconds)}`;
  }
  return label;
}

const rows = ref<EditableRow[]>(toRows(props.integrations));

const stripped = (): PhotoIntegration[] =>
  rows.value.map((r) => ({ frames: r.frames, seconds: r.seconds, filter: r.filter }));
const emitRows = () => emit('update:integrations', stripped());

const sameShape = (a: PhotoIntegration[], b: readonly EditableRow[]): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) => x.frames === b[i].frames && x.seconds === b[i].seconds && x.filter === b[i].filter,
  );

// Rebuild the local rows only on an EXTERNAL change (WCS prefill replacing the
// array, clearWcsSolution emptying it, the panel reused for another photo). Our
// own emits round-trip back structurally identical, so `sameShape` is true and
// in-progress edits / `_open` state survive. No `immediate`: `rows` is already
// seeded above. Contract: parents must assign `update:integrations` back
// untransformed (gallery `state.integrations = v`; batch `v-model`).
watch(
  () => props.integrations,
  (next) => {
    if (sameShape(next, rows.value)) return;
    rows.value = toRows(next);
  },
);

function onFramesInput(idx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (!raw) {
    rows.value[idx].frames = 0;
    emitRows();
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    showToast({ message: t('errors.invalidIntegrationNumber'), type: 'error', duration: 4000 });
    return;
  }
  rows.value[idx].frames = parsed;
  emitRows();
}

function onSecondsInput(idx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (!raw) {
    rows.value[idx].seconds = 0;
    emitRows();
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    showToast({ message: t('errors.invalidIntegrationNumber'), type: 'error', duration: 4000 });
    return;
  }
  rows.value[idx].seconds = parsed;
  emitRows();
}

function onFilterSelect(idx: number, v: string) {
  rows.value[idx].filter = v;
  emitRows();
}

function onFilterCommit(v: string) {
  if (v) {
    const key = normalizeIntegrationFilterKey(v);
    if (!props.knownFilterMap.has(key)) props.knownFilterMap.set(key, v.trim());
  }
}

function removeIntegrationRow(idx: number) {
  rows.value.splice(idx, 1);
  emitRows();
}

function addIntegrationRow() {
  rows.value.push({ frames: 0, seconds: 0, filter: '', _open: true, _id: ++rowSeq });
  emitRows();
}

// Collapse a row to its label. At least one of frames / seconds must be set;
// the other may stay blank. Pure view change — no emit.
function validateRow(idx: number) {
  const r = rows.value[idx];
  if (r.frames < 1 && r.seconds < 1) {
    showToast({ message: t('errors.integrationRowIncomplete'), type: 'error', duration: 4000 });
    return;
  }
  r._open = false;
}

// Reopen a collapsed row for editing. Pure view change — no emit.
function openRow(idx: number) {
  rows.value[idx]._open = true;
}
</script>
