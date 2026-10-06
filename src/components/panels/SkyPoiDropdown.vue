<template>
  <div class="display-controls-mag-row" :class="{ 'opacity-40': disabled }">
    <!-- Sky-map POI pins: checked = shown, unchecked = hidden, everything checked by
         default — the same model as LabelsDropdown / the DSO Types dropdown. Not the
         gallery's PoiFilterDropdown, which is the reverse (a search filter: nothing
         checked ⇒ show all, checking narrows). -->
    <button
      ref="btnRef"
      type="button"
      class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
      :disabled="disabled"
      @click.stop="isOpen = !isOpen"
    >
      {{ t('gallery.filterPoi') }}{{ allKeys.length > 0 ? ` (${visibleCount})` : '' }}
    </button>

    <DropdownPanel v-model="isOpen" :anchor-el="btnRef" align-right min-width="240px">
      <label class="labels-select-all-row">
        <input ref="selectAllRef" type="checkbox" :checked="allChecked" @change="toggleAll" />
        <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
      </label>
      <div v-if="groups.length === 0" class="px-6 py-3 text-muted text-base">—</div>

      <div v-for="group in groups" :key="group.category.id" class="mb-2">
        <label class="labels-select-all-row">
          <input
            type="checkbox"
            :checked="groupState(group) === 'all'"
            :indeterminate.prop="groupState(group) === 'some'"
            @change="(e) => toggleGroup(group, (e.target as HTMLInputElement).checked)"
          />
          <span
            class="tag-chip poi-chip tag-chip-sm ml-4"
            :class="{ 'poi-chip--icon': poiTypeIcon(group.category.id) }"
            :style="{ '--poi-color': group.category.color }"
          >
            <span
              v-if="poiTypeIcon(group.category.id)"
              class="poi-marker"
              v-html="poiTypeIcon(group.category.id)"
            ></span>
            {{ group.category.name }}
          </span>
        </label>

        <!-- !pl-13: .labels-select-all-row's own padding would otherwise cancel the
             indent — name checkboxes line up under the category chip. -->
        <label
          v-for="item in group.names"
          :key="item.name"
          class="dso-toggle-label labels-select-all-row justify-between !pl-13"
        >
          <div class="flex items-center">
            <input
              type="checkbox"
              :checked="isVisible(group.category.id, item.name)"
              @change="
                (e) =>
                  displayStore.setVisiblePoi(
                    poiKey(group.category.id, item.name),
                    (e.target as HTMLInputElement).checked,
                  )
              "
            />
            <span class="ml-4">{{ item.name }}</span>
          </div>
          <span class="labels-count-span">{{ item.count }}</span>
        </label>
      </div>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { t } from '../../i18n';
import DropdownPanel from '../base/DropdownPanel.vue';
import { useCanvasStore } from '../../stores/canvas';
import { useDisplayStore } from '../../stores/display';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { buildPoiFilterGroups, poiKey, type PoiFilterGroup } from '@myastrosky/core/poi';
import { poiTypeIcon } from '../../poi-icons';

/** Greyed out + inert while "Show points of interest" is off (like DSO Types/Catalogs). */
defineProps<{ disabled?: boolean }>();

const canvasStore = useCanvasStore();
const displayStore = useDisplayStore();
const categoriesStore = usePoiCategoriesStore();

const isOpen = ref(false);
const btnRef = ref<HTMLButtonElement>();
const selectAllRef = ref<HTMLInputElement>();
const groups = ref<PoiFilterGroup[]>([]);

function refresh() {
  const overlay = canvasStore.overlay;
  const photoPois = overlay
    ? overlay.getPlacedPhotos().map((p) => p.photo.pointsOfInterest ?? [])
    : [];
  groups.value = buildPoiFilterGroups(photoPois, categoriesStore.categories);
}

function isVisible(categoryId: string, name: string): boolean {
  return displayStore.visiblePois[poiKey(categoryId, name)] !== false;
}

const allKeys = computed(() =>
  groups.value.flatMap((g) => g.names.map((n) => poiKey(g.category.id, n.name))),
);
const visibleCount = computed(
  () => allKeys.value.filter((k) => displayStore.visiblePois[k] !== false).length,
);
const allChecked = computed(
  () => allKeys.value.length > 0 && visibleCount.value === allKeys.value.length,
);

watch([visibleCount, allKeys], () => {
  if (selectAllRef.value) {
    selectAllRef.value.indeterminate = visibleCount.value > 0 && !allChecked.value;
  }
});

function groupState(group: PoiFilterGroup): 'all' | 'some' | 'none' {
  const shown = group.names.filter((n) => isVisible(group.category.id, n.name)).length;
  return shown === group.names.length ? 'all' : shown > 0 ? 'some' : 'none';
}

function toggleGroup(group: PoiFilterGroup, checked: boolean) {
  displayStore.setAllPois(
    group.names.map((n) => poiKey(group.category.id, n.name)),
    checked,
  );
}

function toggleAll(e: Event) {
  displayStore.setAllPois(allKeys.value, (e.target as HTMLInputElement).checked);
}

watch(isOpen, (open) => {
  if (open) refresh();
});
watch(() => categoriesStore.categories, refresh, { deep: true });

onMounted(() => {
  const overlay = canvasStore.overlay;
  if (overlay) {
    overlay.addOnPhotosChanged(refresh);
    refresh();
  }
});
</script>
