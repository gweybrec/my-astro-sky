<script setup lang="ts">
import { computed } from 'vue';
import { IonFab, IonFabButton } from '@ionic/vue';
import AppIcon from './AppIcon.vue';
import plusIcon from '@icons/plus.svg?raw';

// The floating plus (`.mob-fab`, 56 px) at the bottom right: adding something is always a plus button.
const props = defineProps<{
  label: string;
  disabled?: boolean;
  waiting?: boolean;
  /** On a page without the tab bar (a pushed page): one gutter above the bottom edge (`.mob-fab--flush`). */
  flush?: boolean;
  /** On a tab's page: the content already ends above the tab bar, so the plus sits one gutter above its end. */
  inTab?: boolean;
}>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const hostClass = computed(() => [
  'mob-fab-host',
  'mob-fab--fixed',
  { 'mob-fab--flush': props.flush, 'mob-fab--in-tab': props.inTab },
]);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -- slot of Ionic's web component, not a Vue 2 slot -->
  <IonFab slot="fixed" :class="hostClass">
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
