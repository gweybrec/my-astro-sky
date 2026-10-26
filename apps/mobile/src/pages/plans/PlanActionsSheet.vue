<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import exportIcon from '@icons/export.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import sortIcon from '../../icons/arrow-up-down.svg?raw';

// The board "Plan, actions". Renaming, choosing the sort and deleting are the page's (it opens the name field, the list
// of sorts, the confirmation). Showing the plan on the map and exporting it as a PDF need the sky map and the share
// sheet, which are not wired to a plan yet: those two rows are drawn as the board draws them and do nothing.
defineProps<{ name: string; sortLabel: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ rename: []; sort: []; delete: [] }>();
</script>

<template>
  <PhoneSheet v-model:open="open" :title="name">
    <PhoneRow :title="t('targets.plan.showOnMap')" :lead="mapPinIcon" inert />
    <PhoneRow :title="t('targets.plan.rename')" :lead="penIcon" button @click="emit('rename')" />
    <PhoneRow
      :title="t('targets.sort.label')"
      :lead="sortIcon"
      :value="sortLabel"
      chevron
      button
      @click="emit('sort')"
    />
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
