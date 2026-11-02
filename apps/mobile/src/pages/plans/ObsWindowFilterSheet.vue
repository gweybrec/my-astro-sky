<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { getVisibleFilterEntries } from '@myastrosky/core/gear-catalog';
import { filterCandidatesWithCatalog } from '@myastrosky/core/filter-candidates';
import { OBS_WINDOW_FILTERS } from '@myastrosky/core/observation-windows';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import AppIcon from '../../components/AppIcon.vue';
import { filterColor } from '../../filter-color';
import plusIcon from '@icons/plus.svg?raw';
import checkIcon from '@icons/check.svg?raw';
import noneIcon from '../../icons/circle-slash.svg?raw';

// The board "Plan, fenêtre d'observation, filtre": the desktop's filter field of a window as a list. "Ajouter un
// filtre" opens the filter's add page (the page chooses the filter saved there), "Aucun filtre" takes the filter off,
// then the generic bands and the filters the user keeps, as the desktop's suggestions; the search narrows them. A
// choice closes the sheet.
const open = defineModel<boolean>('open', { required: true });
const value = defineModel<string | null>('value', { required: true });
const emit = defineEmits<{ add: [] }>();

const query = ref('');
watch(open, (isOpen) => {
  if (isOpen) query.value = '';
});

const knownFilters = new Map(OBS_WINDOW_FILTERS.map((name) => [name.toLowerCase(), name]));
// Listed while open, the catalogue read again each time: a filter added or hidden meanwhile shows at once.
const candidates = computed(() =>
  open.value
    ? filterCandidatesWithCatalog(knownFilters, getVisibleFilterEntries(), query.value)
    : [],
);
const chosen = computed(() => value.value?.trim().toLowerCase() ?? '');

function choose(filter: string | null) {
  value.value = filter;
  open.value = false;
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.plan.obsWindowFilter')" tall>
    <template #header-extra>
      <PhoneField
        v-model="query"
        class="mob-form-row--flush"
        type="search"
        :placeholder="t('mobile.gear.searchFilter')"
        :aria-label="t('mobile.gear.searchFilterLabel')"
      />
    </template>
    <PhoneRow :title="t('mobile.gear.addFilter')" :lead="plusIcon" button @click="emit('add')" />
    <PhoneRow :title="t('mobile.plans.noFilter')" :lead="noneIcon" button @click="choose(null)">
      <template v-if="!chosen" #trail
        ><AppIcon :svg="checkIcon" cls="mob-status--success"
      /></template>
    </PhoneRow>
    <PhoneRow
      v-for="c in candidates"
      :key="c.label"
      :title="c.label"
      :subs="c.detail ? [c.detail] : []"
      :swatch="c.color ?? filterColor(c.label)"
      button
      @click="choose(c.label)"
    >
      <template v-if="c.label.toLowerCase() === chosen" #trail
        ><AppIcon :svg="checkIcon" cls="mob-status--success"
      /></template>
    </PhoneRow>
  </PhoneSheet>
</template>
