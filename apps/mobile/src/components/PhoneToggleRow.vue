<script setup lang="ts">
import { IonToggle } from '@ionic/vue';

// A settings row with a switch: the whole row is the tap target and the change applies at once.
defineProps<{ title: string; disabled?: boolean }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <IonToggle
    class="mob-row mob-toggle-row"
    justify="space-between"
    label-placement="start"
    :checked="model"
    :disabled="disabled"
    @ion-change="model = $event.detail.checked"
  >
    <span class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
  </IonToggle>
</template>
