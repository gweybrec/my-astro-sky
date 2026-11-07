<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { deletePhotoAPI } from '@myastrosky/app-state/api';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneMapSheet from '../../components/PhoneMapSheet.vue';
import PhoneChipPager from '../../components/PhoneChipPager.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhotoFacts from '../../components/PhotoFacts.vue';
import AppIcon from '../../components/AppIcon.vue';
import eyeIcon from '@icons/eye.svg?raw';
import eyeOffIcon from '@icons/eye-off.svg?raw';
import imageIcon from '@icons/image.svg?raw';
import moveIcon from '../../icons/move.svg?raw';
import stackIcon from '../../icons/stack-order.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Ciel, photo sélectionnée": a placed photo picked on the map, in a sheet over the bottom of the map. Its name,
// the objects it shows (a chip each, the most important catalogue first, two lines to a page in portrait and one in
// landscape, pages swiped), what is known of it, read only, its opacity on the map and its actions; the body scrolls.
// Hiding the photo, opening it in the gallery, editing its information and deleting it are done here; the display order
// opens its page (`order`), and repositioning the placement screen on the map (`reposition`).
// It closes as the object sheet does: dragging down, the handle, a tap on an empty spot and the back button.
const props = defineProps<{ photo: Photo; layer: PhotoLayer }>();
const emit = defineEmits<{
  close: [];
  removed: [];
  dso: [id: string];
  gallery: [];
  edit: [];
  order: [];
  reposition: [];
}>();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const placed = () => props.layer.getPlacedPhotos().find((p) => p.photo.id === props.photo.id);
const opacity = ref(placed()?.opacity ?? 1);
const visible = ref(placed()?.visible ?? true);
watch(opacity, (value) => props.layer.setPhotoOpacity(props.photo.id, value));

function toggleVisible() {
  props.layer.toggleVisibility(props.photo.id);
  visible.value = !visible.value;
}

async function remove() {
  const ok = await confirm({
    title: t('photos.deleteConfirmTitle'),
    message: t('photos.deleteConfirmMessage', { name: props.photo.originalName }),
    confirmLabel: t('photos.deleteConfirmAction'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await deletePhotoAPI(props.photo.id);
  } catch (error) {
    await showError(error);
    return;
  }
  props.layer.removePhotosFromMap([props.photo.id]);
  emit('removed');
}

// The objects of the photo, the most important catalogue first (`PhoneChipPager`: two lines of chips to a page in
// portrait, one in landscape); a tap selects the object on the map.
const ids = sortDsoIdsByImportance(props.photo.dsoIds ?? []);
</script>

<template>
  <PhoneMapSheet :title="photo.originalName" @close="emit('close')">
    <PhoneChipPager :ids="ids" :label="t('mobile.sky.photoObjects')" @pick="emit('dso', $event)" />
    <PhotoFacts :photo="photo" brief />
    <PhoneSliderRow
      v-model="opacity"
      :label="t('photos.opacity')"
      :min="0"
      :max="1"
      :step="0.05"
      :display="opacity.toFixed(2)"
    />
    <!-- The sheet's second stop is above this row. -->
    <div
      class="mob-icon-row"
      role="group"
      :aria-label="t('mobile.sky.photoActions')"
      data-sheet-stop="before"
    >
      <PhoneIconButton
        :label="visible ? t('photos.hide') : t('photos.show')"
        @click="toggleVisible"
      >
        <AppIcon :svg="visible ? eyeOffIcon : eyeIcon" />
      </PhoneIconButton>
      <PhoneIconButton :label="t('photos.openInGallery')" @click="emit('gallery')"
        ><AppIcon :svg="imageIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('photos.reposition')" @click="emit('reposition')"
        ><AppIcon :svg="moveIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('photos.zOrder')" @click="emit('order')"
        ><AppIcon :svg="stackIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('gallery.editMetadata')" @click="emit('edit')"
        ><AppIcon :svg="penIcon"
      /></PhoneIconButton>
      <PhoneIconButton danger :label="t('photos.delete')" @click="remove">
        <AppIcon :svg="trashIcon" />
      </PhoneIconButton>
    </div>
  </PhoneMapSheet>
</template>
