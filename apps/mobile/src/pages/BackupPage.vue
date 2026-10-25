<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { replaceUserOverrides } from '@myastrosky/core/catalog/dso-registry';
import {
  buildExportOptions,
  buildImportOptions,
  canExport,
  canImport,
  selectedPhotoBytes,
  SETUP_CHOICES,
  setupChoiceMissing,
  setupChoiceUnticks,
  setupLocked,
  setupNeedsChoice,
  setupTicked,
  type ExportFlags,
  type ImportSelection,
} from '@myastrosky/core/backup-selection';
import type { SetupImportChoice } from '@myastrosky/core/domain/backup';
import {
  exportData,
  getDsoOverrides,
  getPhotos,
  importData,
  importPreview,
  type ImportPreviewResult,
} from '@myastrosky/app-state/api';
import { showInfo } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { BACKUP_FILE_TYPES, pickFile } from '../platform-device';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneRadioGroup from '../components/PhoneRadioGroup.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import caretIcon from '../icons/chevron-down.svg?raw';

// The board "Réglages, exporter et importer". Keyboard shortcuts are not offered on the phone.
const { showError } = useErrorToast();

// ── Export ──────────────────────────────────────────────────────────────────────────────────────

const flags = reactive<ExportFlags>({
  dsoOverrides: false,
  customGear: false,
  setups: true,
  poiCategories: false,
  skyRegions: false,
  plans: true,
  shortcuts: false,
});
const EXPORT_ROWS: { flag: keyof ExportFlags; label: string }[] = [
  { flag: 'dsoOverrides', label: 'settings.exportDsoOverrides' },
  { flag: 'customGear', label: 'settings.exportCustomGear' },
  { flag: 'setups', label: 'settings.exportSetups' },
  { flag: 'poiCategories', label: 'settings.exportPoiCategories' },
  { flag: 'skyRegions', label: 'settings.exportSkyRegions' },
  { flag: 'plans', label: 'settings.exportPlans' },
];

// Every photo is exported: choosing some of them has no board yet.
const photos = ref<{ id: string; fileSize?: number | null }[]>([]);
const photoIds = computed(() => new Set(photos.value.map((p) => p.id)));
const exporting = ref(false);

// Read each time the page is shown: photos may have been added or deleted since it was last open.
async function loadPhotos() {
  try {
    photos.value = await getPhotos();
  } catch (error) {
    void showError(error);
  }
}
onMounted(loadPhotos);
onIonViewWillEnter(loadPhotos);

const sizeLabel = computed(() =>
  t('settings.exportEstimatedSize', {
    size: formatBytes(selectedPhotoBytes(photos.value, photoIds.value)),
  }),
);

async function createBackup() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const ids = [...photoIds.value];
    await exportData(buildExportOptions(flags, ids.length), ids);
  } catch (error) {
    void showError(error);
  } finally {
    exporting.value = false;
  }
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────

const file = ref<File | null>(null);
const preview = ref<ImportPreviewResult | null>(null);
/** The chosen file is being read (picked, then previewed). */
const reading = ref(false);
const importing = ref(false);
const setupChoices = reactive<Record<string, SetupImportChoice>>({});
const sel = reactive({
  importDso: true,
  importPoiCategories: true,
  importSkyRegions: true,
  images: new Set<string>(),
  plans: new Set<string>(),
  setups: new Set<string>(),
  gear: new Set<string>(),
});

function selection(): ImportSelection {
  return { ...sel, importShortcuts: false, setupChoices };
}

function clearSetupChoices() {
  for (const k of Object.keys(setupChoices)) delete setupChoices[k];
}

const canRestore = computed(
  () =>
    !!preview.value &&
    !importing.value &&
    !reading.value &&
    canImport(preview.value, selection()) &&
    !setupChoiceMissing(preview.value, selection()),
);

const setupOptions = computed(() =>
  SETUP_CHOICES.map((c) => ({ value: c.value, label: t(c.label) })),
);

/** A setup imported while differing from a local one is told what to do (nothing is chosen at first). */
function needsChoice(id: string): boolean {
  const p = preview.value;
  const s = p?.setups.find((x) => x.id === id);
  return !!p && !!s && setupNeedsChoice(p, sel, s);
}

function chooseSetup(id: string, choice: SetupImportChoice | undefined) {
  const p = preview.value;
  const s = p?.setups.find((x) => x.id === id);
  if (!p || !s || !choice) return;
  // "Do not import" on a setup no ticked plan needs is the same as unticking it.
  if (setupChoiceUnticks(p, sel.plans, s, choice)) {
    toggle('setups', id, false);
    return;
  }
  setupChoices[id] = choice;
}

async function chooseFile() {
  if (reading.value || importing.value) return;
  reading.value = true;
  try {
    const picked = await pickFile(BACKUP_FILE_TYPES);
    if (!picked) return;
    const result = await importPreview(picked);
    file.value = picked;
    preview.value = result;
    clearSetupChoices();
    // Everything is ticked at first; a setup identical to a local one has nothing to tick.
    sel.importDso = sel.importPoiCategories = sel.importSkyRegions = true;
    sel.images = new Set(result.images.map((i) => i.filename));
    sel.plans = new Set(result.plans.map((p) => p.id));
    sel.setups = new Set(result.setups.filter((s) => s.conflict !== 'identical').map((s) => s.id));
    sel.gear = new Set(result.gear.map((g) => g.id));
  } catch (error) {
    void showError(error);
  } finally {
    reading.value = false;
  }
}

type ListKey = 'images' | 'plans' | 'setups' | 'gear';

function toggle(list: ListKey, id: string, on: boolean) {
  const next = new Set(sel[list]);
  if (on) next.add(id);
  else next.delete(id);
  sel[list] = next;
  if (list === 'setups' && !on) delete setupChoices[id];
}

function allTicked(list: ListKey, ids: string[]) {
  return ids.length > 0 && ids.every((id) => sel[list].has(id));
}

function toggleAll(list: ListKey, ids: string[], on: boolean) {
  sel[list] = on ? new Set(ids) : new Set();
  if (list === 'setups' && !on) clearSetupChoices();
}

interface Section {
  list: ListKey;
  title: string;
  rows: { id: string; title: string; subs: string[]; warn: string[]; locked?: boolean }[];
}

const REPLACE_WARNING = () => t('settings.importReplaceWarning');

const sections = computed<Section[]>(() => {
  const p = preview.value;
  if (!p) return [];
  const out: Section[] = [];
  if (p.images.length)
    out.push({
      list: 'images',
      title: t('settings.importImagesSection', { n: p.images.length }),
      rows: p.images.map((i) => ({
        id: i.filename,
        title: i.originalName,
        subs: [formatBytes(i.size)],
        warn: i.exists ? [REPLACE_WARNING()] : [],
      })),
    });
  if (p.plans.length)
    out.push({
      list: 'plans',
      title: t('settings.importPlansSection', { n: p.plans.length }),
      rows: p.plans.map((x) => ({
        id: x.id,
        title: x.name,
        subs: [],
        warn: x.exists ? [REPLACE_WARNING()] : [],
      })),
    });
  if (p.setups.length)
    out.push({
      list: 'setups',
      title: t('settings.importSetupsSection', { n: p.setups.length }),
      rows: p.setups.map((s) => ({
        id: s.id,
        title: s.name,
        subs: s.conflict === 'identical' ? [t('settings.importSetupIdentical')] : [],
        warn: s.conflict === 'different' && !setupChoices[s.id] ? [REPLACE_WARNING()] : [],
        locked: s.conflict === 'identical' || setupLocked(p, sel.plans, s),
      })),
    });
  if (p.gear.length)
    out.push({
      list: 'gear',
      title: t('settings.importGearSection', { n: p.gear.length }),
      rows: p.gear.map((g) => ({
        id: g.id,
        title: g.name,
        subs: [],
        warn: g.exists ? [REPLACE_WARNING()] : [],
      })),
    });
  return out;
});

function ticked(section: Section, id: string): boolean {
  const p = preview.value!;
  if (section.list === 'setups') {
    const s = p.setups.find((x) => x.id === id)!;
    return setupTicked(p, sel, s);
  }
  return sel[section.list].has(id);
}

/** The ids "Tout sélectionner" acts on: the setups identical to a local one are never ticked. */
function selectableIds(section: Section): string[] {
  return section.rows
    .filter((r) => section.list !== 'setups' || r.subs.length === 0)
    .map((r) => r.id);
}

async function restore() {
  const p = preview.value;
  if (!p || !file.value || !canRestore.value) return;
  importing.value = true;
  try {
    const result = await importData(file.value, buildImportOptions(p, selection()));
    const lines = [t('settings.importSuccess', { n: result.imported, s: result.skipped })];
    if (result.dsoOverridesImported) {
      lines.push(t('settings.importedDsoOverrides', { n: result.dsoOverridesImported }));
      try {
        replaceUserOverrides(await getDsoOverrides());
      } catch {
        /* the overrides are read again at the next start */
      }
    }
    if (result.failed?.length) {
      lines.push(
        t('settings.importFailedItems', { names: result.failed.map((f) => f.name).join(', ') }),
      );
    }
    file.value = null;
    preview.value = null;
    clearSetupChoices();
    photos.value = await getPhotos().catch(() => photos.value);
    await showInfo(t('settings.importTitle'), lines.join('\n'));
  } catch (error) {
    void showError(error);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.settings.exportImport') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhoneSectionHeader>{{ t('mobile.backup.exportSection') }}</PhoneSectionHeader>
        <div class="mob-form-row mob-form-row--title">
          <span class="mob-form-label m-secondary">{{ t('settings.exportOptions') }}</span>
        </div>
        <IonList class="mob-list" lines="none">
          <PhoneCheckRow
            v-for="row in EXPORT_ROWS"
            :key="row.flag"
            v-model="flags[row.flag]"
            :title="t(row.label)"
          />
        </IonList>
        <div class="mob-section-gap-sm"></div>
        <!-- Choosing which photos to export has no board yet: the field shows the count and does nothing. -->
        <div class="mob-form-row mob-form-row--spaced">
          <PhoneButton
            variant="field"
            text-style="body"
            block
            waiting
            :aria-label="`${t('photos.section')} : ${photos.length} / ${photos.length}`"
          >
            <span class="mob-btn-key">{{ t('photos.section') }}</span>
            <span class="mob-btn-value mob-btn-value--swatch"
              >{{ photos.length }} / {{ photos.length }}</span
            >
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <PhoneHelper>{{ sizeLabel }}</PhoneHelper>
        <div class="mob-form-row">
          <PhoneButton
            variant="confirm"
            size="lg"
            block
            :busy="exporting"
            :disabled="!exporting && !canExport(flags, photos.length)"
            @click="createBackup"
          >
            {{ t('settings.exportBtn') }}
          </PhoneButton>
        </div>

        <PhoneSectionHeader>{{ t('mobile.backup.importSection') }}</PhoneSectionHeader>
        <PhoneHelper class="mob-status--warn">{{ t('settings.importBackupWarning') }}</PhoneHelper>
        <template v-if="file && preview">
          <IonList class="mob-list" lines="none">
            <PhoneRow :title="file.name" />
          </IonList>
          <div class="mob-form-row">
            <PhoneButton block :busy="reading" :disabled="importing" @click="chooseFile">{{
              t('settings.importChangeFile')
            }}</PhoneButton>
          </div>
          <div class="mob-form-row mob-form-row--title">
            <span class="mob-form-label m-secondary">{{ t('settings.importContent') }}</span>
          </div>
          <IonList class="mob-list" lines="none">
            <PhoneCheckRow
              v-if="preview.hasDsoOverrides"
              v-model="sel.importDso"
              :title="t('settings.importDsoOverridesLabel')"
            />
            <PhoneCheckRow
              v-if="preview.hasPoiCategories"
              v-model="sel.importPoiCategories"
              :title="t('settings.importPoiCategoriesLabel')"
            />
            <PhoneCheckRow
              v-if="preview.hasSkyRegions"
              v-model="sel.importSkyRegions"
              :title="t('settings.importSkyRegionsLabel')"
            />
          </IonList>
          <template v-for="section in sections" :key="section.list">
            <PhoneSectionHeader>{{ section.title }}</PhoneSectionHeader>
            <IonList class="mob-list" lines="none">
              <PhoneCheckRow
                :model-value="allTicked(section.list, selectableIds(section))"
                :title="t('settings.importSelectAll')"
                @update:model-value="toggleAll(section.list, selectableIds(section), $event)"
              />
              <template v-for="row in section.rows" :key="row.id">
                <PhoneCheckRow
                  :model-value="ticked(section, row.id)"
                  :title="row.title"
                  :subs="row.subs"
                  :warn="row.warn"
                  :disabled="row.locked"
                  @update:model-value="toggle(section.list, row.id, $event)"
                />
                <PhoneRadioGroup
                  v-if="section.list === 'setups' && needsChoice(row.id)"
                  :label="row.title"
                  :options="setupOptions"
                  :model-value="setupChoices[row.id]"
                  @update:model-value="chooseSetup(row.id, $event)"
                />
              </template>
            </IonList>
          </template>
          <div class="mob-form-row mob-form-row--restore">
            <PhoneButton
              variant="confirm"
              size="lg"
              block
              :busy="importing"
              :disabled="!importing && !canRestore"
              @click="restore"
            >
              {{ t('settings.importData') }}
            </PhoneButton>
          </div>
        </template>
        <!-- Before a file is chosen the board shows nothing but the warning; this button is the desktop's own. -->
        <div v-else class="mob-form-row">
          <PhoneButton block :busy="reading" @click="chooseFile">{{
            t('settings.importChooseFile')
          }}</PhoneButton>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
