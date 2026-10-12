<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';

// A choice of several values among a list, in a sheet: "Tous" and one tick box per value. Each change applies at
// once; the close button is in the header.
const props = defineProps<{
  title: string;
  options: readonly { value: string; label: string }[];
}>();
const open = defineModel<boolean>('open', { required: true });
const selected = defineModel<string[]>('selected', { required: true });

const chosen = computed(() => new Set(selected.value));
const allOn = computed(() => props.options.every((o) => chosen.value.has(o.value)));

function set(value: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(value);
  else next.delete(value);
  selected.value = props.options.filter((o) => next.has(o.value)).map((o) => o.value);
}
const setAll = (on: boolean) => (selected.value = on ? props.options.map((o) => o.value) : []);
</script>

<template>
  <PhoneSheet v-model:open="open" :title="title" closable tall>
    <PhoneCheckRow
      :title="t('mobile.targets.all')"
      :model-value="allOn"
      @update:model-value="setAll"
    />
    <PhoneCheckRow
      v-for="o in options"
      :key="o.value"
      :title="o.label"
      :model-value="chosen.has(o.value)"
      @update:model-value="set(o.value, $event)"
    />
  </PhoneSheet>
</template>
