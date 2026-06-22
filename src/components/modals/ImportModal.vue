<template>
  <div class="modal-backdrop">
    <div class="modal settings-modal--flex" @click.stop>
      <div class="modal-header">
        <h2>{{ t('settings.importTitle') }}</h2>
        <button class="modal-close" @click="onClose">&times;</button>
      </div>

      <!-- Phase 1: pick a file -->
      <div v-if="phase === 'pick'" class="modal-body modal-form-body--loose">
        <label class="display-controls-btn self-start">
          {{ previewBusy ? '…' : t('settings.importChooseFile') }}
          <input type="file" accept=".zip,.json" class="hidden" :disabled="previewBusy" @change="onFilePicked" />
        </label>
        <div class="import-backup-section">
          <div class="import-backup-warning">⚠ {{ t('settings.importBackupWarning') }}</div>
          <button
            class="display-controls-btn self-start text-small"
            :disabled="!hasPhotos || backingUp"
            @click="doBackup"
          >{{ t('settings.importBackupBtn') }}</button>
        </div>
      </div>

      <!-- Phase 2: show detected contents with options -->
      <div v-else-if="phase === 'options' && preview" class="modal-body modal-form-body--scroll">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-small text-secondary flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ fileName }}</span>
          <button class="display-controls-btn text-small shrink-0" @click="resetToPick">{{ t('settings.importChangeFile') }}</button>
        </div>

        <!-- Content checkboxes -->
        <div v-if="preview.hasMetadata || preview.hasDsoOverrides || preview.hasCustomGear || preview.hasSetups || preview.hasPlans || preview.hasShortcuts">
          <div class="export-options-label">{{ t('settings.importContent') }}</div>
          <label v-if="preview.hasMetadata" class="export-checkbox-row">
            <input type="checkbox" v-model="importMeta" />
            {{ t('settings.importPhotoMeta').replace('{n}', String(preview.photos)) }}
          </label>
          <label v-if="preview.hasDsoOverrides" class="export-checkbox-row">
            <input type="checkbox" v-model="importDso" />
            {{ t('settings.importDsoOverridesLabel') }}
          </label>
          <label v-if="preview.hasCustomGear" class="export-checkbox-row">
            <input type="checkbox" v-model="importGear" />
            {{ t('settings.importCustomGearLabel') }}
          </label>
          <label v-if="preview.hasSetups" class="export-checkbox-row">
            <input type="checkbox" v-model="importSetups" />
            {{ t('settings.importSetupsLabel') }}
          </label>
          <label v-if="preview.hasShortcuts" class="export-checkbox-row">
            <input type="checkbox" v-model="importShortcuts" />
            {{ t('settings.importShortcutsLabel') }}
          </label>
          <label v-if="preview.hasPlans" class="export-checkbox-row">
            <input type="checkbox" v-model="importPlans" />
            {{ t('settings.importPlansLabel') }}
          </label>
        </div>

        <!-- Images list -->
        <div v-if="preview.images.length > 0">
          <div class="modal-divider"></div>
          <div class="export-photo-section">
            <label class="export-select-all-row">
              <input
                type="checkbox"
                :checked="allImagesChecked"
                :indeterminate.prop="someImagesChecked && !allImagesChecked"
                @change="toggleAllImages"
              />
              <span class="export-select-all-label">{{ t('settings.importImagesSection').replace('{n}', String(preview.images.length)) }}</span>
            </label>
            <div class="export-scroll-list">
              <label v-for="img in preview.images" :key="img.filename" class="export-photo-row">
                <input
                  type="checkbox"
                    :checked="selectedImages.has(img.filename)"
                  @change="toggleImage(img.filename)"
                />
                <span class="text-ellipsis">{{ img.originalName }}</span>
                <span v-if="img.exists" class="text-dim-xs import-existing-badge">{{ t('settings.importExistingBadge') }}</span>
                <span class="text-dim-xs">{{ formatBytes(img.size) }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" :disabled="importBusy" @click="onClose">
          {{ t('modal.cancel') }}
        </button>
        <button
          v-if="phase === 'options'"
          class="btn-confirm"
          :disabled="!canImport || importBusy"
          @click="onImport"
        >{{ importBusy ? '…' : t('settings.importData') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { t } from '../../i18n';
import { usePhotosStore } from '../../stores/photos';
import { useCanvasStore } from '../../stores/canvas';
import { useShortcutsStore } from '../../stores/shortcuts';
import { importPreview, importData, exportData, getPhotos } from '../../api';
import type { ImportPreviewResult } from '../../api';
import { reloadUserOverrides } from '../../dso-catalog';
import { showToast } from '../../toast';
import { formatBytes } from '../../format-utils';

const emit = defineEmits<{ close: [] }>();

const photosStore = usePhotosStore();
const canvasStore = useCanvasStore();
const shortcutsStore = useShortcutsStore();
const hasPhotos = computed(() => photosStore.placedPhotos.length > 0);

const phase = ref<'pick' | 'options'>('pick');
const fileName = ref('');
const storedFile = ref<File | null>(null);
const preview = ref<ImportPreviewResult | null>(null);
const previewBusy = ref(false);
const importBusy = ref(false);
const backingUp = ref(false);

const importMeta = ref(true);
const importDso = ref(true);
const importGear = ref(true);
const importSetups = ref(true);
const importPlans = ref(true);
const importShortcuts = ref(true);
const selectedImages = reactive(new Set<string>());

const allImagesChecked = computed(() =>
  preview.value !== null &&
  preview.value.images.length > 0 &&
  preview.value.images.every(img => selectedImages.has(img.filename))
);
const someImagesChecked = computed(() =>
  preview.value?.images.some(img => selectedImages.has(img.filename)) ?? false
);

const canImport = computed(() => {
  if (!preview.value) return false;
  const hasContent =
    (preview.value.hasMetadata && importMeta.value) ||
    (preview.value.hasDsoOverrides && importDso.value) ||
    (preview.value.hasCustomGear && importGear.value) ||
    (preview.value.hasSetups && importSetups.value) ||
    (preview.value.hasPlans && importPlans.value) ||
    (preview.value.hasShortcuts && importShortcuts.value);
  const hasImages = someImagesChecked.value;
  return hasContent || hasImages;
});

function onClose() {
  if (!importBusy.value) emit('close');
}

function resetToPick() {
  phase.value = 'pick';
  preview.value = null;
  fileName.value = '';
  storedFile.value = null;
  selectedImages.clear();
}

async function onFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileName.value = file.name;
  storedFile.value = file;
  previewBusy.value = true;
  try {
    const result = await importPreview(file);
    preview.value = result;
    selectedImages.clear();
    result.images.forEach(img => selectedImages.add(img.filename));
    importMeta.value = true;
    importDso.value = true;
    importGear.value = true;
    importSetups.value = true;
    importPlans.value = true;
    importShortcuts.value = true;
    phase.value = 'options';
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
    storedFile.value = null;
  } finally {
    previewBusy.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

function toggleAllImages(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (!preview.value) return;
  if (checked) preview.value.images.forEach(img => selectedImages.add(img.filename));
  else selectedImages.clear();
}

function toggleImage(filename: string) {
  if (selectedImages.has(filename)) selectedImages.delete(filename);
  else selectedImages.add(filename);
}

async function doBackup() {
  backingUp.value = true;
  const ids = photosStore.placedPhotos.map(p => p.photo.id);
  try {
    await exportData({ includeImages: true, includeMetadata: true }, ids);
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
  } finally {
    backingUp.value = false;
  }
}

async function onImport() {
  if (!preview.value || !storedFile.value) return;
  importBusy.value = true;
  try {
    const hasImages = preview.value.images.length > 0;
    const result = await importData(storedFile.value, {
      importMetadata: preview.value.hasMetadata && importMeta.value,
      importDsoOverrides: preview.value.hasDsoOverrides && importDso.value,
      importCustomGear: preview.value.hasCustomGear && importGear.value,
      importSetups: preview.value.hasSetups && importSetups.value,
      importPlans: preview.value.hasPlans && importPlans.value,
      selectedImages: hasImages ? Array.from(selectedImages) : null,
    });
    emit('close');
    const msg = t('settings.importSuccess')
      .replace('{n}', String(result.imported))
      .replace('{s}', String(result.skipped));
    showToast({ message: msg, type: 'info' });

    // Reload photos into overlay and gallery without a full page refresh
    try {
      const photos = await getPhotos();
      const overlay = canvasStore.overlay;
      const skyMap = canvasStore.skyMap;
      const gallery = canvasStore.gallery;
      if (overlay) {
        overlay.loadPhotos(photos);
        if (skyMap) {
          skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
          skyMap.render();
        }
      }
      if (gallery) gallery.loadPhotos(photos);
      photosStore.syncFromOverlay();
    } catch { /* non-fatal — user can refresh manually */ }

    if (result.dsoOverridesImported) {
      const dsoMsg = t('settings.importedDsoOverrides').replace('{n}', String(result.dsoOverridesImported));
      showToast({ message: dsoMsg, type: 'info' });
      try { await reloadUserOverrides(); } catch { /* ignore */ }
    }

    // Keyboard shortcuts are localStorage-only — applied here on the client.
    if (preview.value?.hasShortcuts && importShortcuts.value && preview.value.shortcuts) {
      shortcutsStore.importJSON(preview.value.shortcuts);
      showToast({ message: t('settings.importedShortcuts'), type: 'info' });
    }
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
  } finally {
    importBusy.value = false;
  }
}
</script>
