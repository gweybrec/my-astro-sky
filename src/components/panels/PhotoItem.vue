<template>
  <div>
    <div class="photo-item-top-row">
      <span
        class="photo-item-name cursor-pointer"
        :title="placed.photo.originalName"
        @click.stop="$emit('name-click')"
        >{{ placed.photo.originalName }}</span
      >
      <div class="photo-item-controls">
        <EyeToggleButton
          class="btn-icon"
          :visible="placed.visible"
          :title="placed.visible ? t('photos.hide') : t('photos.show')"
          stop-propagation
          @toggle="$emit('toggle')"
        />
        <button
          class="btn-icon btn-gear"
          :title="t('photos.settings')"
          @click.stop="$emit('gear', $event)"
        >
          ⚙
        </button>
      </div>
    </div>
    <div
      v-if="dsoChips.length > 0 || labelChips.length > 0 || poiChips.length > 0"
      class="photo-item-chips"
    >
      <span
        v-for="(poi, idx) in poiChips"
        :key="`${poi.categoryId}|${poi.name}|${idx}`"
        class="tag-chip poi-chip"
        :class="{ 'poi-chip--icon': poiTypeIcon(poi.categoryId) }"
        :style="{ '--poi-color': resolveCategory(poi.categoryId, poiCategories).color }"
        :title="resolveCategory(poi.categoryId, poiCategories).name"
      >
        <span
          v-if="poiTypeIcon(poi.categoryId)"
          class="poi-marker"
          v-html="poiTypeIcon(poi.categoryId)"
        ></span>
        {{ poi.name }}
      </span>
      <PhotoChip
        v-for="id in dsoChips"
        :key="id"
        :text="id"
        :is-label="false"
        @click="$emit('dso-chip', id)"
      />
      <PhotoChip
        v-for="label in labelChips"
        :key="label"
        :text="label"
        :is-label="true"
        @click="$emit('label-chip', label)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import PhotoChip from './PhotoChip.vue';
import EyeToggleButton from '../base/EyeToggleButton.vue';
import type { PlacedPhoto } from '../../photo-overlay';
import type { PointOfInterest } from '../../types';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { resolveCategory } from '../../poi';
import { poiTypeIcon } from '../../poi-icons';

const props = withDefaults(
  defineProps<{
    placed: PlacedPhoto;
    dsoChips?: string[];
    labelChips?: string[];
    poiChips?: PointOfInterest[];
  }>(),
  { dsoChips: () => [], labelChips: () => [], poiChips: () => [] },
);

const poiCategoriesStore = usePoiCategoriesStore();
poiCategoriesStore.ensureLoaded();
const poiCategories = computed(() => poiCategoriesStore.categories);

defineEmits<{
  'name-click': [];
  toggle: [];
  gear: [event: MouseEvent];
  'dso-chip': [id: string];
  'label-chip': [label: string];
}>();
</script>
