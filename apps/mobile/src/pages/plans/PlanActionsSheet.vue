<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import exportIcon from '@icons/export.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import sortIcon from '../../icons/arrow-up-down.svg?raw';

// The board "Plan, actions". Showing the plan on the map and exporting it as a PDF need the sky map (a later card);
// renaming and choosing the sort have no board for their entry field and list yet: those four rows are drawn as the
// board draws them and do nothing. Deleting asks for confirmation (the page does).
defineProps<{ name: string; sortLabel: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ delete: [] }>();
</script>

<template>
  <PhoneSheet v-model:open="open" :title="name">
    <PhoneRow :title="t('targets.plan.showOnMap')" :lead="mapPinIcon" inert />
    <PhoneRow :title="t('targets.plan.rename')" :lead="penIcon" inert />
    <PhoneRow :title="t('targets.sort.label')" :lead="sortIcon" :value="sortLabel" chevron inert />
    <PhoneRow :title="t('targets.plan.exportPdf')" :lead="exportIcon" inert />
    <PhoneRow
      :title="t('targets.plan.delete')"
      :lead="trashIcon"
      danger
      button
      @click="emit('delete')"
    />
  </PhoneSheet>
</template>
