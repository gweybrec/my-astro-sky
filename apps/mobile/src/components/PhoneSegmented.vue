<script setup lang="ts" generic="V extends string">
// A choice among a few short values side by side (`.mob-seg` of the design system): one row of equal buttons, the
// chosen one filled. For values that fit a row whatever the screen; a longer list is a `PhoneRadioGroup`.
defineProps<{
  options: readonly { value: V; label: string }[];
  /** The accessible name of the group (what the choice is about). */
  label: string;
}>();
const model = defineModel<V | undefined>();
</script>

<template>
  <div class="mob-form-row">
    <div class="mob-seg" role="radiogroup" :aria-label="label">
      <button
        v-for="o in options"
        :key="o.value"
        type="button"
        class="mob-seg-btn m-body"
        role="radio"
        :aria-checked="model === o.value"
        @click="model = o.value"
      >
        {{ o.label }}
      </button>
    </div>
  </div>
</template>
