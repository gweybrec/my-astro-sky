<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { deletePhotoAPI } from '@myastrosky/app-state/api';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import { useSheetDrag } from '../../composables/useSheetDrag';
import PhoneChip from '../../components/PhoneChip.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import AppIcon from '../../components/AppIcon.vue';
import eyeIcon from '@icons/eye.svg?raw';
import eyeOffIcon from '@icons/eye-off.svg?raw';
import imageIcon from '@icons/image.svg?raw';
import moveIcon from '../../icons/move.svg?raw';
import stackIcon from '../../icons/stack-order.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Ciel, photo sélectionnée": a placed photo picked on the map, in a sheet over the bottom of the map. Its name,
// the objects it shows (a chip each, nine to a page, pages swiped), its opacity on the map and its actions. Hiding the
// photo and deleting it are done here; the gallery, repositioning, the display order and the metadata wait for their screens.
// It closes as the object sheet does: dragging down, the handle, a tap on an empty spot and the back button.
const props = defineProps<{ photo: Photo; layer: PhotoLayer }>();
const emit = defineEmits<{ close: []; removed: []; dso: [id: string] }>();
const titleId = useId();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const drag = useSheetDrag(() => emit('close'));

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

// The objects of the photo, nine to a page: the dots follow the page swiped to.
const PAGE_SIZE = 9;
const pages = computed(() => {
  const ids = props.photo.dsoIds ?? [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) out.push(ids.slice(i, i + PAGE_SIZE));
  return out;
});
const page = ref(0);
function onScroll(event: Event) {
  const track = event.currentTarget as HTMLElement;
  page.value = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
}
const pageLabel = (n: number) => t('mobile.sky.pageOf', { n, total: pages.value.length });
</script>

<template>
  <section class="mob-sheet mob-sheet--auto mob-map-sheet" :aria-labelledby="titleId">
    <div class="mob-sheet-drag" v-on="drag">
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="t('mobile.sky.closeSheet')"
        @click="emit('close')"
      >
        <span class="mob-sheet-handle" />
      </button>
      <div class="mob-sheet-header">
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ photo.originalName }}</h2>
      </div>
    </div>
    <div
      v-if="pages.length"
      class="mob-pager"
      role="group"
      aria-roledescription="carousel"
      :aria-label="t('mobile.sky.photoObjects')"
    >
      <div class="mob-pager-track" @scroll.passive="onScroll">
        <div
          v-for="(ids, n) in pages"
          :key="n"
          class="mob-pager-page mob-chip-row mob-chip-row--wrap"
          role="group"
          :aria-label="pageLabel(n + 1)"
        >
          <PhoneChip v-for="id in ids" :key="id" @click="emit('dso', id)">{{ id }}</PhoneChip>
        </div>
      </div>
      <div
        v-if="pages.length > 1"
        class="mob-pager-dots"
        role="img"
        :aria-label="pageLabel(page + 1)"
      >
        <span
          v-for="(_, n) in pages"
          :key="n"
          class="mob-pager-dot"
          :class="{ 'mob-pager-dot--on': n === page }"
        />
      </div>
    </div>
    <PhoneSliderRow
      v-model="opacity"
      :label="t('photos.opacity')"
      :min="0"
      :max="1"
      :step="0.05"
      :display="opacity.toFixed(2)"
    />
    <!-- The screens behind the gallery, repositioning, display order and metadata have no board yet. -->
    <div class="mob-icon-row" role="group" :aria-label="t('mobile.sky.photoActions')">
      <PhoneIconButton
        :label="visible ? t('photos.hide') : t('photos.show')"
        @click="toggleVisible"
      >
        <AppIcon :svg="visible ? eyeOffIcon : eyeIcon" />
      </PhoneIconButton>
      <PhoneIconButton waiting :label="t('photos.openInGallery')"
        ><AppIcon :svg="imageIcon"
      /></PhoneIconButton>
      <PhoneIconButton waiting :label="t('photos.reposition')"
        ><AppIcon :svg="moveIcon"
      /></PhoneIconButton>
      <PhoneIconButton waiting :label="t('photos.zOrder')"
        ><AppIcon :svg="stackIcon"
      /></PhoneIconButton>
      <PhoneIconButton waiting :label="t('gallery.editMetadata')"
        ><AppIcon :svg="penIcon"
      /></PhoneIconButton>
      <PhoneIconButton danger :label="t('photos.delete')" @click="remove">
        <AppIcon :svg="trashIcon" />
      </PhoneIconButton>
    </div>
  </section>
</template>
