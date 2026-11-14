<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import exportIcon from '@icons/export.svg?raw';
import archiveIcon from '@icons/archive.svg?raw';
import unarchiveIcon from '@icons/unarchive.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Plan, actions". Each row is the page's: showing the plan on the map, renaming (the name field), exporting
// it as a PDF, archiving or unarchiving it, and deleting (the confirmation). An archived plan is not shown on the map,
// as on the desktop.
defineProps<{ name: string; archived: boolean }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  showOnMap: [];
  rename: [];
  exportPdf: [];
  archive: [];
  delete: [];
}>();
</script>

<template>
  <PhoneSheet v-model:open="open" :title="name">
    <PhoneRow
      v-if="!archived"
      :title="t('targets.plan.showOnMap')"
      :lead="mapPinIcon"
      button
      @click="emit('showOnMap')"
    />
    <PhoneRow :title="t('targets.plan.rename')" :lead="penIcon" button @click="emit('rename')" />
    <PhoneRow
      :title="t('targets.plan.exportPdf')"
      :lead="exportIcon"
      button
      @click="emit('exportPdf')"
    />
    <PhoneRow
      :title="t(archived ? 'targets.plan.unarchive' : 'targets.plan.archive')"
      :lead="archived ? unarchiveIcon : archiveIcon"
      button
      @click="emit('archive')"
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
