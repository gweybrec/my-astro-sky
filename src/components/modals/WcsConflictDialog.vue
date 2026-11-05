<template>
  <div class="dialog-overlay" @click="$emit('cancel')">
    <div class="dialog !max-w-[480px]" role="dialog" aria-modal="true" @click.stop>
      <h3>{{ t('gallery.wcsConflictsTitle') }}</h3>
      <p class="dialog-message !mb-6">{{ t('gallery.wcsConflictsIntro') }}</p>
      <label class="export-select-all-row">
        <input
          type="checkbox"
          data-test="wcs-conflicts-all"
          :checked="allTicked"
          :indeterminate.prop="someTicked && !allTicked"
          @change="toggleAll"
        />
        <span class="export-select-all-label">{{
          t('gallery.wcsConflictsSelectAll', { n: conflicts.length })
        }}</span>
      </label>
      <div class="export-scroll-list mb-7">
        <label
          v-for="(row, i) in rows"
          :key="row.change.key"
          class="export-photo-row"
          data-test="wcs-conflict-row"
        >
          <input type="checkbox" :checked="ticked.has(i)" @change="toggle(i)" />
          <span class="flex flex-col min-w-0 flex-1">
            <span class="text-small">{{ row.label }}</span>
            <span class="text-small text-secondary truncate" :title="row.text">{{ row.text }}</span>
          </span>
        </label>
      </div>
      <div class="dialog-buttons">
        <button type="button" class="btn-cancel" @click="$emit('cancel')">
          {{ t('modal.cancel') }}
        </button>
        <button ref="applyBtnEl" type="button" class="btn-confirm" @click="apply">
          {{ t('gallery.wcsConflictsApply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import type { WcsChange } from '@myastrosky/core/photo-metadata-draft';
import { wcsChangeLabel, wcsChangeValues } from '@myastrosky/core/wcs-load';

/**
 * The values a solved file brings for fields the photo already has: each one ticked takes the file's value, as the
 * backup restore's list of images. All are ticked at first.
 */
const props = defineProps<{ conflicts: WcsChange[] }>();
const emit = defineEmits<{ apply: [WcsChange[]]; cancel: [] }>();

const rows = computed(() =>
  props.conflicts.map((change) => {
    const { current, incoming } = wcsChangeValues(change);
    return { change, label: wcsChangeLabel(change), text: `${current} → ${incoming}` };
  }),
);

const ticked = reactive(new Set(props.conflicts.map((_, i) => i)));
const allTicked = computed(() => ticked.size === props.conflicts.length);
const someTicked = computed(() => ticked.size > 0);

function toggle(i: number) {
  if (ticked.has(i)) ticked.delete(i);
  else ticked.add(i);
}

function toggleAll(e: Event) {
  ticked.clear();
  if ((e.target as HTMLInputElement).checked) props.conflicts.forEach((_, i) => ticked.add(i));
}

function apply() {
  emit(
    'apply',
    props.conflicts.filter((_, i) => ticked.has(i)),
  );
}

const applyBtnEl = ref<HTMLButtonElement | null>(null);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    emit('cancel');
  }
}

onMounted(() => {
  // Capture phase: the gallery's editor below also closes on Escape.
  document.addEventListener('keydown', onKeyDown, true);
  applyBtnEl.value?.focus();
});
onUnmounted(() => document.removeEventListener('keydown', onKeyDown, true));
</script>
