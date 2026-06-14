<template>
  <div class="modal-backdrop">
    <div class="modal settings-modal--flex" @click.stop>
      <div class="modal-header">
        <h2>{{ t('settings.exportSelectTitle') }}</h2>
        <button class="modal-close" @click="onClose">&times;</button>
      </div>
      <div class="modal-body modal-form-body--scroll">
        <div class="export-options-label">{{ t('settings.exportOptions') }}</div>

        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includeMeta" @change="update" />
          {{ t('settings.exportPhotoMeta') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includeDso" @change="update" />
          {{ t('settings.exportDsoOverrides') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includeGear" @change="update" />
          {{ t('settings.exportCustomGear') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includeSetups" @change="update" />
          {{ t('settings.exportSetups') }}
        </label>
        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includePlans" @change="update" />
          {{ t('settings.exportPlans') }}
        </label>

        <div class="modal-divider"></div>

        <div v-if="photos.length > 0" class="export-photo-section">
          <label class="export-select-all-row">
            <input
              type="checkbox"
                           :checked="allChecked"
              :indeterminate.prop="someChecked && !allChecked"
              @change="toggleAll"
            />
            <span class="export-select-all-label">{{ t('settings.exportSelectAll') }}</span>
          </label>
          <div class="export-scroll-list">
            <label v-for="photo in photos" :key="photo.id" class="export-photo-row">
              <input
                type="checkbox"
                               :checked="selected.has(photo.id)"
                @change="togglePhoto(photo.id)"
              />
              <span class="text-ellipsis">{{ photo.originalName }}</span>
              <span class="text-dim-xs">{{ photo.fileSize ? formatBytes(photo.fileSize) : '—' }}</span>
            </label>
          </div>
        </div>

        <div v-if="sizeLabel" class="export-size-info">{{ sizeLabel }}</div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" :disabled="busy" @click="onClose">
          {{ t('modal.cancel') }}
        </button>
        <button
          class="btn-confirm"
          :disabled="!canExport || busy"
          @click="onExport"
        >{{ busy ? '…' : t('settings.exportConfirm') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { t } from '../../i18n';
import { usePhotosStore } from '../../stores/photos';
import { exportData } from '../../api';
import type { ExportOptions } from '../../api';
import { showToast } from '../../toast';
import { formatBytes } from '../../format-utils';

const emit = defineEmits<{ close: [] }>();

const photosStore = usePhotosStore();
const photos = computed(() => photosStore.placedPhotos.map(p => p.photo));

const includeMeta = ref(true);
const includeDso = ref(false);
const includeGear = ref(false);
const includeSetups = ref(false);
const includePlans = ref(false);
const busy = ref(false);

const selected = reactive(new Set<string>());

// Init: select all photos
photosStore.placedPhotos.forEach(p => selected.add(p.photo.id));

const allChecked = computed(() => photos.value.length > 0 && photos.value.every(p => selected.has(p.id)));
const someChecked = computed(() => photos.value.some(p => selected.has(p.id)));

const totalBytes = computed(() =>
  photos.value
    .filter(p => selected.has(p.id))
    .reduce((s, p) => s + (p.fileSize ?? 0), 0),
);

const sizeLabel = computed(() => {
  if (!someChecked.value) return '';
  return t('settings.exportEstimatedSize').replace('{size}', formatBytes(totalBytes.value));
});

const canExport = computed(() =>
  includeDso.value || includeMeta.value || includeGear.value ||
  includeSetups.value || includePlans.value || someChecked.value,
);

function update() { /* reactivity via v-model */ }

function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) photos.value.forEach(p => selected.add(p.id));
  else selected.clear();
}

function togglePhoto(id: string) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
}

function onClose() {
  if (!busy.value) emit('close');
}

async function onExport() {
  const selectedIds = photos.value.filter(p => selected.has(p.id)).map(p => p.id);
  const options: ExportOptions = {
    includeImages: selectedIds.length > 0,
    includeMetadata: includeMeta.value,
    includeDsoOverrides: includeDso.value,
    includeCustomGear: includeGear.value,
    includeSetups: includeSetups.value,
    includePlans: includePlans.value,
  };
  busy.value = true;
  try {
    await exportData(options, selectedIds);
    emit('close');
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
    busy.value = false;
  }
}
</script>
