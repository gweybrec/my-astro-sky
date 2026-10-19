<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { CAPTURE_FIELDS } from '@myastrosky/core/capture-fields';
import { datetimeLocalToIso, isoToDatetimeLocal } from '@myastrosky/core/datetime-local';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import {
  draftFromPhoto,
  draftToMetadata,
  filterLabelCandidates,
  isDraftDirty,
  type PhotoMetadataDraft,
} from '@myastrosky/core/photo-metadata-draft';
import { resolveCategory } from '@myastrosky/core/poi';
import { searchDSOs } from '@myastrosky/core/search';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import type { Photo } from '@myastrosky/core/types';
import {
  getGearSetups,
  getPhotos,
  updatePhotoMetadata,
  type GearSetupData,
} from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { poiTypeIcon } from '../poi-icons';
import AppIcon from '../components/AppIcon.vue';
import PhoneAddRow from '../components/PhoneAddRow.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneNativePicker from '../components/PhoneNativePicker.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import PhoneRemoveChips from '../components/PhoneRemoveChips.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneTextArea from '../components/PhoneTextArea.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import asteroidIcon from '@icons/poi-asteroid.svg?raw';
import cometIcon from '@icons/poi-comet.svg?raw';
import supernovaIcon from '@icons/poi-supernova.svg?raw';

// The board "Photo, modifier les infos": the form of a photo's metadata, with what the desktop's editor does
// (`MetadataEditorPanel.vue`): nothing is saved before Enregistrer, and leaving with changes asks first. Adding a
// point of interest, the three identifications and reading a WCS file wait for their screens.
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const categoriesStore = usePoiCategoriesStore();

const photo = ref<Photo | null>(null);
const original = ref<PhotoMetadataDraft | null>(null);
const draft = reactive<PhotoMetadataDraft>({
  displayName: '',
  dsoIds: [],
  labels: [],
  pointsOfInterest: [],
  integrations: [],
  observationDate: '',
  captureDetails: {},
  gearSetupId: null,
  notes: '',
});
// The objects' chips, the most important catalogue first (Messier, NGC, IC, …); the list itself keeps its order.
const sortedDsoIds = computed(() => sortDsoIdsByImportance(draft.dsoIds));
const knownLabels = ref<string[]>([]);
const setups = ref<GearSetupData[]>([]);
const saving = ref(false);
/** The page is being left on purpose (saved, or the changes given up): nothing asks again. */
let leaving = false;

const fallback = computed(() => `/gallery/photo/${String(route.params.id)}`);

onMounted(async () => {
  try {
    const photos = await getPhotos();
    const found = photos.find((p) => p.id === route.params.id);
    if (!found) {
      void router.replace('/tabs/gallery');
      return;
    }
    Object.assign(draft, draftFromPhoto(found));
    original.value = draftFromPhoto(found);
    photo.value = found;
    knownLabels.value = [...new Set(photos.flatMap((p) => p.labels))];
    setups.value = await getGearSetups();
    void categoriesStore.ensureLoaded();
    // The objects' search needs the catalogues; until they are read it finds nothing.
    catalogsReady().catch(() => undefined);
  } catch (error) {
    void showError(error);
  }
});

const dirty = computed(() => original.value !== null && isDraftDirty(draft, original.value));
/** The desktop's texts start with a "+" that the board draws as an icon. */
const withoutPlus = (text: string) => text.replace(/^\+\s*/, '');

// ── Objects ───────────────────────────────────────────────────────────────────────────────────────

const dsoQuery = ref('');
const dsoResults = ref<{ id: string; title: string }[]>([]);
let dsoTimer: ReturnType<typeof setTimeout> | undefined;
watch(dsoQuery, (text) => {
  clearTimeout(dsoTimer);
  const q = text.trim();
  if (!q) {
    dsoResults.value = [];
    return;
  }
  dsoTimer = setTimeout(() => {
    dsoResults.value = searchDSOs(q, 8).map(({ dso }) => ({
      id: dso.id,
      title: dso.displayName ? `${dso.id} — ${dso.displayName}` : dso.id,
    }));
  }, 200);
});

function addDso(id: string) {
  if (id && !draft.dsoIds.includes(id)) draft.dsoIds.push(id);
  dsoQuery.value = '';
}
const addTypedDso = () => addDso(dsoQuery.value.trim().replace(/\s+/g, ''));

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────

const labelInput = ref('');
const labelSuggestions = computed(() =>
  labelInput.value.trim()
    ? filterLabelCandidates(knownLabels.value, draft.labels, labelInput.value)
    : [],
);

function addLabel(text: string) {
  const label = text.trim();
  if (label && !draft.labels.includes(label)) {
    draft.labels.push(label);
    if (!knownLabels.value.includes(label)) knownLabels.value.push(label);
  }
  labelInput.value = '';
}

// ── Points of interest ────────────────────────────────────────────────────────────────────────────

const isSolved = computed(() => !!photo.value && computePhotoToProjMatrix(photo.value) !== null);
const poiChips = computed(() =>
  draft.pointsOfInterest.map((poi) => ({
    label: poi.name,
    icon: poiTypeIcon(poi.categoryId),
    color: resolveCategory(poi.categoryId, categoriesStore.categories).color,
  })),
);

// ── Integration ───────────────────────────────────────────────────────────────────────────────────

const shown = (n: number) => (n >= 1 ? String(n) : '');

function setCount(index: number, key: 'frames' | 'seconds', text: string) {
  const raw = text.trim();
  if (!raw) {
    draft.integrations[index][key] = 0;
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    void showError(new Error(t('errors.invalidIntegrationNumber')));
    return;
  }
  draft.integrations[index][key] = parsed;
}

const rowTotal = (row: { frames: number; seconds: number }) =>
  row.frames >= 1 && row.seconds >= 1
    ? `= ${formatIntegrationTotal(row.frames * row.seconds)}`
    : '';

// ── Date and equipment ────────────────────────────────────────────────────────────────────────────

const datePicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const dateLocal = computed(() => isoToDatetimeLocal(draft.observationDate));

const setupOpen = ref(false);
const setupChoice = computed({
  get: () => draft.gearSetupId ?? '',
  set: (id: string | undefined) => {
    draft.gearSetupId = id || null;
    setupOpen.value = false;
  },
});
const setupOptions = computed(() => [
  { value: '', label: t('modal.metadataGearSetupNone') },
  ...setups.value.map((s) => ({ value: s.id, label: s.name || s.id })),
]);
const setupName = computed(
  () => setupOptions.value.find((o) => o.value === setupChoice.value)?.label ?? '',
);

// ── Capture details ───────────────────────────────────────────────────────────────────────────────
// A field's row shows only when its id is in the details; the list offers the others, in the catalog's order.

const has = (id: string) => Object.prototype.hasOwnProperty.call(draft.captureDetails, id);
const presentFields = computed(() => CAPTURE_FIELDS.filter((f) => has(f.id)));
const addableFields = computed(() => CAPTURE_FIELDS.filter((f) => !has(f.id)));
const fieldToAdd = ref<string | undefined>(undefined);
const fieldListOpen = ref(false);
const fieldChoice = computed({
  get: () => fieldToAdd.value,
  set: (id: string | undefined) => {
    fieldToAdd.value = id;
    fieldListOpen.value = false;
  },
});
const fieldOptions = computed(() =>
  addableFields.value.map((f) => ({ value: f.id, label: t(f.labelKey) })),
);
const fieldToAddName = computed(
  () =>
    fieldOptions.value.find((o) => o.value === fieldToAdd.value)?.label ??
    t('modal.metadataCaptureAddPlaceholder'),
);

function setCapture(id: string, text: string) {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  // The key stays (as '') while the field is empty, so that its row stays; saving drops it.
  let value: number | string = text;
  if (field?.type === 'number') {
    value = text.trim() === '' ? '' : Number(text);
    if (typeof value === 'number' && !Number.isFinite(value)) return;
  }
  draft.captureDetails = { ...draft.captureDetails, [id]: value };
}

function removeCapture(id: string) {
  const next = { ...draft.captureDetails };
  delete next[id];
  draft.captureDetails = next;
}

function addCapture() {
  const id = fieldToAdd.value;
  if (!id || has(id)) return;
  draft.captureDetails = { ...draft.captureDetails, [id]: '' };
  fieldToAdd.value = undefined;
}

// ── Leaving and saving ────────────────────────────────────────────────────────────────────────────

function goBack() {
  leaving = true;
  if (window.history.state?.back) router.back();
  else void router.replace(fallback.value);
}

/** As the desktop: leaving with changes that are not saved asks first. */
async function mayLeave(): Promise<boolean> {
  if (leaving || !dirty.value) return true;
  return confirm({
    title: t('gallery.metadataTitle'),
    message: t('gallery.unsavedChanges'),
    confirmLabel: t('gallery.closeWithoutSaving'),
    destructive: true,
  });
}

async function cancel() {
  if (await mayLeave()) goBack();
}
useBackClose(
  () => !leaving && dirty.value,
  () => void cancel(),
);

async function save() {
  if (!photo.value || saving.value) return;
  saving.value = true;
  try {
    await updatePhotoMetadata(photo.value.id, draftToMetadata(draft, photo.value.originalName));
    goBack();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="fallback" :before="mayLeave" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('gallery.metadataTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="photo" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhoneSectionHeader>{{ t('modal.metadataFilename') }}</PhoneSectionHeader>
        <PhoneField v-model="draft.displayName" :aria-label="t('modal.metadataFilename')" />

        <PhoneSectionHeader>{{ t('modal.metadataDsos') }}</PhoneSectionHeader>
        <PhoneRemoveChips
          :items="sortedDsoIds.map((id) => ({ label: id }))"
          @remove="draft.dsoIds.splice(draft.dsoIds.indexOf(sortedDsoIds[$event]), 1)"
        />
        <PhoneAddRow
          v-model="dsoQuery"
          :placeholder="t('modal.metadataDsosPlaceholder')"
          :aria-label="t('modal.metadataDsosPlaceholder')"
          @add="addTypedDso"
        />
        <IonList v-if="dsoResults.length" class="mob-list" lines="none">
          <PhoneRow
            v-for="r in dsoResults"
            :key="r.id"
            :title="r.title"
            button
            @click="addDso(r.id)"
          />
        </IonList>

        <PhoneSectionHeader>{{ t('modal.metadataLabels') }}</PhoneSectionHeader>
        <PhoneRemoveChips
          :items="draft.labels.map((label) => ({ label }))"
          @remove="draft.labels.splice($event, 1)"
        />
        <PhoneAddRow
          v-model="labelInput"
          :placeholder="t('modal.metadataLabelsPlaceholder')"
          :aria-label="t('modal.metadataLabelsPlaceholder')"
          @add="addLabel(labelInput)"
        />
        <IonList v-if="labelSuggestions.length" class="mob-list" lines="none">
          <PhoneRow
            v-for="label in labelSuggestions"
            :key="label"
            :title="label"
            button
            @click="addLabel(label)"
          />
        </IonList>

        <PhoneSectionHeader>{{ t('modal.metadataPoi') }}</PhoneSectionHeader>
        <PhoneRemoveChips :items="poiChips" @remove="draft.pointsOfInterest.splice($event, 1)" />
        <!-- Adding a point of interest and the identifications have their own screens, built next: the rows show and do nothing. -->
        <IonList class="mob-list" lines="none">
          <PhoneRow :title="withoutPlus(t('poi.addPoi'))" :lead="plusIcon" inert />
          <template v-if="isSolved">
            <PhoneRow :title="t('asteroid.menuLabel')" :lead="asteroidIcon" inert />
            <PhoneRow :title="t('supernova.menuLabel')" :lead="supernovaIcon" inert />
            <PhoneRow :title="t('comet.menuLabel')" :lead="cometIcon" inert />
          </template>
        </IonList>

        <PhoneSectionHeader>{{ t('modal.metadataIntegrations') }}</PhoneSectionHeader>
        <div v-for="(row, index) in draft.integrations" :key="index" class="mob-integration">
          <PhoneField
            v-model="row.filter"
            bare
            class="mob-integration-filter"
            :label="t('targets.plan.obsWindowFilter')"
            :placeholder="t('modal.metadataIntegrationsFilterPlaceholder')"
          />
          <PhoneField
            bare
            inputmode="numeric"
            :model-value="shown(row.frames)"
            :aria-label="t('modal.metadataIntegrationsFramesTooltip')"
            @update:model-value="setCount(index, 'frames', $event)"
          />
          <span class="mob-integration-unit m-body" aria-hidden="true">×</span>
          <PhoneField
            bare
            inputmode="numeric"
            :model-value="shown(row.seconds)"
            :aria-label="t('modal.metadataIntegrationsSecondsTooltip')"
            @update:model-value="setCount(index, 'seconds', $event)"
          />
          <span class="mob-integration-unit m-body">{{
            t('modal.metadataIntegrationsSecondsSuffix')
          }}</span>
          <span class="mob-integration-total m-mono">{{ rowTotal(row) }}</span>
          <PhoneIconButton
            danger
            :label="t('modal.metadataIntegrationsRemoveRow')"
            @click="draft.integrations.splice(index, 1)"
          >
            <AppIcon :svg="trashIcon" />
          </PhoneIconButton>
        </div>
        <div class="mob-form-row mob-section-gap-sm">
          <PhoneButton
            block
            @click="draft.integrations.push({ frames: 0, seconds: 0, filter: '' })"
          >
            <AppIcon :svg="plusIcon" />{{ withoutPlus(t('modal.metadataIntegrationsAddRow')) }}
          </PhoneButton>
        </div>

        <PhoneSectionHeader>{{ t('modal.metadataObsDate') }}</PhoneSectionHeader>
        <PhoneField
          :model-value="dateLocal.replace('T', ' ')"
          readonly
          :aria-label="t('modal.metadataObsDate')"
          @click="datePicker?.open()"
        />
        <PhoneNativePicker
          ref="datePicker"
          type="datetime-local"
          :value="dateLocal"
          @pick="draft.observationDate = datetimeLocalToIso($event)"
          @clear="draft.observationDate = ''"
        />

        <PhoneSectionHeader>{{ t('modal.metadataGearSetup') }}</PhoneSectionHeader>
        <div class="mob-form-row">
          <PhoneButton
            variant="field"
            text-style="body"
            block
            :aria-label="`${t('modal.metadataGearSetup')} : ${setupName}`"
            @click="setupOpen = true"
          >
            <span class="mob-btn-label">{{ setupName }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>

        <PhoneSectionHeader>{{ t('modal.metadataCapture') }}</PhoneSectionHeader>
        <div v-for="f in presentFields" :key="f.id" class="mob-field-row">
          <label class="m-secondary">{{ t(f.labelKey) }}</label>
          <PhoneField
            bare
            :inputmode="f.type === 'number' ? 'decimal' : 'text'"
            :model-value="String(draft.captureDetails[f.id] ?? '')"
            :aria-label="t(f.labelKey)"
            @update:model-value="setCapture(f.id, $event)"
          />
          <span class="mob-integration-unit m-body">{{ f.unit }}</span>
          <PhoneIconButton
            danger
            :label="`${t('modal.metadataCaptureRemove')} ${t(f.labelKey)}`"
            @click="removeCapture(f.id)"
          >
            <AppIcon :svg="trashIcon" />
          </PhoneIconButton>
        </div>
        <PhoneAddRow :disabled="!fieldToAdd" @add="addCapture">
          <PhoneButton
            variant="field"
            text-style="body"
            :disabled="addableFields.length === 0"
            :aria-label="t('modal.metadataCaptureAddPlaceholder')"
            @click="fieldListOpen = true"
          >
            <span class="mob-btn-label">{{ fieldToAddName }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </PhoneAddRow>

        <PhoneSectionHeader>{{ t('modal.metadataNotes') }}</PhoneSectionHeader>
        <PhoneTextArea
          v-model="draft.notes"
          :label="t('modal.metadataNotes')"
          :placeholder="t('modal.metadataNotesPlaceholder')"
        />

        <!-- Reading a WCS file needs a message the boards do not draw yet: the button shows and does nothing. -->
        <div class="mob-form-row mob-section-gap">
          <PhoneButton block waiting>{{ t('gallery.loadFromWcs') }}</PhoneButton>
        </div>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg" @click="cancel">{{ t('gallery.cancelEdit') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!photo || saving" @click="save">
        {{ t('gallery.saveMetadata') }}
      </PhoneButton>
    </PhoneFooter>

    <PhoneRadioSheet
      v-model:open="setupOpen"
      v-model:value="setupChoice"
      :title="t('modal.metadataGearSetup')"
      :options="setupOptions"
    />
    <PhoneRadioSheet
      v-model:open="fieldListOpen"
      v-model:value="fieldChoice"
      :title="t('modal.metadataCaptureAddPlaceholder')"
      :options="fieldOptions"
    />
  </IonPage>
</template>
