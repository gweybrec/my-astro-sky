<script setup lang="ts">
import { useId } from 'vue';
import { IonInput } from '@ionic/vue';

// A text or number field (`.mob-field`) on Ionic's input, with the label over it and, when there is one, the unit
// printed after it, outside the field.
defineProps<{
  label?: string;
  /** The name for assistive technology when the field has no visible label (the search field of a sheet). */
  ariaLabel?: string;
  /** The label ends with the red asterisk of a required field. */
  required?: boolean;
  unit?: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'search';
  inputmode?: 'text' | 'decimal' | 'numeric';
  disabled?: boolean;
  readonly?: boolean;
  /** Without the form row's inset around it (the field sits in a grid of the page, such as latitude | longitude). */
  bare?: boolean;
}>();
const emit = defineEmits<{ commit: [] }>();
const model = defineModel<string>({ default: '' });
const id = useId();
</script>

<template>
  <div :class="{ 'mob-form-row': !bare }">
    <label v-if="label" class="mob-form-label m-secondary" :for="id"
      >{{ label }}{{ required ? ' ' : ''
      }}<span v-if="required" class="mob-required">*</span></label
    >
    <div v-if="unit" class="phone-field-unit-line">
      <IonInput
        :id="id"
        v-model="model"
        class="mob-field m-body"
        :type="type ?? 'text'"
        :inputmode="inputmode"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        :disabled="disabled"
        :readonly="readonly"
        @ion-change="emit('commit')"
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
      :aria-label="ariaLabel"
      :disabled="disabled"
      :readonly="readonly"
      @ion-change="emit('commit')"
    />
  </div>
</template>
