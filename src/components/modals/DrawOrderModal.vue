<template>
  <BaseModal
    modal-class="photo-draw-order-modal"
    body-class="draw-order-modal-body"
    @close="$emit('close')"
  >
    <template #title>
      <div class="draw-order-popup-title-wrap">
        <h2 class="draw-order-popup-title">{{ t('photos.zOrder') }}</h2>
        <div class="draw-order-popup-subtitle">{{ photoName }}</div>
      </div>
    </template>

    <!-- Filters -->
    <div class="gear-popup-section draw-order-filter-section">
      <input
        ref="filterInputEl"
        type="search"
        class="draw-order-search-input"
        :placeholder="t('photos.searchPlaceholder')"
        v-model="filterQuery"
      />
      <label class="draw-order-overlap-toggle">
        <input type="checkbox" v-model="overlapOnly" />
        <span>{{ t('photos.overlapOnly') }}</span>
      </label>
    </div>
    <!-- Photo list -->
    <div class="gear-popup-section">
      <div v-if="visibleItems.length === 0" class="draw-order-empty">
        {{ t('photos.drawOrderEmpty') }}
      </div>
      <div v-else ref="listEl" class="zorder-list draw-order-list" @scroll="onListScroll">
        <div
          v-for="item in visibleItems"
          :key="item.id"
          :data-photo-id="item.id"
          :class="['zorder-item', item.id === photoId ? 'current' : '']"
        >
          <span class="zorder-grip" @mousedown.prevent="startDrag($event, item.id)">⠿</span>
          <span class="zorder-item-name">{{ item.originalName }}</span>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { t } from '../../i18n';
import BaseModal from '../base/BaseModal.vue';
import { useCanvasStore } from '../../stores/canvas';
import { usePhotosStore } from '../../stores/photos';
import { filterDrawOrderPhotos } from '../../photo-draw-order';
import { updatePhotoOrder } from '../../api';
import { showToast } from '../../toast';

const props = defineProps<{ photoId: string }>();
const emit = defineEmits<{ close: [] }>();

const canvasStore = useCanvasStore();
const photosStore = usePhotosStore();
const listEl = ref<HTMLElement | null>(null);
const filterInputEl = ref<HTMLInputElement | null>(null);
const filterQuery = ref('');
const overlapOnly = ref(false);
const listScrollTop = ref(0);

const displayOrder = computed(() => [...photosStore.placedPhotos].reverse());

const filteredIds = computed(() => {
  const overlay = canvasStore.overlay;
  const skyMap = canvasStore.skyMap;
  if (!overlay || !skyMap) return new Set<string>();
  const quads = overlay.getPhotoCanvasQuads(skyMap.getView());
  const filtered = filterDrawOrderPhotos(
    displayOrder.value.map(p => p.photo),
    filterQuery.value,
    overlapOnly.value,
    props.photoId,
    quads,
  );
  return new Set(filtered.map(p => p.id));
});

const visibleItems = computed(() =>
  displayOrder.value
    .filter(p => filteredIds.value.has(p.photo.id))
    .map(p => p.photo),
);

const photoName = computed(() => {
  const placed = photosStore.placedPhotos.find(p => p.photo.id === props.photoId);
  return placed?.photo.originalName ?? '';
});

watch([filterQuery, overlapOnly], async () => {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = 0;
  listScrollTop.value = 0;
});

onMounted(() => {
  nextTick(() => {
    filterInputEl.value?.focus();
    if (listEl.value) listEl.value.scrollTop = listScrollTop.value;
  });
});

function onListScroll() {
  if (listEl.value) listScrollTop.value = listEl.value.scrollTop;
}

// --- Drag & drop ---
let dragPhotoId: string | null = null;
let dragEl: HTMLElement | null = null;
let placeholderEl: HTMLElement | null = null;
let dragOffsetY = 0;
let dragLastClientY = 0;
let dragAutoScrollRaf: number | null = null;

const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_MAX_STEP = 18;

function startDrag(e: MouseEvent, photoId: string) {
  const list = listEl.value;
  if (!list) return;
  const grip = e.currentTarget as HTMLElement;
  dragEl = grip.parentElement as HTMLElement;
  const rect = dragEl.getBoundingClientRect();
  dragPhotoId = photoId;
  dragLastClientY = e.clientY;
  dragOffsetY = e.clientY - rect.top;
  listScrollTop.value = list.scrollTop;

  placeholderEl = document.createElement('div');
  placeholderEl.className = 'zorder-placeholder';
  placeholderEl.style.height = `${rect.height}px`;
  dragEl.parentElement!.insertBefore(placeholderEl, dragEl);

  dragEl.classList.add('zorder-dragging');
  dragEl.style.position = 'fixed';
  dragEl.style.left = `${rect.left}px`;
  dragEl.style.top = `${rect.top}px`;
  dragEl.style.width = `${rect.width}px`;
  document.body.appendChild(dragEl);

  startAutoScroll();
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function updatePlaceholderPosition(clientY: number) {
  if (!placeholderEl || !listEl.value) return;
  const items = Array.from(listEl.value.querySelectorAll('.zorder-item, .zorder-placeholder'));
  for (const item of items) {
    if (item === placeholderEl) continue;
    const rect = item.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      listEl.value.insertBefore(placeholderEl, item);
      return;
    }
  }
  listEl.value.appendChild(placeholderEl);
}

function onMouseMove(e: MouseEvent) {
  if (!dragEl || !placeholderEl) return;
  e.preventDefault();
  dragLastClientY = e.clientY;
  dragEl.style.top = `${e.clientY - dragOffsetY}px`;
  updatePlaceholderPosition(e.clientY);
}

function onMouseUp() {
  if (!dragEl || !placeholderEl || !listEl.value) return;
  stopAutoScroll();

  const items = Array.from(listEl.value.querySelectorAll('.zorder-item, .zorder-placeholder'));
  const displayIdx = items.indexOf(placeholderEl);
  const movedId = dragPhotoId!;
  const visibleIds = visibleItems.value.map(p => p.id);
  const fromIdx = visibleIds.indexOf(movedId);

  dragEl.classList.remove('zorder-dragging');
  dragEl.style.position = '';
  dragEl.style.left = '';
  dragEl.style.top = '';
  dragEl.style.width = '';
  listEl.value.insertBefore(dragEl, placeholderEl);
  placeholderEl.remove();
  placeholderEl = null;
  dragEl = null;
  dragPhotoId = null;
  listScrollTop.value = listEl.value.scrollTop;

  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  if (fromIdx < 0 || displayIdx < 0 || fromIdx === displayIdx) return;

  const nextVisibleIds = [...visibleIds];
  nextVisibleIds.splice(fromIdx, 1);
  nextVisibleIds.splice(displayIdx, 0, movedId);

  const displayById = new Map(displayOrder.value.map(p => [p.photo.id, p]));
  const filtered = filteredIds.value;
  let visibleIdx = 0;
  const mergedDisplay = displayOrder.value.map(p => {
    if (!filtered.has(p.photo.id)) return p;
    const nextId = nextVisibleIds[visibleIdx++];
    return displayById.get(nextId) ?? p;
  });

  const overlay = canvasStore.overlay;
  if (overlay) {
    overlay.setPhotoOrder(mergedDisplay.reverse().map(p => p.photo.id));
    photosStore.syncFromOverlay();
    const ids = overlay.getPlacedPhotos().map(p => p.photo.id);
    void updatePhotoOrder(ids).catch(() => {
      showToast({ message: t('errors.updatePhoto'), type: 'error', duration: 3500 });
    });
  }
}

function startAutoScroll() {
  if (dragAutoScrollRaf === null) dragAutoScrollRaf = requestAnimationFrame(stepAutoScroll);
}

function stopAutoScroll() {
  if (dragAutoScrollRaf !== null) {
    cancelAnimationFrame(dragAutoScrollRaf);
    dragAutoScrollRaf = null;
  }
}

function stepAutoScroll() {
  if (!dragEl || !placeholderEl || !listEl.value) { dragAutoScrollRaf = null; return; }
  const listRect = listEl.value.getBoundingClientRect();
  const topEdge = listRect.top + AUTO_SCROLL_EDGE_PX;
  const bottomEdge = listRect.bottom - AUTO_SCROLL_EDGE_PX;
  let delta = 0;

  if (dragLastClientY < topEdge) {
    delta = -Math.ceil(AUTO_SCROLL_MAX_STEP * Math.min(1, (topEdge - dragLastClientY) / AUTO_SCROLL_EDGE_PX));
  } else if (dragLastClientY > bottomEdge) {
    delta = Math.ceil(AUTO_SCROLL_MAX_STEP * Math.min(1, (dragLastClientY - bottomEdge) / AUTO_SCROLL_EDGE_PX));
  }

  if (delta !== 0 && listEl.value) {
    const maxScrollTop = Math.max(0, listEl.value.scrollHeight - listEl.value.clientHeight);
    const next = Math.max(0, Math.min(maxScrollTop, listEl.value.scrollTop + delta));
    if (next !== listEl.value.scrollTop) {
      listEl.value.scrollTop = next;
      listScrollTop.value = next;
      updatePlaceholderPosition(dragLastClientY);
    }
  }

  dragAutoScrollRaf = requestAnimationFrame(stepAutoScroll);
}

onUnmounted(() => {
  stopAutoScroll();
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  if (dragEl) {
    dragEl.classList.remove('zorder-dragging');
    dragEl.style.position = '';
    dragEl.style.left = '';
    dragEl.style.top = '';
    dragEl.style.width = '';
  }
});
</script>
