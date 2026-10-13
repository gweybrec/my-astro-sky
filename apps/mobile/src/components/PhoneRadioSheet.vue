<script setup lang="ts" generic="V extends string">
import PhoneSheet from './PhoneSheet.vue';
import PhoneRadioGroup from './PhoneRadioGroup.vue';

// A choice of one value among a list, in a sheet: one row per value with a radio mark at its end. The choice applies
// at once; the close button is in the header.
defineProps<{ title: string; options: readonly { value: V; label: string }[] }>();
const open = defineModel<boolean>('open', { required: true });
const value = defineModel<V | undefined>('value', { required: true });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="title" closable>
    <PhoneRadioGroup v-model="value" :options="options" :label="title" />
  </PhoneSheet>
</template>
