<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { sortGalleryPhotos } from '@myastrosky/core/gallery-filter';
import {
  buildExportOptions,
  canExport,
  selectedPhotoBytes,
  type ExportFlags,
} from '@myastrosky/core/backup-selection';
import type { Photo } from '@myastrosky/core/types';
import { exportData, getPhotos } from '@myastrosky/app-state/api';
import { useErrorToast } from '../composables/useErrorToast';
import { useRestore } from '../composables/useRestore';
import { gallerySort } from '../gallery-display';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import caretIcon from '../icons/chevron-down.svg?raw';

// The board "Réglages, exporter et importer". Keyboard shortcuts are not offered on the phone. The Photos field opens
// the sheet "Réglages, photos à sauvegarder"; "Choisir un fichier" reads a backup and opens the restore screen.
const router = useRouter();
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

// Every photo is ticked at first, and so is each photo added since; the photos list in the gallery's order.
const photos = ref<Photo[]>([]);
const sortedPhotos = computed(() => sortGalleryPhotos(photos.value, gallerySort.value));
const selected = ref(new Set<string>());
const seen = new Set<string>();
const photosOpen = ref(false);
const exporting = ref(false);

// Read each time the page is shown: photos may have been added or deleted since it was last open.
async function loadPhotos() {
  try {
    const list = await getPhotos();
    const ids = new Set(list.map((p) => p.id));
    const next = new Set([...selected.value].filter((id) => ids.has(id)));
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      next.add(id);
    }
    photos.value = list;
    selected.value = next;
  } catch (error) {
    void showError(error);
  }
}
onMounted(loadPhotos);
onIonViewWillEnter(loadPhotos);

const sizeLabel = computed(() =>
  t('settings.exportEstimatedSize', {
    size: formatBytes(selectedPhotoBytes(photos.value, selected.value)),
  }),
);
const allPhotosTicked = computed(
  () => photos.value.length > 0 && photos.value.every((p) => selected.value.has(p.id)),
);

function tickPhoto(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}
function tickAllPhotos(on: boolean) {
  selected.value = new Set(on ? photos.value.map((p) => p.id) : []);
}

async function createBackup() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const ids = sortedPhotos.value.filter((p) => selected.value.has(p.id)).map((p) => p.id);
    await exportData(buildExportOptions(flags, ids.length), ids);
  } catch (error) {
    void showError(error);
  } finally {
    exporting.value = false;
  }
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────

const restore = useRestore();
// Back on this page, the restore that was gone through is over: the next one starts from a new file.
onIonViewWillEnter(restore.reset);

async function chooseFile() {
  try {
    if (await restore.chooseFile())
      await router.push(`/settings/backup/restore/${restore.steps.value[0]}`);
  } catch (error) {
    void showError(error);
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
        <div class="mob-form-row mob-form-row--spaced">
          <PhoneButton
            variant="field"
            text-style="body"
            block
            :disabled="!photos.length"
            :aria-label="
              t('mobile.format.labelValue', {
                label: t('photos.section'),
                value: `${selected.size} / ${photos.length}`,
              })
            "
            @click="photosOpen = true"
          >
            <span class="mob-btn-key">{{ t('photos.section') }}</span>
            <span class="mob-btn-value mob-btn-value--swatch"
              >{{ selected.size }} / {{ photos.length }}</span
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
            :disabled="!exporting && !canExport(flags, selected.size)"
            @click="createBackup"
          >
            {{ t('settings.exportBtn') }}
          </PhoneButton>
        </div>

        <PhoneSectionHeader>{{ t('mobile.backup.importSection') }}</PhoneSectionHeader>
        <PhoneHelper class="mob-status--warn">{{ t('settings.importBackupWarning') }}</PhoneHelper>
        <div class="mob-form-row">
          <PhoneButton block :busy="restore.reading.value" @click="chooseFile">{{
            t('settings.importChooseFile')
          }}</PhoneButton>
        </div>
      </div>
    </IonContent>
    <PhoneSheet v-model:open="photosOpen" :title="t('settings.exportSelectTitle')">
      <IonList class="mob-list" lines="none">
        <PhoneCheckRow
          :model-value="allPhotosTicked"
          :title="t('settings.exportSelectAll')"
          @update:model-value="tickAllPhotos($event)"
        />
        <PhoneCheckRow
          v-for="photo in sortedPhotos"
          :key="photo.id"
          :model-value="selected.has(photo.id)"
          :title="photo.originalName"
          :subs="[photo.fileSize ? formatBytes(photo.fileSize) : '—']"
          @update:model-value="tickPhoto(photo.id, $event)"
        />
      </IonList>
    </PhoneSheet>
  </IonPage>
</template>
