<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import { deletePhotoAPI } from '@myastrosky/app-state/api';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import { pagesByLine } from '../../chip-pages';
import PhoneMapSheet from '../../components/PhoneMapSheet.vue';
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
// the objects it shows (a chip each, the most important catalogue first, two lines to a page in portrait and one in
// landscape, pages swiped), its opacity on the map and its actions. Hiding the
// photo, opening it in the gallery, editing its information and deleting it are done here; the display order opens its
// page (`order`); repositioning waits for its screen.
// It closes as the object sheet does: dragging down, the handle, a tap on an empty spot and the back button.
const props = defineProps<{ photo: Photo; layer: PhotoLayer }>();
const emit = defineEmits<{
  close: [];
  removed: [];
  dso: [id: string];
  gallery: [];
  edit: [];
  order: [];
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

// The objects of the photo, the most important catalogue first, at most two lines of chips to a page in portrait and
// one in landscape (the sheet, under the search row, has no room for two there): the chips are laid out once in a
// hidden row as wide as a page, and the pages are cut where they wrap (again when the width changes, as when the phone
// turns). The dots follow the page swiped to.
const ids = sortDsoIdsByImportance(props.photo.dsoIds ?? []);
const measure = ref<HTMLElement | null>(null);
const pages = ref<string[][]>(ids.length ? [ids] : []);
function cutPages() {
  const row = measure.value;
  if (!row || !ids.length) return;
  const tops = [...row.children].map((chip) => (chip as HTMLElement).offsetTop);
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? false;
  pages.value = pagesByLine(ids, tops, landscape ? 1 : 2);
}
let resize: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(cutPages);
  // The chips' width changes once the fonts are in.
  void document.fonts?.ready.then(cutPages);
  if (measure.value && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(cutPages);
    resize.observe(measure.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
const page = ref(0);
function onScroll(event: Event) {
  const track = event.currentTarget as HTMLElement;
  page.value = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
}
const pageLabel = (n: number) => t('mobile.sky.pageOf', { n, total: pages.value.length });
</script>

<template>
  <PhoneMapSheet :title="photo.originalName" @close="emit('close')">
    <!-- The chips laid out as on a page, to find where they wrap; not shown, not reachable. -->
    <div
      v-if="ids.length"
      ref="measure"
      class="mob-chip-row mob-chip-row--wrap mob-pager-measure"
      aria-hidden="true"
      inert
    >
      <PhoneChip v-for="id in ids" :key="id" compact>{{ id }}</PhoneChip>
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
          <PhoneChip v-for="id in ids" :key="id" compact @click="emit('dso', id)">{{
            id
          }}</PhoneChip>
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
    <!-- The screen behind repositioning is not built yet. -->
    <div class="mob-icon-row" role="group" :aria-label="t('mobile.sky.photoActions')">
      <PhoneIconButton
        :label="visible ? t('photos.hide') : t('photos.show')"
        @click="toggleVisible"
      >
        <AppIcon :svg="visible ? eyeOffIcon : eyeIcon" />
      </PhoneIconButton>
      <PhoneIconButton :label="t('photos.openInGallery')" @click="emit('gallery')"
        ><AppIcon :svg="imageIcon"
      /></PhoneIconButton>
      <PhoneIconButton waiting :label="t('photos.reposition')"
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
