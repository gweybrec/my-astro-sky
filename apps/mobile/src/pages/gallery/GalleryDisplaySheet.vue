<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  PER_LINE_CHOICES,
  photosPerLine,
  setPhotosPerLine,
  type Orientation,
} from '../../gallery-display';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneSegmented from '../../components/PhoneSegmented.vue';

// The board "Galerie, affichage": how the gallery is shown. One choice for now, the number of photos per line, kept for
// each way of holding the phone; a choice applies at once. The numbers stand side by side: a list of four rows did not
// fit the sheet with the phone held in landscape.
const props = defineProps<{ open: boolean; orientation: Orientation }>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const options = computed(() =>
  PER_LINE_CHOICES[props.orientation].map((n) => ({ value: String(n), label: String(n) })),
);
const chosen = computed({
  get: () => String(photosPerLine[props.orientation]),
  set: (value: string | undefined) => {
    if (value !== undefined) setPhotosPerLine(props.orientation, Number(value));
  },
});
</script>

<template>
  <PhoneSheet :open="open" :title="t('display.section')" @update:open="emit('update:open', $event)">
    <PhoneSectionHeader>{{ t('mobile.gallery.perLine') }}</PhoneSectionHeader>
    <PhoneSegmented v-model="chosen" :options="options" :label="t('mobile.gallery.perLine')" />
  </PhoneSheet>
</template>
