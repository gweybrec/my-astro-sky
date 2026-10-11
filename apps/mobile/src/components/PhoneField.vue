<script setup lang="ts">
import { useId } from 'vue';
import { IonInput } from '@ionic/vue';

// A text or number field (`.mob-field`) on Ionic's input, with the label over it and, when there is one, the unit
// printed after it, outside the field.
defineProps<{
  label?: string;
  unit?: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'search';
  inputmode?: 'text' | 'decimal' | 'numeric';
  disabled?: boolean;
  readonly?: boolean;
}>();
const model = defineModel<string>({ default: '' });
const id = useId();
</script>

<template>
  <div class="mob-form-row">
    <label v-if="label" class="mob-form-label m-secondary" :for="id">{{ label }}</label>
    <div v-if="unit" class="phone-field-unit-line">
      <IonInput
        :id="id"
        v-model="model"
        class="mob-field m-body"
        :type="type ?? 'text'"
        :inputmode="inputmode"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
      />
      <span class="phone-field-unit m-body">{{ unit }}</span>
    </div>
    <IonInput
      v-else
      :id="id"
      v-model="model"
      class="mob-field m-body"
      :type="type ?? 'text'"
      :inputmode="inputmode"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
    />
  </div>
</template>
