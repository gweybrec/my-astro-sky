<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { Photo } from '@myastrosky/core/types';
import { getGearSetups } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { photoFacts } from '../photo-facts';
import PhoneFacts from './PhoneFacts.vue';
import { SHEET_HOLD } from './map-sheet';

// What is known of a photo, read only, in compact facts (the boards "Ciel, photo sélectionnée" and "Photo,
// informations"): the facts of `photoFacts`, with the name of the photo's equipment looked up here.
const props = defineProps<{
  photo: Photo;
  fileName?: boolean;
  objects?: boolean;
  brief?: boolean;
}>();

const setupName = ref<string>();
// In a map sheet, the sheet waits for the equipment's name before it measures where it stops (under its line).
const hold = inject(SHEET_HOLD, null);
watch(
  () => props.photo.gearSetupId,
  (id) => {
    setupName.value = undefined;
    if (!id) return;
    const lookup = (async () => {
      try {
        setupName.value = (await getGearSetups()).find((s) => s.id === id)?.name;
      } catch (error) {
        reportError('PhotoFacts.setup', error);
      }
    })();
    hold?.(lookup);
  },
  { immediate: true },
);
const facts = computed(() =>
  photoFacts(props.photo, {
    setupName: setupName.value,
    fileName: props.fileName,
    objects: props.objects,
    brief: props.brief,
  }),
);
</script>

<template>
  <PhoneFacts v-if="facts.length" class="mob-photo-facts" :facts="facts" />
</template>
