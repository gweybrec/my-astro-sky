<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import exportIcon from '@icons/export.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import sortIcon from '../../icons/arrow-up-down.svg?raw';

// The board "Plan, actions". Each row is the page's: showing the plan on the map, renaming (the name field), choosing
// the sort (the list of sorts), exporting it as a PDF and deleting (the confirmation).
defineProps<{ name: string; sortLabel: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ showOnMap: []; rename: []; sort: []; exportPdf: []; delete: [] }>();
</script>

<template>
  <PhoneSheet v-model:open="open" :title="name">
    <PhoneRow
      :title="t('targets.plan.showOnMap')"
      :lead="mapPinIcon"
      button
      @click="emit('showOnMap')"
    />
    <PhoneRow :title="t('targets.plan.rename')" :lead="penIcon" button @click="emit('rename')" />
    <PhoneRow
      :title="t('targets.sort.label')"
      :lead="sortIcon"
      :value="sortLabel"
      chevron
      button
      @click="emit('sort')"
    />
    <PhoneRow
      :title="t('targets.plan.exportPdf')"
      :lead="exportIcon"
      button
      @click="emit('exportPdf')"
    />
    <PhoneRow
      :title="t('targets.plan.delete')"
      :lead="trashIcon"
      danger
      button
      @click="emit('delete')"
    />
  </PhoneSheet>
</template>
