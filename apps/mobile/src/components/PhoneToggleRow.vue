<script setup lang="ts">
import { IonToggle } from '@ionic/vue';
import PhoneInfoButton from './PhoneInfoButton.vue';

// A settings row with a switch: the whole row is the tap target and the change applies at once. With `info` the title
// is followed by the "i" button (its explanation opens in the small dialog), the switch keeps the right end.
defineProps<{ title: string; disabled?: boolean; info?: string }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <IonToggle
    class="mob-row mob-toggle-row"
    :class="{ 'mob-toggle-row--info': info }"
    justify="space-between"
    label-placement="start"
    :checked="model"
    :disabled="disabled"
    @ion-change="model = $event.detail.checked"
  >
    <span v-if="info" class="mob-toggle-info-line">
      <span class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
      <!-- The "i" lies inside the switch's label: its tap must not flip the switch. -->
      <span class="mob-toggle-info" @click.stop.prevent
        ><PhoneInfoButton :title="title" :message="info"
      /></span>
    </span>
    <span v-else class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
  </IonToggle>
</template>
