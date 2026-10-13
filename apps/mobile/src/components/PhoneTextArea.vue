<script setup lang="ts">
import { IonTextarea } from '@ionic/vue';

// A text field of several lines (`.mob-field--multi`, the notes of a photo) on Ionic's textarea: it grows with its text.
defineProps<{
  /** The name of the field for assistive technology (its section's title names it on screen). */
  label: string;
  placeholder?: string;
}>();
const model = defineModel<string>({ default: '' });
</script>

<template>
  <div class="mob-form-row">
    <IonTextarea
      v-model="model"
      class="mob-field mob-field--multi m-body"
      :rows="3"
      auto-grow
      :placeholder="placeholder"
      :aria-label="label"
    />
  </div>
</template>
