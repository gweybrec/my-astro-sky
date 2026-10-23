<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Photo } from '@myastrosky/core/types';
import { getGearSetups } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { photoFacts } from '../photo-facts';
import PhoneFacts from './PhoneFacts.vue';

// What is known of a photo, read only, in compact facts (the boards "Ciel, photo sélectionnée" and "Photo,
// informations"): the facts of `photoFacts`, with the name of the photo's equipment looked up here.
const props = defineProps<{ photo: Photo; fileName?: boolean; objects?: boolean }>();

const setupName = ref<string>();
watch(
  () => props.photo.gearSetupId,
  async (id) => {
    setupName.value = undefined;
    if (!id) return;
    try {
      setupName.value = (await getGearSetups()).find((s) => s.id === id)?.name;
    } catch (error) {
      reportError('PhotoFacts.setup', error);
    }
  },
  { immediate: true },
);
const facts = computed(() =>
  photoFacts(props.photo, {
    setupName: setupName.value,
    fileName: props.fileName,
    objects: props.objects,
  }),
);
</script>

<template>
  <PhoneFacts v-if="facts.length" class="mob-photo-facts" compact :facts="facts" />
</template>
