<script setup lang="ts">
import { IonFab, IonFabButton } from '@ionic/vue';
import AppIcon from './AppIcon.vue';
import plusIcon from '@icons/plus.svg?raw';

// The floating plus (`.mob-fab`, 56 px) at the bottom right: adding something is always a plus button.
defineProps<{ label: string; disabled?: boolean; waiting?: boolean }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -- slot of Ionic's web component, not a Vue 2 slot -->
  <IonFab slot="fixed" class="mob-fab-host mob-fab--fixed">
    <IonFabButton
      class="mob-fab"
      :class="{ 'mob-waiting': waiting }"
      :aria-disabled="waiting ? 'true' : undefined"
      :aria-label="label"
      :disabled="disabled"
      @click="emit('click', $event)"
    >
      <AppIcon :svg="plusIcon" />
    </IonFabButton>
  </IonFab>
</template>
