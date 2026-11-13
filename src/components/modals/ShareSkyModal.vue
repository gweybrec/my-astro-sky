<template>
  <div class="modal-backdrop">
    <div class="modal settings-modal--flex" @click.stop>
      <div class="modal-header">
        <h2>{{ t('sharedSky.shareTitle') }}</h2>
        <button class="modal-close" @click="onClose">&times;</button>
      </div>
      <div class="modal-body modal-form-body--scroll">
        <div class="settings-field">
          <label class="settings-field-label" for="share-sky-name">{{
            t('sharedSky.nameLabel')
          }}</label>
          <input
            id="share-sky-name"
            v-model="senderName"
            type="text"
            class="settings-field-input"
            :maxlength="MAX_SKY_NAME_LENGTH"
          />
        </div>

        <label class="export-checkbox-row">
          <input type="checkbox" v-model="includeGear" />
          {{ t('sharedSky.includeGear') }}
        </label>

        <div class="modal-divider"></div>

        <PhotoPickList :photos="photos" :selected="selected" />

        <div v-if="sizeLabel" class="export-size-info">{{ sizeLabel }}</div>
        <p class="text-para">{{ t('sharedSky.shareAnyone') }}</p>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" :disabled="busy" @click="onClose">
          {{ t('modal.cancel') }}
        </button>
        <button
          class="btn-confirm"
          :class="{ 'btn-busy': busy }"
          :aria-busy="busy || undefined"
          :disabled="!canShare || busy"
          @click="onShare"
        >
          <span v-if="busy" class="auto-solve-spinner" aria-hidden="true"></span
          >{{ t('sharedSky.shareConfirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** "Share my sky": the photos to share, the name to show and whether gear travels; then the package is downloaded. */
import { computed, onMounted, reactive, ref } from 'vue';
import { t } from '../../i18n';
import PhotoPickList from '../base/PhotoPickList.vue';
import { usePhotosStore } from '../../stores/photos';
import { getShareSenderName } from '../../api';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { showToast } from '../../toast';
import { reportUnknownRendererError } from '../../error-reporter';
import { formatBytes } from '@myastrosky/core/format-utils';
import { selectedPhotoBytes } from '@myastrosky/core/backup-selection';
import {
  cleanSkyName,
  MAX_SKY_NAME_LENGTH,
  shareFileName,
} from '@myastrosky/core/domain/shared-sky';

const emit = defineEmits<{ close: [] }>();

const photosStore = usePhotosStore();
const sharedSkies = useSharedSkiesStore();
const photos = computed(() => photosStore.placedPhotos.map((p) => p.photo));

const senderName = ref('');
const includeGear = ref(true);
const busy = ref(false);
const selected = reactive(new Set<string>(photos.value.map((p) => p.id)));

onMounted(async () => {
  try {
    const remembered = await getShareSenderName();
    if (!senderName.value) senderName.value = remembered;
  } catch (err) {
    reportUnknownRendererError('shared_sky_sender_name', err);
  }
});

const selectedIds = computed(() => photos.value.filter((p) => selected.has(p.id)).map((p) => p.id));
const sizeLabel = computed(() =>
  selectedIds.value.length > 0
    ? t('settings.exportEstimatedSize').replace(
        '{size}',
        formatBytes(selectedPhotoBytes(photos.value, selected)),
      )
    : '',
);
const canShare = computed(
  () => selectedIds.value.length > 0 && cleanSkyName(senderName.value) !== '',
);

function onClose() {
  if (!busy.value) emit('close');
}

async function onShare() {
  busy.value = true;
  try {
    await sharedSkies.share({
      senderName: senderName.value,
      includeGear: includeGear.value,
      ids: selectedIds.value,
    });
    showToast({
      message: t('sharedSky.shareStarted', { name: shareFileName(senderName.value) }),
      type: 'info',
    });
    emit('close');
  } catch (err) {
    reportUnknownRendererError('shared_sky_share', err);
    showToast({
      message: err instanceof Error ? err.message : t('errors.shareSky'),
      type: 'error',
    });
    busy.value = false;
  }
}
</script>
