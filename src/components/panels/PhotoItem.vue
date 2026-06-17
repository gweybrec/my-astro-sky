<template>
  <div>
    <div class="photo-item-top-row">
      <span
        class="photo-item-name cursor-pointer"
        :title="placed.photo.originalName"
        @click.stop="$emit('name-click')"
      >{{ placed.photo.originalName }}</span>
      <div class="photo-item-controls">
        <button
          class="btn-icon"
          :title="placed.visible ? t('photos.hide') : t('photos.show')"
          @click.stop="$emit('toggle')"
          v-html="placed.visible ? eyeSvg : eyeOffSvg"
        ></button>
        <button
          class="btn-icon btn-gear"
          :title="t('photos.settings')"
          @click.stop="$emit('gear', $event)"
        >⚙</button>
      </div>
    </div>
    <div v-if="dsoChips.length > 0 || labelChips.length > 0" class="photo-item-chips">
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
import { t } from '../../i18n';
import PhotoChip from './PhotoChip.vue';
import eyeSvg from '../../icons/eye.svg?raw';
import eyeOffSvg from '../../icons/eye-off.svg?raw';
import type { PlacedPhoto } from '../../photo-overlay';

const props = withDefaults(defineProps<{
  placed: PlacedPhoto;
  dsoChips?: string[];
  labelChips?: string[];
}>(), { dsoChips: () => [], labelChips: () => [] });

defineEmits<{
  'name-click': [];
  toggle: [];
  gear: [event: MouseEvent];
  'dso-chip': [id: string];
  'label-chip': [label: string];
}>();
</script>
