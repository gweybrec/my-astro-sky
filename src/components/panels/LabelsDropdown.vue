<template>
  <div class="display-controls-mag-row mb-3">
    <button
      ref="btnRef"
      type="button"
      class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
      @click.stop="isOpen = !isOpen"
    >
      {{ t('gallery.filterLabels') }}{{ labelItems.length > 0 ? ` (${selectedCount})` : '' }}
    </button>

    <DropdownPanel v-model="isOpen" :anchor-el="btnRef" align-right min-width="220px">
      <label class="labels-select-all-row">
        <input ref="selectAllRef" type="checkbox" :checked="allChecked" @change="toggleAll" />
        <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
      </label>

      <label
        v-for="item in labelItems"
        :key="item.label"
        class="dso-toggle-label labels-select-all-row justify-between"
      >
        <div class="flex items-center">
          <input
            type="checkbox"
            :checked="isLabelVisible(item.label)"
            @change="(e) => toggleLabel(item.label, e)"
          />
          <span class="tag-chip label-chip tag-chip-sm ml-4">{{
            item.label === '(no label)' ? t('display.noLabel') : item.label
          }}</span>
        </div>
        <span class="labels-count-span">{{ item.count }} photos</span>
      </label>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useDisplayStore } from '../../stores/display';
import { useCanvasStore } from '../../stores/canvas';
import { useI18n } from '../../composables/useI18n';
import DropdownPanel from '../base/DropdownPanel.vue';

const { t } = useI18n();
const displayStore = useDisplayStore();
const canvasStore = useCanvasStore();

interface LabelItem {
  label: string;
  count: number;
}

const isOpen = ref(false);
const btnRef = ref<HTMLButtonElement>();
const selectAllRef = ref<HTMLInputElement>();
const labelItems = ref<LabelItem[]>([]);

function refreshLabels() {
  const overlay = canvasStore.overlay;
  if (!overlay) return;
  const placed = overlay.getPlacedPhotos();
  const counts = new Map<string, number>();
  for (const p of placed) {
    const labs = p.photo.labels?.length ? p.photo.labels : ['(no label)'];
    for (const l of labs) counts.set(l, (counts.get(l) || 0) + 1);
  }
  labelItems.value = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function isLabelVisible(label: string): boolean {
  const v = displayStore.visibleLabels;
  return label in v ? v[label] : true;
}

const selectedCount = computed(
  () => labelItems.value.filter((item) => isLabelVisible(item.label)).length,
);

const allChecked = computed(
  () => labelItems.value.length > 0 && labelItems.value.every((item) => isLabelVisible(item.label)),
);

const someChecked = computed(() => labelItems.value.some((item) => isLabelVisible(item.label)));

watch([allChecked, someChecked], () => {
  if (selectAllRef.value) {
    selectAllRef.value.indeterminate = someChecked.value && !allChecked.value;
  }
});

function toggleLabel(label: string, e: Event) {
  displayStore.setVisibleLabel(label, (e.target as HTMLInputElement).checked);
}

function toggleAll(e: Event) {
  displayStore.setAllLabels(
    labelItems.value.map((i) => i.label),
    (e.target as HTMLInputElement).checked,
  );
}

watch(isOpen, (open) => {
  if (open) refreshLabels();
});

onMounted(() => {
  const overlay = canvasStore.overlay;
  if (overlay) {
    overlay.addOnPhotosChanged(refreshLabels);
    refreshLabels();
  }
});
</script>
