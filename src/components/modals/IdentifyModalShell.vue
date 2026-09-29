<template>
  <BaseModal
    :modal-class="modalClass"
    body-class="modal-form-body--scroll flex flex-col gap-4"
    @close="$emit('close')"
  >
    <template #title>
      <h2>{{ title }}</h2>
    </template>

    <!-- Always opened pre-targeted at an already-solved photo: PoiEditor.vue's
         identify triggers only render once one is in scope. -->
    <template v-if="solved">
      <p class="text-hint m-0">{{ intro }}</p>

      <!-- Search row: a labels row, then the inputs row ending with Search — two
           grid rows, so a label wrapping to two lines never pushes its input out of
           line, and the button stretches to exactly the inputs' height. A modal with
           several fields uses the same column template in both slots.
           Searching is explicit (never on each edit): editing the date and then the
           time costs one request, not two (TNS allows ~2 searches a minute). -->
      <div class="flex flex-col gap-2">
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2">
          <div class="min-w-0"><slot name="labels" /></div>
          <div></div>
          <div class="min-w-0"><slot name="inputs" /></div>
          <!-- No vertical padding: the inputs set the row height and the button
               (a grid item, stretched by default) fills exactly that height. -->
          <button
            type="button"
            class="btn-action !py-0"
            :disabled="!canSearch || searching"
            @click="$emit('search')"
          >
            {{ searching ? t('identify.searching') : t('identify.search') }}
          </button>
        </div>
        <slot name="fields-hint" />
      </div>

      <slot name="photo-hint" />

      <!-- Zoom/pan photo. A click (not a drag) is reported in photo pixels; the
           modal's markers are drawn through the `markers` slot's toDisplay(). -->
      <div class="flex items-center justify-center w-full overflow-hidden">
        <div ref="photoContainerEl" class="modal-photo-container select-none" @click="onImageClick">
          <img
            ref="imgEl"
            :src="`/uploads/${photo.filename}`"
            :alt="photo.originalName"
            class="modal-photo"
            draggable="false"
          />
          <slot name="markers" :to-display="toDisplay" />
          <!-- Zoom controls (+/−/fit) are appended here imperatively by
               createImageZoomPan; kept free of v-if/v-for children so Vue's own
               patching never touches or removes them. -->
          <div ref="zoomControlsHost"></div>
        </div>
      </div>

      <div v-if="errorMessage" class="text-[var(--color-danger)]">{{ errorMessage }}</div>

      <slot name="results" />
    </template>

    <template #footer>
      <button type="button" class="btn-cancel" @click="$emit('close')">
        {{ t('modal.cancel') }}
      </button>
      <button
        type="button"
        class="btn-confirm"
        :disabled="selectedCount === 0"
        @click="$emit('add')"
      >
        {{ t('identify.addSelected', { n: selectedCount }) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * Shared layout of the POI identification modals (asteroid, supernova, comet):
 * intro, search row (fields + Search button) above a zoom/pan photo, results,
 * and a Cancel / "Add selected (n)" footer. The modals keep their own search
 * logic and only fill the slots, so all three look and behave alike.
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { computePhotoToProjMatrix } from '../../photo-placement';
import { createImageZoomPan, type ZoomPanController } from '../../image-zoom';
import type { Photo } from '../../types';

const props = defineProps<{
  photo: Photo;
  modalClass: string;
  title: string;
  intro: string;
  canSearch: boolean;
  searching: boolean;
  errorMessage?: string;
  selectedCount: number;
}>();

const emit = defineEmits<{
  close: [];
  search: [];
  add: [];
  'photo-click': [{ x: number; y: number }];
}>();

const solved = computed(() => computePhotoToProjMatrix(props.photo) !== null);

// ─── Zoom / pan ─────────────────────────────────────────────────────────────
const imgEl = ref<HTMLImageElement | null>(null);
const photoContainerEl = ref<HTMLElement | null>(null);
const zoomControlsHost = ref<HTMLElement | null>(null);
let zoom: ZoomPanController | null = null;
let unsubTransform: (() => void) | null = null;
// Bumped on zoom/pan and whenever the image box resizes (image load, a hint line
// appearing or disappearing), so marker positions — read from live
// getBoundingClientRect — are recomputed.
const layoutVersion = ref(0);
let resizeObserver: ResizeObserver | null = null;

function teardownZoom() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  unsubTransform?.();
  unsubTransform = null;
  zoom?.destroy();
  zoom = null;
}

function setupZoom() {
  teardownZoom();
  if (!imgEl.value || !photoContainerEl.value) return;
  zoom = createImageZoomPan(imgEl.value, photoContainerEl.value, {
    minScale: 1,
    maxScale: 5,
    fitButtons: true,
    dblClick: 'none',
  });
  zoomControlsHost.value?.appendChild(zoom.controls);
  unsubTransform = zoom.onTransformChange(() => {
    layoutVersion.value++;
  });
  imgEl.value.addEventListener('load', () => layoutVersion.value++, { once: true });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => layoutVersion.value++);
    resizeObserver.observe(imgEl.value);
  }
}

// The photo block only exists while the photo is solved (v-if), so wire zoom up
// and down as the <img> ref appears/disappears rather than in onMounted.
watch(imgEl, (el) => {
  if (el) setupZoom();
  else teardownZoom();
});
onUnmounted(teardownZoom);

function onImageClick(e: MouseEvent) {
  if (zoom?.wasDrag) return;
  const img = imgEl.value;
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  const relY = (e.clientY - rect.top) / rect.height;
  if (!(relX >= 0 && relX <= 1 && relY >= 0 && relY <= 1)) return;
  emit('photo-click', { x: relX * props.photo.width, y: relY * props.photo.height });
}

/**
 * Screen position (relative to the photo container) of a photo pixel, following
 * zoom/pan. Null before the image has a layout box. Reads `layoutVersion`, so a
 * slot rendering markers re-renders whenever the image moves.
 */
function toDisplay(px: { x: number; y: number }): { left: number; top: number } | null {
  const _dep = layoutVersion.value; // reactive dependency — see layoutVersion
  if (!imgEl.value || !photoContainerEl.value) return null;
  const imgRect = imgEl.value.getBoundingClientRect();
  if (imgRect.width <= 0) return null;
  const containerRect = photoContainerEl.value.getBoundingClientRect();
  return {
    left: imgRect.left - containerRect.left + (px.x / props.photo.width) * imgRect.width,
    top: imgRect.top - containerRect.top + (px.y / props.photo.height) * imgRect.height,
  };
}
</script>
