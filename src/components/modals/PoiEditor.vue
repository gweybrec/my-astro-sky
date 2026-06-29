<template>
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataPoi') }}</label>

    <!-- Existing POIs, as colour-coded chips (× removes inline) -->
    <div class="tag-chips" v-if="pois.length">
      <span
        v-for="(poi, idx) in pois"
        :key="`${poi.categoryId}|${poi.name}|${idx}`"
        class="tag-chip poi-chip"
        :class="{ 'poi-chip--icon': poiTypeIcon(poi.categoryId) }"
        :style="{ '--poi-color': resolveCategory(poi.categoryId, categories).color }"
        :title="resolveCategory(poi.categoryId, categories).name"
      >
        <span v-if="poiTypeIcon(poi.categoryId)" class="poi-marker" v-html="poiTypeIcon(poi.categoryId)"></span>
        {{ poi.name }}
        <button type="button" class="tag-chip-remove" @click="removePoi(idx)">×</button>
      </span>
    </div>

    <!-- Add row: name (grows) + type dropdown + edit-types icon next to the dropdown -->
    <div class="flex items-stretch gap-2 mt-2">
      <input
        type="text"
        class="tag-input flex-[2_1_0%] min-w-0"
        :placeholder="t('modal.metadataPoiNamePlaceholder')"
        ref="nameInputEl"
        v-model="nameInput"
        @keydown.enter.prevent="addPoi"
        @blur="onNameBlur"
      />
      <select
        ref="categorySelect"
        v-model="categoryInput"
        class="tag-input flex-[1_1_0%] min-w-0 px-2"
        @change="onCategoryChange"
        @blur="onCategoryBlur"
      >
        <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <button
        type="button"
        class="btn-icon flex-none px-2 inline-flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4"
        :title="t('poi.editTypes')"
        :aria-label="t('poi.editTypes')"
        v-html="penSvg"
        @click="showTypes = true"
      ></button>
    </div>

    <button type="button" class="integration-add-btn" @click="addPoi">{{ t('poi.addPoi') }}</button>

    <PoiTypesModal v-if="showTypes" @close="showTypes = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { PointOfInterest } from '../../types';
import { t } from '../../i18n';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { resolveCategory } from '../../poi';
import { poiTypeIcon } from '../../poi-icons';
import PoiTypesModal from './PoiTypesModal.vue';
import penSvg from '../../icons/pen.svg?raw';

const props = defineProps<{ pois: PointOfInterest[] }>();
const emit = defineEmits<{ 'update:pois': [PointOfInterest[]] }>();

const categoriesStore = usePoiCategoriesStore();
const categories = computed(() => categoriesStore.categories);

categoriesStore.ensureLoaded();

const showTypes = ref(false);
const nameInput = ref('');
const categoryInput = ref('');
const categorySelect = ref<HTMLSelectElement | null>(null);
const nameInputEl = ref<HTMLInputElement | null>(null);

// Default the type select to the first type once loaded / on changes.
watch(categories, (cats) => {
  if (!categoryInput.value || !cats.some(c => c.id === categoryInput.value)) {
    categoryInput.value = cats[0]?.id ?? '';
  }
}, { immediate: true });

function addPoi() {
  const name = nameInput.value.trim();
  if (!name || !categoryInput.value) return;
  if (props.pois.some(p => p.name === name && p.categoryId === categoryInput.value)) {
    nameInput.value = '';
    return;
  }
  emit('update:pois', [...props.pois, { name, categoryId: categoryInput.value }]);
  nameInput.value = '';
}

// Registering the chip on blur lets the user add a POI without clicking the
// "Add" button. The one exception: when focus moves to the type dropdown, the
// user is still choosing a type, so we defer registration to onCategoryChange /
// onCategoryBlur instead of committing with the (not-yet-chosen) type.
function onNameBlur(e: FocusEvent) {
  if (e.relatedTarget && e.relatedTarget === categorySelect.value) return;
  addPoi();
}

// The type was just chosen — commit the pending name with it.
function onCategoryChange() {
  if (nameInput.value.trim()) addPoi();
}

// Catches the case where the dropdown was opened but the type was left
// unchanged (no change event): commit on leaving the dropdown, unless focus is
// returning to the name input.
function onCategoryBlur(e: FocusEvent) {
  if (e.relatedTarget && e.relatedTarget === nameInputEl.value) return;
  if (nameInput.value.trim()) addPoi();
}

function removePoi(idx: number) {
  emit('update:pois', props.pois.filter((_, i) => i !== idx));
}
</script>
