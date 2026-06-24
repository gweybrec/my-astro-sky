<template>
  <!-- Display name -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataFilename') }}</label>
    <input type="text" class="tag-input" :value="displayName" @input="emit('update:displayName', ($event.target as HTMLInputElement).value)" />
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
        >{{ r.dso.id }}{{ r.dso.displayName ? ` — ${r.dso.displayName}` : '' }}</div>
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
        >{{ suggestion }}</div>
      </div>
    </div>
  </div>

  <!-- Points of Interest -->
  <PoiEditor :pois="pointsOfInterest" @update:pois="emit('update:pointsOfInterest', $event)" />

  <!-- Integrations -->
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataIntegrations') }}</label>
    <div class="integration-rows">
      <div v-for="(row, idx) in integrations" :key="idx" class="integration-row">
        <input
          type="number" min="0" step="1"
          class="tag-input integration-input integration-frames-input"
          :placeholder="t('modal.metadataIntegrationsFramesPlaceholder')"
          :title="t('modal.metadataIntegrationsFramesTooltip')"
          :value="row.frames >= 1 ? String(row.frames) : ''"
          @input="onFramesInput(idx, $event)"
        />
        <span class="integration-operator">x</span>
        <input
          type="number" min="0" step="1"
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
          class="integration-row-trash"
          :title="t('modal.metadataIntegrationsRemoveRow')"
          v-html="trashSvg"
          @click="removeIntegrationRow(idx)"
        ></button>
      </div>
    </div>
    <button type="button" class="integration-add-btn" @click="addIntegrationRow">
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
import { ref, computed, onMounted } from 'vue';
import { filterLabelCandidates } from '../../autocomplete-utils';
import type { PhotoIntegration, PointOfInterest } from '../../types';
import { t } from '../../i18n';
import { searchDSOs } from '../../search';
import { showToast } from '../../toast';
import { normalizeIntegrationFilterKey } from '../../batch-utils';
import FilterInput from './FilterInput.vue';
import PoiEditor from './PoiEditor.vue';
import trashSvg from '../../icons/trash.svg?raw';

const props = defineProps<{
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  observationDate: string;
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
  'update:notes': [string];
  'update:displayName': [string];
}>();

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
  if (!q) { showDsoSuggest.value = false; return; }
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
  emit('update:dsoIds', props.dsoIds.filter(d => d !== id));
}

function hideDsoSuggest() {
  setTimeout(() => { showDsoSuggest.value = false; }, 150);
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
  setTimeout(() => { showLabelSuggest.value = false; }, 150);
}

function removeLabel(lbl: string) {
  emit('update:labels', props.labels.filter(l => l !== lbl));
}

// ─── Integration rows ─────────────────────────────────────────────────────────
function onFramesInput(idx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (!raw) {
    const updated = props.integrations.map((r, i) => i === idx ? { ...r, frames: 0 } : r);
    emit('update:integrations', updated);
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    showToast({ message: t('errors.invalidIntegrationNumber'), type: 'error', duration: 4000 });
    return;
  }
  const updated = props.integrations.map((r, i) => i === idx ? { ...r, frames: parsed } : r);
  emit('update:integrations', updated);
}

function onSecondsInput(idx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (!raw) {
    const updated = props.integrations.map((r, i) => i === idx ? { ...r, seconds: 0 } : r);
    emit('update:integrations', updated);
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    showToast({ message: t('errors.invalidIntegrationNumber'), type: 'error', duration: 4000 });
    return;
  }
  const updated = props.integrations.map((r, i) => i === idx ? { ...r, seconds: parsed } : r);
  emit('update:integrations', updated);
}

function onFilterSelect(idx: number, v: string) {
  const updated = props.integrations.map((r, i) => i === idx ? { ...r, filter: v } : r);
  emit('update:integrations', updated);
}

function onFilterCommit(v: string) {
  if (v) {
    const key = normalizeIntegrationFilterKey(v);
    if (!props.knownFilterMap.has(key)) props.knownFilterMap.set(key, v.trim());
  }
}

function removeIntegrationRow(idx: number) {
  emit('update:integrations', props.integrations.filter((_, i) => i !== idx));
}

function addIntegrationRow() {
  emit('update:integrations', [...props.integrations, { frames: 0, seconds: 0, filter: '' }]);
}
</script>
