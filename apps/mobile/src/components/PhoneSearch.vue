<script setup lang="ts">
import { IonInput } from '@ionic/vue';

// The search field of a top bar (`.mob-search`) on Ionic's input.
defineProps<{ placeholder: string; label: string }>();
const model = defineModel<string>({ default: '' });
</script>

<template>
  <IonInput
    v-model="model"
    class="mob-search m-body"
    type="search"
    enterkeyhint="search"
    :placeholder="placeholder"
    :aria-label="label"
  />
</template>
