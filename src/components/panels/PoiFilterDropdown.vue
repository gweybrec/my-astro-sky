<template>
  <div class="display-controls-mag-row">
    <button
      ref="btnRef"
      type="button"
      class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
      @click.stop="toggleOpen"
    >{{ t('gallery.filterPoi') }}{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}</button>

    <DropdownPanel v-model="isOpen" :anchor-el="btnRef" :align-right="alignRight" min-width="240px">
      <div class="labels-select-all-row justify-between">
        <span class="labels-select-all-label text-muted">{{ selectedCount === 0 ? t('gallery.showingAll') : `${selectedCount} ${t('gallery.selected')}` }}</span>
        <button
          type="button"
          class="bg-transparent border border-[var(--border-white-sm)] text-[var(--text-primary)] text-base rounded-sm cursor-pointer px-2 py-px hover:bg-[var(--accent-fill-sm)] disabled:opacity-40 disabled:cursor-default"
          :disabled="selectedCount === 0"
          @click="clearAll"
        >✕ {{ t('display.clear') }}</button>
      </div>
      <div v-if="groups.length === 0" class="px-6 py-3 text-muted text-base">—</div>

      <div v-for="group in groups" :key="group.category.id" class="mb-2">
        <label class="labels-select-all-row justify-between">
          <div class="flex items-center">
            <input
              type="checkbox"
              :checked="isCatChecked(group)"
              :indeterminate.prop="isCatIndeterminate(group)"
              @change="toggleCat(group, ($event.target as HTMLInputElement).checked)"
            />
            <span
              class="tag-chip poi-chip tag-chip-sm ml-4"
              :class="{ 'poi-chip--icon': poiTypeIcon(group.category.id) }"
              :style="{ '--poi-color': group.category.color }"
            >
              <span v-if="poiTypeIcon(group.category.id)" class="poi-marker" v-html="poiTypeIcon(group.category.id)"></span>
              {{ group.category.name }}
            </span>
          </div>
        </label>

        <label
          v-for="item in group.names"
          :key="item.name"
          class="dso-toggle-label labels-select-all-row justify-between pl-6"
        >
          <div class="flex items-center">
            <input
              type="checkbox"
              :checked="isNameChecked(group.category.id, item.name)"
              @change="toggleName(group.category.id, item.name, ($event.target as HTMLInputElement).checked)"
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
import { ref, computed } from 'vue';
import { t } from '../../i18n';
import DropdownPanel from '../base/DropdownPanel.vue';
import type { PoiFilterGroup } from '../../poi';
import { poiTypeIcon } from '../../poi-icons';

const props = defineProps<{
  groups: PoiFilterGroup[];
  selected: Map<string, Set<string>>;
  alignRight?: boolean;
}>();

const emit = defineEmits<{
  'update:selected': [Map<string, Set<string>>];
  open: [];
}>();

const isOpen = ref(false);
const btnRef = ref<HTMLButtonElement>();

// Re-read the POI list every time the dropdown opens so POIs added to photos
// since the gallery was entered show up without a view-mode round-trip.
function toggleOpen() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) emit('open');
}

const selectedCount = computed(() => {
  let n = 0;
  for (const set of props.selected.values()) n += set.size;
  return n;
});

function isNameChecked(catId: string, name: string): boolean {
  return props.selected.get(catId)?.has(name) ?? false;
}

function isCatChecked(group: PoiFilterGroup): boolean {
  const set = props.selected.get(group.category.id);
  return !!set && group.names.length > 0 && group.names.every(n => set.has(n.name));
}

function isCatIndeterminate(group: PoiFilterGroup): boolean {
  const set = props.selected.get(group.category.id);
  if (!set || set.size === 0) return false;
  return !isCatChecked(group);
}

function clone(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [k, v] of props.selected) m.set(k, new Set(v));
  return m;
}

function toggleName(catId: string, name: string, checked: boolean) {
  const m = clone();
  let set = m.get(catId);
  if (!set) { set = new Set(); m.set(catId, set); }
  if (checked) set.add(name); else set.delete(name);
  if (set.size === 0) m.delete(catId);
  emit('update:selected', m);
}

function toggleCat(group: PoiFilterGroup, checked: boolean) {
  const m = clone();
  if (checked) {
    m.set(group.category.id, new Set(group.names.map(n => n.name)));
  } else {
    m.delete(group.category.id);
  }
  emit('update:selected', m);
}

function clearAll() {
  emit('update:selected', new Map());
}
</script>
