<template>
  <Teleport to="body">
    <div ref="popupEl" class="photo-gear-popup" @click.stop>
      <!-- Opacity slider -->
      <div class="gear-popup-section">
        <div class="gear-popup-label">{{ t('photos.opacity') }}</div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="currentOpacity"
          class="gear-popup-slider"
          @input="onOpacityInput"
        />
      </div>
      <!-- Action buttons -->
      <div class="gear-popup-actions-section">
        <button class="gear-popup-action-btn" @click="onReposition">
          {{ t('photos.reposition') }}
        </button>
        <button class="gear-popup-action-btn" @click="onDrawOrder">
          {{ t('photos.zOrder') }}
        </button>
        <button class="gear-popup-action-btn" @click="onEditMeta">
          {{ t('gallery.editMetadata') }}
        </button>
        <button class="gear-popup-delete-btn" @click="onDelete">
          {{ t('photos.delete') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { usePhotosStore } from '../../stores/photos';
import { positionPopup } from '../../popup-utils';
import { showMetadataEditor } from '../../metadata-editor';
import { confirmPhotoDelete } from '../../photo-delete-confirm';
import { showToast } from '../../toast';
import { updatePhotoOrder } from '../../api';

const props = defineProps<{
  photoId: string;
  anchorRect: DOMRect;
}>();

const emit = defineEmits<{
  close: [];
  'open-draw-order': [];
}>();

const canvasStore = useCanvasStore();
const photosStore = usePhotosStore();
const popupEl = ref<HTMLElement | null>(null);

const currentOpacity = computed(() => {
  const placed = photosStore.placedPhotos.find((p) => p.photo.id === props.photoId);
  return placed?.opacity ?? 1;
});

const photoName = computed(() => {
  const placed = photosStore.placedPhotos.find((p) => p.photo.id === props.photoId);
  return placed?.photo.originalName ?? '';
});

function onOpacityInput(e: Event) {
  const overlay = canvasStore.overlay;
  if (overlay)
    overlay.setPhotoOpacity(props.photoId, parseFloat((e.target as HTMLInputElement).value));
}

function onReposition() {
  emit('close');
  canvasStore.overlay?.startRepositioning(props.photoId);
}

function onDrawOrder() {
  emit('open-draw-order');
  emit('close');
}

function onEditMeta() {
  emit('close');
  const overlay = canvasStore.overlay;
  if (!overlay) return;
  const ph = overlay.getPlacedPhotos().find((p) => p.photo.id === props.photoId)?.photo;
  if (!ph) return;
  const allLabels = [...new Set(overlay.getPlacedPhotos().flatMap((p) => p.photo.labels))];
  const allFilters = [
    ...new Set(
      overlay
        .getPlacedPhotos()
        .flatMap((p) => (p.photo.integrations ?? []).map((row) => row.filter))
        .filter(Boolean),
    ),
  ];
  showMetadataEditor(
    ph,
    (updated) => {
      overlay.updatePhotoData(updated);
      photosStore.syncFromOverlay();
    },
    allLabels,
    allFilters,
  );
}

async function onDelete() {
  const confirmed = await confirmPhotoDelete(photoName.value);
  if (!confirmed) return;
  const name = photoName.value;
  emit('close');
  const overlay = canvasStore.overlay;
  if (!overlay) return;
  overlay.hidePhoto(props.photoId);
  showToast({
    message: t('photos.deleted', { name }),
    type: 'undo',
    duration: 5000,
    actionLabel: t('photos.undo'),
    onAction: () => {
      overlay.unhidePhoto(props.photoId);
    },
    onExpire: () => {
      overlay.removePhoto(props.photoId);
    },
  });
}

function onOutsideClick(e: MouseEvent) {
  const el = popupEl.value;
  if (!el) return;
  const target = e.target as HTMLElement;
  if (!el.contains(target) && !target.closest('.btn-gear')) {
    emit('close');
  }
}

onMounted(() => {
  if (popupEl.value) positionPopup(popupEl.value, props.anchorRect);
  document.addEventListener('click', onOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onOutsideClick);
});
</script>
