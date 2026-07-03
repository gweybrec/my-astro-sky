<template>
  <div class="modal-backdrop">
    <div
      class="modal settings-modal--flex"
      :class="phase === 'options' ? '!max-w-[860px]' : ''"
      @click.stop
    >
      <div class="modal-header">
        <h2>{{ t('settings.importTitle') }}</h2>
        <button class="modal-close" @click="onClose">&times;</button>
      </div>

      <!-- Phase 1: pick a file -->
      <div v-if="phase === 'pick'" class="modal-body modal-form-body--loose">
        <label class="display-controls-btn self-start">
          {{ previewBusy ? '…' : t('settings.importChooseFile') }}
          <input
            type="file"
            accept=".zip,.json"
            class="hidden"
            :disabled="previewBusy"
            @change="onFilePicked"
          />
        </label>
        <div class="import-backup-section">
          <div class="import-backup-warning">⚠ {{ t('settings.importBackupWarning') }}</div>
          <button
            class="display-controls-btn self-start text-small"
            :disabled="!hasPhotos || backingUp"
            @click="doBackup"
          >
            {{ t('settings.importBackupBtn') }}
          </button>
        </div>
      </div>

      <!-- Phase 2: show detected contents with options -->
      <div v-else-if="phase === 'options' && preview" class="modal-body modal-form-body--scroll">
        <div class="flex items-center gap-3 mb-2">
          <span
            class="text-small text-secondary flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ fileName }}</span
          >
          <button class="display-controls-btn text-small shrink-0" @click="resetToPick">
            {{ t('settings.importChangeFile') }}
          </button>
        </div>

        <!-- Global toggles (no per-item selection) -->
        <div v-if="preview.hasDsoOverrides || preview.hasPoiCategories || preview.hasShortcuts">
          <div class="export-options-label">{{ t('settings.importContent') }}</div>
          <label v-if="preview.hasDsoOverrides" class="export-checkbox-row">
            <input type="checkbox" v-model="importDso" />
            {{ t('settings.importDsoOverridesLabel') }}
          </label>
          <label v-if="preview.hasPoiCategories" class="export-checkbox-row">
            <input type="checkbox" v-model="importPoiCategories" />
            {{ t('settings.importPoiCategoriesLabel') }}
          </label>
          <label v-if="preview.hasShortcuts" class="export-checkbox-row">
            <input type="checkbox" v-model="importShortcuts" />
            {{ t('settings.importShortcutsLabel') }}
          </label>
        </div>

        <!-- Per-item selectable lists -->
        <template v-if="hasAnyList">
          <div class="modal-divider"></div>
          <div class="flex flex-wrap items-stretch">
            <!-- Photos -->
            <div
              v-if="preview.images.length > 0"
              class="export-photo-section import-col flex-1 min-w-[180px] px-4"
            >
              <label class="export-select-all-row">
                <input
                  type="checkbox"
                  :checked="imgSel.all"
                  :indeterminate.prop="imgSel.some && !imgSel.all"
                  @change="imgSel.toggleAll"
                />
                <span class="export-select-all-label">{{
                  t('settings.importImagesSection').replace('{n}', String(preview.images.length))
                }}</span>
              </label>
              <div class="export-scroll-list">
                <label v-for="img in preview.images" :key="img.filename" class="export-photo-row">
                  <input
                    type="checkbox"
                    :checked="imgSel.selected.has(img.filename)"
                    @change="imgSel.toggle(img.filename)"
                  />
                  <span class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="text-small font-normal truncate min-w-0">{{
                      img.originalName
                    }}</span>
                    <span
                      v-if="img.exists"
                      class="import-warn-icon"
                      :title="t('settings.importReplaceWarning')"
                      >⚠</span
                    >
                  </span>
                  <span class="text-dim-xs">{{ formatBytes(img.size) }}</span>
                </label>
              </div>
            </div>

            <!-- Plans -->
            <div
              v-if="preview.plans.length > 0"
              class="export-photo-section import-col flex-1 min-w-[180px] px-4"
            >
              <label class="export-select-all-row">
                <input
                  type="checkbox"
                  :checked="planSel.all"
                  :indeterminate.prop="planSel.some && !planSel.all"
                  @change="planSel.toggleAll"
                />
                <span class="export-select-all-label">{{
                  t('settings.importPlansSection').replace('{n}', String(preview.plans.length))
                }}</span>
              </label>
              <div class="export-scroll-list">
                <label v-for="p in preview.plans" :key="p.id" class="export-photo-row">
                  <input
                    type="checkbox"
                    :checked="planSel.selected.has(p.id)"
                    @change="planSel.toggle(p.id)"
                  />
                  <span class="text-small font-normal truncate min-w-0">{{ p.name }}</span>
                  <span
                    v-if="p.exists"
                    class="import-warn-icon"
                    :title="t('settings.importReplaceWarning')"
                    >⚠</span
                  >
                </label>
              </div>
            </div>

            <!-- Setups -->
            <div
              v-if="preview.setups.length > 0"
              class="export-photo-section import-col flex-1 min-w-[180px] px-4"
            >
              <label class="export-select-all-row">
                <input
                  type="checkbox"
                  :checked="setupSel.all"
                  :indeterminate.prop="setupSel.some && !setupSel.all"
                  @change="setupSel.toggleAll"
                />
                <span class="export-select-all-label">{{
                  t('settings.importSetupsSection').replace('{n}', String(preview.setups.length))
                }}</span>
              </label>
              <div class="export-scroll-list">
                <label v-for="s in preview.setups" :key="s.id" class="export-photo-row">
                  <input
                    type="checkbox"
                    :checked="setupSel.selected.has(s.id)"
                    @change="setupSel.toggle(s.id)"
                  />
                  <span class="text-small font-normal truncate min-w-0">{{ s.name }}</span>
                  <span
                    v-if="s.exists"
                    class="import-warn-icon"
                    :title="t('settings.importReplaceWarning')"
                    >⚠</span
                  >
                </label>
              </div>
            </div>

            <!-- Custom gear -->
            <div
              v-if="preview.gear.length > 0"
              class="export-photo-section import-col flex-1 min-w-[180px] px-4"
            >
              <label class="export-select-all-row">
                <input
                  type="checkbox"
                  :checked="gearSel.all"
                  :indeterminate.prop="gearSel.some && !gearSel.all"
                  @change="gearSel.toggleAll"
                />
                <span class="export-select-all-label">{{
                  t('settings.importGearSection').replace('{n}', String(preview.gear.length))
                }}</span>
              </label>
              <div class="export-scroll-list">
                <label v-for="g in preview.gear" :key="g.id" class="export-photo-row">
                  <input
                    type="checkbox"
                    :checked="gearSel.selected.has(g.id)"
                    @change="gearSel.toggle(g.id)"
                  />
                  <span class="text-small font-normal truncate min-w-0">{{ g.name }}</span>
                  <span
                    v-if="g.exists"
                    class="import-warn-icon"
                    :title="t('settings.importReplaceWarning')"
                    >⚠</span
                  >
                </label>
              </div>
            </div>
          </div>
        </template>
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
        >
          {{ importBusy ? '…' : t('settings.importData') }}
        </button>
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
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { importPreview, importData, exportData, getPhotos } from '../../api';
import type { ImportPreviewResult } from '../../api';
import { reloadUserOverrides } from '../../dso-catalog';
import { showToast } from '../../toast';
import { formatBytes } from '../../format-utils';

const emit = defineEmits<{ close: [] }>();

const photosStore = usePhotosStore();
const canvasStore = useCanvasStore();
const shortcutsStore = useShortcutsStore();
const poiCategoriesStore = usePoiCategoriesStore();
const hasPhotos = computed(() => photosStore.placedPhotos.length > 0);

const phase = ref<'pick' | 'options'>('pick');
const fileName = ref('');
const storedFile = ref<File | null>(null);
const preview = ref<ImportPreviewResult | null>(null);
const previewBusy = ref(false);
const importBusy = ref(false);
const backingUp = ref(false);

const importDso = ref(true);
const importPoiCategories = ref(true);
const importShortcuts = ref(true);

/**
 * A tri-state selection controller over a list of items keyed by `keyOf`.
 * Wrapped in reactive() so its computed refs unwrap when accessed in templates.
 */
function useSelection<T>(itemsFn: () => T[], keyOf: (t: T) => string) {
  const selected = reactive(new Set<string>());
  return reactive({
    selected,
    all: computed(() => {
      const list = itemsFn();
      return list.length > 0 && list.every((i) => selected.has(keyOf(i)));
    }),
    some: computed(() => itemsFn().some((i) => selected.has(keyOf(i)))),
    toggleAll(e: Event) {
      if ((e.target as HTMLInputElement).checked) itemsFn().forEach((i) => selected.add(keyOf(i)));
      else selected.clear();
    },
    toggle(key: string) {
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
    },
    reset(selectAll: boolean) {
      selected.clear();
      if (selectAll) itemsFn().forEach((i) => selected.add(keyOf(i)));
    },
  });
}

const imgSel = useSelection(
  () => preview.value?.images ?? [],
  (i) => i.filename,
);
const planSel = useSelection(
  () => preview.value?.plans ?? [],
  (i) => i.id,
);
const setupSel = useSelection(
  () => preview.value?.setups ?? [],
  (i) => i.id,
);
const gearSel = useSelection(
  () => preview.value?.gear ?? [],
  (i) => i.id,
);

const hasAnyList = computed(
  () =>
    !!preview.value &&
    (preview.value.images.length > 0 ||
      preview.value.plans.length > 0 ||
      preview.value.setups.length > 0 ||
      preview.value.gear.length > 0),
);

const canImport = computed(() => {
  if (!preview.value) return false;
  return (
    imgSel.some ||
    planSel.some ||
    setupSel.some ||
    gearSel.some ||
    (preview.value.hasDsoOverrides && importDso.value) ||
    (preview.value.hasPoiCategories && importPoiCategories.value) ||
    (preview.value.hasShortcuts && importShortcuts.value)
  );
});

function onClose() {
  if (!importBusy.value) emit('close');
}

function resetToPick() {
  phase.value = 'pick';
  preview.value = null;
  fileName.value = '';
  storedFile.value = null;
  imgSel.reset(false);
  planSel.reset(false);
  setupSel.reset(false);
  gearSel.reset(false);
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
    // Pre-select everything by default.
    imgSel.reset(true);
    planSel.reset(true);
    setupSel.reset(true);
    gearSel.reset(true);
    importDso.value = true;
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

async function doBackup() {
  backingUp.value = true;
  const ids = photosStore.placedPhotos.map((p) => p.photo.id);
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
      // Photo metadata always travels with the photos that get imported.
      importMetadata: preview.value.hasMetadata,
      importDsoOverrides: preview.value.hasDsoOverrides && importDso.value,
      importPoiCategories: preview.value.hasPoiCategories && importPoiCategories.value,
      selectedImages: hasImages ? Array.from(imgSel.selected) : null,
      selectedPlans: Array.from(planSel.selected),
      selectedSetups: Array.from(setupSel.selected),
      selectedGear: Array.from(gearSel.selected),
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
    } catch {
      /* non-fatal — user can refresh manually */
    }

    // Refresh POI categories if they were part of the bundle.
    if (preview.value?.hasPoiCategories && importPoiCategories.value) {
      try {
        await poiCategoriesStore.load();
      } catch {
        /* ignore */
      }
    }

    if (result.dsoOverridesImported) {
      const dsoMsg = t('settings.importedDsoOverrides').replace(
        '{n}',
        String(result.dsoOverridesImported),
      );
      showToast({ message: dsoMsg, type: 'info' });
      try {
        await reloadUserOverrides();
      } catch {
        /* ignore */
      }
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
