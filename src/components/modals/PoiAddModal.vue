<template>
  <IdentifyModalShell
    :photo="photo"
    modal-class="poi-add-modal"
    :title="t('poi.addTitle')"
    :intro="t('poi.addIntro')"
    hide-search
    :add-label="t('poi.addConfirm')"
    :selected-count="canAdd ? 1 : 0"
    @close="$emit('close')"
    @add="onAdd"
    @photo-click="onPhotoClick"
  >
    <!-- Name (grows) + type dropdown + edit-types button, same row as the old inline editor. -->
    <template #labels>
      <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_34px] gap-x-2">
        <label class="metadata-label">{{ t('poi.nameLabel') }}</label>
        <label class="metadata-label">{{ t('poi.typeLabel') }}</label>
        <span></span>
      </div>
    </template>
    <template #inputs>
      <!-- Same column template as the labels row, so each label sits over its control. -->
      <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_34px] gap-x-2 items-stretch">
        <input
          v-model="nameInput"
          type="text"
          class="dialog-input min-w-0"
          :placeholder="t('modal.metadataPoiNamePlaceholder')"
          @keydown.enter.prevent="onAdd"
        />
        <select v-model="categoryInput" class="dialog-input min-w-0 px-2">
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <button
          type="button"
          class="btn-icon px-0 inline-flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4"
          :title="t('poi.editTypes')"
          :aria-label="t('poi.editTypes')"
          v-html="penSvg"
          @click="showTypes = true"
        ></button>
      </div>
    </template>

    <template #markers="{ toDisplay }">
      <span
        v-if="posPx && toDisplay(posPx)"
        class="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 border-solid pointer-events-none"
        :style="{
          left: `${toDisplay(posPx)!.left}px`,
          top: `${toDisplay(posPx)!.top}px`,
          borderColor: markerColor,
        }"
      ></span>
    </template>
  </IdentifyModalShell>
  <PoiTypesModal v-if="showTypes" @close="showTypes = false" />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import IdentifyModalShell from './IdentifyModalShell.vue';
import PoiTypesModal from './PoiTypesModal.vue';
import { t } from '../../i18n';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { resolveCategory } from '@myastrosky/core/poi';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import { withCanonicalProjection } from '@myastrosky/core/projection';
import { photoPixelToRaDec } from '@myastrosky/core/asteroid-identify';
import penSvg from '../../icons/pen.svg?raw';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';

const props = defineProps<{ photo: Photo }>();
// The modal never persists: `identified` hands the photo and the new POI to the caller
// (PoiEditor.vue), exactly like the identification modals.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const categoriesStore = usePoiCategoriesStore();
const categories = computed(() => categoriesStore.categories);
categoriesStore.ensureLoaded();

const showTypes = ref(false);
const nameInput = ref('');
const categoryInput = ref('');
const posPx = ref<{ x: number; y: number } | null>(null);

// Default the type select to the first type once loaded / when the list changes.
watch(
  categories,
  (cats) => {
    if (!categoryInput.value || !cats.some((c) => c.id === categoryInput.value)) {
      categoryInput.value = cats[0]?.id ?? '';
    }
  },
  { immediate: true },
);

const markerColor = computed(() => resolveCategory(categoryInput.value, categories.value).color);
const canAdd = computed(() => !!nameInput.value.trim() && !!categoryInput.value && !!posPx.value);

function onPhotoClick(px: { x: number; y: number }) {
  posPx.value = px;
}

function onAdd() {
  const pos = posPx.value;
  const name = nameInput.value.trim();
  if (!canAdd.value || !pos) return;
  // Unprojected in the canonical pole projection: the zenith-centred display mode
  // clips and rotates with the sky clock (see withCanonicalProjection).
  const raDec = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(props.photo);
    return matrix ? photoPixelToRaDec(matrix, pos.x, pos.y) : null;
  });
  if (!raDec) return;
  const ra = ((raDec.ra % 360) + 360) % 360;
  emit('identified', props.photo, [{ name, categoryId: categoryInput.value, ra, dec: raDec.dec }]);
}
</script>
