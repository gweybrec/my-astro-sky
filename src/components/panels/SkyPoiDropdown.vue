<template>
  <PoiFilterDropdown
    :groups="groups"
    :selected="selected"
    align-right
    @update:selected="onUpdate"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import PoiFilterDropdown from './PoiFilterDropdown.vue';
import { useCanvasStore } from '../../stores/canvas';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import {
  buildPoiFilterGroups,
  prunePoiSelection,
  poiSelectionsEqual,
  type PoiFilterGroup,
} from '../../poi';

const canvasStore = useCanvasStore();
const categoriesStore = usePoiCategoriesStore();

const groups = ref<PoiFilterGroup[]>([]);
const selected = ref<Map<string, Set<string>>>(new Map());

function refresh() {
  const overlay = canvasStore.overlay;
  if (!overlay) {
    groups.value = [];
    return;
  }
  const photoPois = overlay.getPlacedPhotos().map((p) => p.photo.pointsOfInterest ?? []);
  groups.value = buildPoiFilterGroups(photoPois, categoriesStore.categories);
  // Drop selections whose POIs/categories no longer exist, otherwise a stale filter
  // keeps hiding every photo. Re-apply to the overlay only when something changed.
  const pruned = prunePoiSelection(selected.value, groups.value);
  if (!poiSelectionsEqual(pruned, selected.value)) {
    selected.value = pruned;
    overlay.setVisiblePois(pruned);
  }
}

function onUpdate(next: Map<string, Set<string>>) {
  selected.value = next;
  canvasStore.overlay?.setVisiblePois(next);
}

watch(() => categoriesStore.categories, refresh, { deep: true });

onMounted(() => {
  const overlay = canvasStore.overlay;
  if (overlay) {
    overlay.addOnPhotosChanged(refresh);
    refresh();
  }
});
</script>
