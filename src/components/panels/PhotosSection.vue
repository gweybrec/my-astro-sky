<template>
  <CollapsibleSection :title="t('photos.section')" :defaultOpen="true">
    <!-- Add photos button -->
    <div class="flex flex-col gap-2">
      <button class="btn-action" @click="onAddPhoto">{{ t('photos.add') }}</button>
    </div>

    <!-- Search wrapper -->
    <div class="photo-search-wrapper">
      <input
        ref="searchInputEl"
        type="text"
        class="star-search-input photo-search-input"
        :placeholder="t('photos.searchPlaceholder')"
        :title="t('photos.searchTooltip')"
        v-model="searchInput"
        @input="onSearchInput"
        @blur="scheduleHideDropdown"
      />
      <button class="search-clear-btn" :class="{ '!hidden': !searchInput }" @click="clearSearch">
        &times;
      </button>
      <!-- Search dropdown -->
      <div
        class="search-dropdown photo-search-dropdown"
        :class="{ '!block': showDropdown && searchInput }"
        @mousedown.prevent
      >
        <div v-if="searchMatches.length === 0" class="search-item">
          <span class="search-item-name text-hint">{{ t('photos.searchEmpty') }}</span>
        </div>
        <template v-else>
          <div
            v-for="match in searchMatches"
            :key="match.placed.photo.id"
            class="search-item photo-search-item"
            @click="selectFromDropdown(match.placed.photo.id)"
          >
            <PhotoItem
              :placed="match.placed"
              :dso-chips="match.matchingDsoIds"
              :label-chips="match.matchingLabels"
              @name-click="selectFromDropdown(match.placed.photo.id)"
              @toggle="onToggle(match.placed.photo.id)"
              @gear="onGear(match.placed.photo.id, $event)"
              @dso-chip="onDSOChip"
              @label-chip="selectFromDropdown(match.placed.photo.id)"
            />
          </div>
        </template>
      </div>
    </div>

    <!-- Selected card -->
    <div v-if="selectedPlaced" class="photo-list-item photo-selected-card">
      <PhotoItem
        :placed="selectedPlaced"
        :dso-chips="selectedPlaced.photo.dsoIds"
        :label-chips="selectedPlaced.photo.labels"
        @name-click="photosStore.zoomToPhoto(selectedPlaced!.photo.id)"
        @toggle="onToggle(selectedPlaced!.photo.id)"
        @gear="onGear(selectedPlaced!.photo.id, $event)"
        @dso-chip="onDSOChip"
        @label-chip="photosStore.zoomToPhoto(selectedPlaced!.photo.id)"
      />
    </div>
  </CollapsibleSection>

  <!-- Gear popup -->
  <GearPopup
    v-if="gearPhotoId && gearAnchorRect"
    :photo-id="gearPhotoId"
    :anchor-rect="gearAnchorRect"
    @close="closeGear"
    @open-draw-order="openDrawOrder"
  />

  <!-- Draw order modal -->
  <DrawOrderModal
    v-if="drawOrderPhotoId"
    :photo-id="drawOrderPhotoId"
    @close="drawOrderPhotoId = null"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { t } from '../../i18n';
import CollapsibleSection from '../base/CollapsibleSection.vue';
import PhotoItem from './PhotoItem.vue';
import GearPopup from './GearPopup.vue';
import DrawOrderModal from '../modals/DrawOrderModal.vue';
import { useCanvasStore } from '../../stores/canvas';
import { usePhotosStore } from '../../stores/photos';
import { buildPhotoQueryMatches } from '../../photo-search';
import { smartSortPhotos } from '../../gallery';
import { triggerSelectDSOForPhotoChip, triggerBatchModal } from '../../ui';
import { showToast } from '../../toast';

const canvasStore = useCanvasStore();
const photosStore = usePhotosStore();

const searchInputEl = ref<HTMLInputElement | null>(null);
const searchInput = ref('');
const showDropdown = ref(false);
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

const gearPhotoId = ref<string | null>(null);
const gearAnchorRect = ref<DOMRect | null>(null);
const drawOrderPhotoId = ref<string | null>(null);

const selectedPlaced = computed(() =>
  photosStore.selectedPhotoId
    ? (photosStore.placedPhotos.find((p) => p.photo.id === photosStore.selectedPhotoId) ?? null)
    : null,
);

// Build search matches from current query
const searchMatches = computed(() => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return [];
  const all = photosStore.placedPhotos;
  const matches = buildPhotoQueryMatches(
    all.map((p) => p.photo),
    query,
  );
  const sorted = smartSortPhotos(matches.map((m) => m.photo));
  const matchById = new Map(matches.map((m) => [m.photo.id, m]));
  const placedById = new Map(all.map((p) => [p.photo.id, p]));
  return sorted
    .map((photo) => {
      const match = matchById.get(photo.id)!;
      const placed = placedById.get(photo.id)!;
      return { placed, matchingDsoIds: match.matchingDsoIds, matchingLabels: match.matchingLabels };
    })
    .filter((m) => m.placed);
});

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    showDropdown.value = true;
  }, 250);
}

function scheduleHideDropdown() {
  setTimeout(() => {
    showDropdown.value = false;
  }, 120);
}

function clearSearch() {
  searchInput.value = '';
  showDropdown.value = false;
  photosStore.selectPhoto(null);
}

function selectFromDropdown(photoId: string) {
  const placed = photosStore.placedPhotos.find((p) => p.photo.id === photoId);
  if (!placed) return;
  photosStore.selectPhoto(photoId);
  searchInput.value = placed.photo.originalName;
  showDropdown.value = false;
  photosStore.zoomToPhoto(photoId);
}

function onToggle(photoId: string) {
  canvasStore.overlay?.toggleVisibility(photoId);
  photosStore.syncFromOverlay();
}

function onGear(photoId: string, e: MouseEvent) {
  if (gearPhotoId.value === photoId) {
    closeGear();
    return;
  }
  closeGear();
  const btn = e.currentTarget as HTMLElement;
  gearAnchorRect.value = btn.getBoundingClientRect();
  gearPhotoId.value = photoId;
}

function closeGear() {
  gearPhotoId.value = null;
  gearAnchorRect.value = null;
}

function openDrawOrder() {
  drawOrderPhotoId.value = gearPhotoId.value;
}

function onDSOChip(dsoId: string) {
  triggerSelectDSOForPhotoChip(dsoId);
}

function onAddPhoto() {
  const allowedExt = /\.(jpe?g|png|webp)$/i;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/jpg';
  input.multiple = true;
  input.onchange = () => {
    if (!input.files || input.files.length === 0) return;
    const selected = Array.from(input.files);
    const valid = selected.filter((f) => allowedExt.test(f.name));
    if (valid.length === 0) {
      showToast({ message: t('errors.invalidPhotoFormat'), type: 'error', duration: 3500 });
      return;
    }
    if (valid.length !== selected.length) {
      showToast({ message: t('errors.someFilesSkipped'), type: 'error', duration: 3500 });
    }
    triggerBatchModal(valid);
  };
  input.click();
}
</script>
