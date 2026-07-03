<template>
  <div class="modal-backdrop">
    <div class="modal settings-modal--flex" @click.stop>
      <div class="modal-header">
        <h2>{{ t('settings.deleteModalTitle') }}</h2>
        <button class="modal-close" @click="onClose">&times;</button>
      </div>
      <div class="modal-body modal-form-body--scroll">
        <div class="import-backup-section">
          <div class="import-backup-warning">⚠ {{ t('settings.deleteBackupWarning') }}</div>
          <button
            class="display-controls-btn self-start text-small"
            :disabled="!hasPhotos || backingUp"
            @click="doBackup"
          >
            {{ t('settings.importBackupBtn') }}
          </button>
        </div>

        <div class="modal-divider"></div>

        <label class="export-checkbox-row">
          <input type="checkbox" class="checkbox-danger" v-model="deleteMeta" />
          {{ t('settings.deletePhotoMeta') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" class="checkbox-danger" v-model="deleteDso" />
          {{ t('settings.deleteDsoOverrides') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" class="checkbox-danger" v-model="deleteGear" />
          {{ t('settings.deleteCustomGear') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" class="checkbox-danger" v-model="deleteSetups" />
          {{ t('settings.deleteGearSetups') }}
        </label>

        <div class="modal-divider"></div>

        <div class="export-options-label">{{ t('settings.deletePhotosSection') }}</div>
        <div v-if="photos.length > 0" class="export-photo-section">
          <label class="export-select-all-row">
            <input
              type="checkbox"
              class="checkbox-danger"
              :checked="allPhotoChecked"
              :indeterminate.prop="somePhotoChecked && !allPhotoChecked"
              @change="toggleAll"
            />
            <span class="export-select-all-label">{{ t('settings.deleteSelectAll') }}</span>
          </label>
          <div class="export-scroll-list">
            <label v-for="photo in photos" :key="photo.id" class="export-photo-row">
              <input
                type="checkbox"
                class="checkbox-danger"
                :checked="selectedPhotos.has(photo.id)"
                @change="togglePhoto(photo.id)"
              />
              <span class="text-ellipsis">{{ photo.originalName }}</span>
              <span class="text-dim-xs">{{
                photo.fileSize ? formatBytes(photo.fileSize) : '—'
              }}</span>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="display-controls-btn" :disabled="busy" @click="onClose">
          {{ t('modal.cancel') }}
        </button>
        <button class="btn-danger" :disabled="!canDelete || busy" @click="onDelete">
          {{ t('settings.deleteAction') }}
        </button>
      </div>
    </div>
  </div>

  <BulkDeleteConfirmDialog
    v-if="confirmStep"
    :summaryLines="confirmStep.lines"
    @confirm="onConfirmed"
    @cancel="confirmStep = null"
  />
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { t } from '../../i18n';
import { usePhotosStore } from '../../stores/photos';
import { useCanvasStore } from '../../stores/canvas';
import {
  exportData,
  deleteBulkPhotos,
  deleteAllPhotoMetadata,
  deleteAllDsoOverrides,
  deleteAllCustomGear,
  deleteAllGearSetupsAPI,
} from '../../api';
import { reloadUserOverrides } from '../../dso-catalog';
import { buildDeleteSummaryLines } from '../../delete-utils';
import { showToast } from '../../toast';
import { formatBytes } from '../../format-utils';
import BulkDeleteConfirmDialog from './BulkDeleteConfirmDialog.vue';

const emit = defineEmits<{ close: [] }>();

const photosStore = usePhotosStore();
const canvasStore = useCanvasStore();

const photos = computed(() => photosStore.placedPhotos.map((p) => p.photo));
const hasPhotos = computed(() => photos.value.length > 0);

const deleteMeta = ref(false);
const deleteDso = ref(false);
const deleteGear = ref(false);
const deleteSetups = ref(false);
const busy = ref(false);
const backingUp = ref(false);

const selectedPhotos = reactive(new Set<string>());

const allPhotoChecked = computed(
  () => photos.value.length > 0 && photos.value.every((p) => selectedPhotos.has(p.id)),
);
const somePhotoChecked = computed(() => photos.value.some((p) => selectedPhotos.has(p.id)));

const canDelete = computed(
  () =>
    deleteMeta.value ||
    deleteDso.value ||
    deleteGear.value ||
    deleteSetups.value ||
    somePhotoChecked.value,
);

type ConfirmStep = { lines: string[] };
const confirmStep = ref<ConfirmStep | null>(null);

function onClose() {
  if (!busy.value) emit('close');
}

function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) photos.value.forEach((p) => selectedPhotos.add(p.id));
  else selectedPhotos.clear();
}

function togglePhoto(id: string) {
  if (selectedPhotos.has(id)) selectedPhotos.delete(id);
  else selectedPhotos.add(id);
}

async function doBackup() {
  backingUp.value = true;
  const ids = photos.value.map((p) => p.id);
  try {
    await exportData({ includeImages: true, includeMetadata: true }, ids);
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
  } finally {
    backingUp.value = false;
  }
}

function onDelete() {
  const selectedPhotoIds = photos.value.filter((p) => selectedPhotos.has(p.id)).map((p) => p.id);
  const lines = buildDeleteSummaryLines(
    {
      photoMetadata: deleteMeta.value,
      dsoOverrides: deleteDso.value,
      customGear: deleteGear.value,
      gearSetups: deleteSetups.value,
      photoIds: selectedPhotoIds,
      totalPhotos: photos.value.length,
    },
    t,
  );
  confirmStep.value = { lines };
}

async function onConfirmed() {
  confirmStep.value = null;
  busy.value = true;
  const selectedPhotoIds = photos.value.filter((p) => selectedPhotos.has(p.id)).map((p) => p.id);
  try {
    if (deleteMeta.value) {
      await deleteAllPhotoMetadata();
      canvasStore.overlay?.clearAllPhotos();
      canvasStore.gallery?.loadPhotos([]);
    }
    if (selectedPhotoIds.length > 0) {
      await deleteBulkPhotos(selectedPhotoIds);
      canvasStore.overlay?.removePhotosFromMap(selectedPhotoIds);
    }
    if (deleteDso.value) {
      await deleteAllDsoOverrides();
      await reloadUserOverrides().catch(() => {});
    }
    if (deleteGear.value) {
      await deleteAllCustomGear();
    }
    if (deleteSetups.value) {
      await deleteAllGearSetupsAPI();
    }
    emit('close');
    showToast({ message: t('settings.deleteSuccess'), type: 'info' });
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.deleteError'), type: 'error' });
    busy.value = false;
  }
}
</script>
