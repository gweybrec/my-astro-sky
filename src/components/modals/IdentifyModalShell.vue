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
        <div
          class="grid gap-x-2 gap-y-2"
          :class="hideSearch ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_auto]'"
        >
          <div class="min-w-0"><slot name="labels" /></div>
          <div v-if="!hideSearch"></div>
          <div class="min-w-0"><slot name="inputs" /></div>
          <!-- No vertical padding: the inputs set the row height and the button
               (a grid item, stretched by default) fills exactly that height. -->
          <button
            v-if="!hideSearch"
            type="button"
            class="btn-action !py-0"
            :disabled="!canSearch || searching"
            @click="$emit('search')"
          >
            {{ searching ? t('identify.searching') : t('identify.search') }}
          </button>
        </div>
        <slot name="fields-hint" />
        <!-- A search can take up to a minute: a spinner says it runs, and after SLOW_SEARCH_MS a line says it still
             does, so that a long wait does not look like a frozen modal. -->
        <div v-if="searching" class="flex flex-col gap-1" role="status">
          <div class="flex items-center gap-2">
            <span class="auto-solve-spinner"></span>
            <span class="text-hint">{{ t('identify.searching') }}</span>
          </div>
          <div v-if="slow" class="text-hint">{{ t('identify.stillSearching') }}</div>
        </div>
      </div>

      <slot name="photo-hint" />

      <!-- Zoom/pan photo, shown turned as its quarterTurns say. A click (not a drag) is
           reported in the pixels of the photo as shown (photoAsShown); the modal's
           markers are drawn through the `markers` slot's toDisplay(). The photo shrinks to
           leave room for any extra line (fitPhotoToBody); shrink-0 keeps flex from
           clipping its bottom (and the zoom buttons) instead. -->
      <div class="flex items-center justify-center w-full overflow-hidden shrink-0">
        <div ref="photoContainerEl" class="modal-photo-container select-none" @click="onImageClick">
          <img
            ref="imgEl"
            :src="photoFileUrl(photo.filename)"
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
        {{ addLabel ?? t('identify.addSelected', { n: selectedCount }) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * Shared layout of the POI identification modals (asteroid, supernova, comet):
 * intro, search row (fields + Search button) above a zoom/pan photo, results,
 * and a Cancel / "Add selected (n)" footer (or `addLabel`). The modals keep their own search
 * logic and only fill the slots, so all three look and behave alike.
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { photoFileUrl } from '../../api';
import { isPhotoSolved, SLOW_SEARCH_MS } from '@myastrosky/core/photo-identify';
import { createImageZoomPan, type ZoomPanController } from '../../image-zoom';
import { photoAsShown, quarterTurnsOf } from '@myastrosky/core/photo-rotation';
import type { Photo } from '@myastrosky/core/types';

const props = defineProps<{
  photo: Photo;
  modalClass: string;
  title: string;
  intro: string;
  canSearch?: boolean;
  searching?: boolean;
  errorMessage?: string;
  selectedCount: number;
  /** No search step (the manual "add a point of interest" modal): drops the Search button. */
  hideSearch?: boolean;
  /** Replaces the default "Add selected (n)" footer label. */
  addLabel?: string;
}>();

const emit = defineEmits<{
  close: [];
  search: [];
  add: [];
  'photo-click': [{ x: number; y: number }];
}>();

const solved = computed(() => isPhotoSolved(props.photo));
// The photo as it is shown, turned: clicks and markers are in its pixels.
const shown = computed(() => photoAsShown(props.photo));
const turns = computed(() => quarterTurnsOf(props.photo));

// ─── A search that takes long ───────────────────────────────────────────────
const slow = ref(false);
let slowTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.searching,
  (on) => {
    clearTimeout(slowTimer);
    slow.value = false;
    if (on) slowTimer = setTimeout(() => (slow.value = true), SLOW_SEARCH_MS);
  },
  { immediate: true },
);
onUnmounted(() => clearTimeout(slowTimer));

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

let fitObserver: MutationObserver | null = null;

function teardownZoom() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  fitObserver?.disconnect();
  fitObserver = null;
  window.removeEventListener('resize', fitPhotoToBody);
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
    quarterTurns: turns.value,
  });
  zoomControlsHost.value?.appendChild(zoom.controls);
  unsubTransform = zoom.onTransformChange(() => {
    layoutVersion.value++;
  });
  const img = imgEl.value;
  img.addEventListener('load', () => layoutVersion.value++, { once: true });
  if (img.complete) fitPhotoToBody();
  else img.addEventListener('load', fitPhotoToBody, { once: true });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => layoutVersion.value++);
    resizeObserver.observe(img);
  }
  // A line appearing or going away in the body (the slow-search note, an error,
  // results) changes the room left for the photo: refit before the next paint.
  const body = bodyEl();
  if (body && typeof MutationObserver !== 'undefined') {
    fitObserver = new MutationObserver(fitPhotoToBody);
    fitObserver.observe(body, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener('resize', fitPhotoToBody);
}

/** The modal's scrolling body, whose height (capped by the modal) the photo shares. */
function bodyEl(): HTMLElement | null {
  return photoContainerEl.value?.closest<HTMLElement>('.modal-form-body--scroll') ?? null;
}

/** Below this height the photo stops shrinking and the body scrolls instead. */
const MIN_PHOTO_PX = 160;

/**
 * Shrinks the photo so that the whole modal body fits without scrolling: an extra line
 * (slow-search note, error, results) takes its height from the photo, which grows back
 * when the line goes. The photo is first laid out at its full size (`.modal-photo`'s 60vh)
 * and then reduced by what overflows, all before the next paint.
 */
function fitPhotoToBody() {
  const img = imgEl.value;
  const container = photoContainerEl.value;
  const body = bodyEl();
  if (!img || !container || !body || !img.naturalWidth) return;
  const full = window.innerHeight * 0.6;
  const sideways = turns.value % 2 === 1;
  const before = container.offsetHeight;
  if (sideways) sizeSideways(full);
  else img.style.maxHeight = '';
  const overflow = bodyOverflow(body);
  if (overflow > 0) {
    const h = Math.max(
      MIN_PHOTO_PX,
      Math.floor(container.getBoundingClientRect().height - overflow),
    );
    if (sideways) sizeSideways(h);
    else img.style.maxHeight = `${h}px`;
  }
  if (sideways && container.offsetHeight !== before) zoom?.reset();
}

/**
 * How far the body's content runs past its bottom, in fractional pixels: `scrollHeight`
 * rounds, and a half-pixel overflow it hides still shows a scroll bar.
 */
function bodyOverflow(body: HTMLElement): number {
  const last = body.lastElementChild;
  if (!last) return 0;
  const innerBottom = body.getBoundingClientRect().top + body.clientTop + body.clientHeight;
  const padBottom = parseFloat(getComputedStyle(body).paddingBottom) || 0;
  return last.getBoundingClientRect().bottom + padBottom - innerBottom;
}

/**
 * A photo turned a quarter or three is wider than tall where its file is taller than wide: the container takes the size
 * of the turned picture within the same limits as an upright one (the modal's width, `maxHeight`, never enlarged), and
 * the image the size of its file at that scale, which the zoom then shows turned in the container.
 */
function sizeSideways(maxHeight: number) {
  const img = imgEl.value;
  const container = photoContainerEl.value;
  const room = container?.parentElement?.clientWidth ?? 0;
  if (!img || !container || !img.naturalWidth || !img.naturalHeight || room <= 0) return;
  const scale = Math.min(1, room / img.naturalHeight, maxHeight / img.naturalWidth);
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.width = `${img.naturalWidth * scale}px`;
  img.style.height = `${img.naturalHeight * scale}px`;
  container.style.width = `${img.naturalHeight * scale}px`;
  container.style.height = `${img.naturalWidth * scale}px`;
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
  emit('photo-click', { x: relX * shown.value.width, y: relY * shown.value.height });
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
    left: imgRect.left - containerRect.left + (px.x / shown.value.width) * imgRect.width,
    top: imgRect.top - containerRect.top + (px.y / shown.value.height) * imgRect.height,
  };
}
</script>
