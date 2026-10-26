<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { isoToUtcParts, utcPartsToIso } from '@myastrosky/core/asteroid-identify';
import PhoneField from './PhoneField.vue';
import PhoneNativePicker from './PhoneNativePicker.vue';

// A moment in UTC as two fields, its date and its time, each opening the phone's own picker (the desktop's split date
// and time inputs of the identification modals: literal UTC, never the phone's local time). Both fields are grid items
// of the row that holds them, with the row's "UTC" after them. The model is an ISO string, '' while there is no date.
const props = defineProps<{
  /** What the moment is ("Départ", "Date d'observation (UTC)"): the fields' names for assistive technology. */
  label: string;
}>();
const iso = defineModel<string>({ default: '' });

const parts = computed(() => isoToUtcParts(iso.value));
const datePicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const timePicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
</script>

<template>
  <PhoneField
    bare
    readonly
    :model-value="parts.date"
    :aria-label="t('mobile.identify.dateOf', { label: props.label })"
    @click="datePicker?.open()"
  />
  <PhoneField
    bare
    readonly
    :model-value="parts.time"
    :aria-label="t('mobile.identify.timeOf', { label: props.label })"
    @click="timePicker?.open()"
  />
  <PhoneNativePicker
    ref="datePicker"
    type="date"
    :value="parts.date"
    @pick="iso = utcPartsToIso($event, parts.time)"
  />
  <PhoneNativePicker
    ref="timePicker"
    type="time"
    :value="parts.time"
    @pick="iso = utcPartsToIso(parts.date, $event)"
  />
</template>
