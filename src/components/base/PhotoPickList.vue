<template>
  <div class="export-photo-section">
    <label class="export-select-all-row">
      <input
        type="checkbox"
        :checked="allChecked"
        :indeterminate.prop="someChecked && !allChecked"
        @change="toggleAll"
      />
      <span class="export-select-all-label">{{ t('settings.exportSelectAll') }}</span>
    </label>
    <div class="export-scroll-list">
      <label v-for="photo in photos" :key="photo.id" class="export-photo-row">
        <input type="checkbox" :checked="selected.has(photo.id)" @change="togglePhoto(photo.id)" />
        <span class="text-ellipsis">{{ photo.originalName }}</span>
        <span class="text-dim-xs">{{ photo.fileSize ? formatBytes(photo.fileSize) : '—' }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The list of the user's photos with a tick box each and "select all" above: the backup and "Share my sky" windows
 * pick their photos with it. `selected` is the caller's reactive set of photo ids, changed in place.
 */
import { computed } from 'vue';
import { t } from '../../i18n';
import { formatBytes } from '@myastrosky/core/format-utils';

const props = defineProps<{
  photos: readonly { id: string; originalName: string; fileSize?: number | null }[];
  selected: Set<string>;
}>();

const allChecked = computed(
  () => props.photos.length > 0 && props.photos.every((p) => props.selected.has(p.id)),
);
const someChecked = computed(() => props.photos.some((p) => props.selected.has(p.id)));

function toggleAll(e: Event) {
  if ((e.target as HTMLInputElement).checked) props.photos.forEach((p) => props.selected.add(p.id));
  else props.selected.clear();
}

function togglePhoto(id: string) {
  if (props.selected.has(id)) props.selected.delete(id);
  else props.selected.add(id);
}
</script>
