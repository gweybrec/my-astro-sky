<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { getVisibleFilterEntries } from '@myastrosky/core/gear-catalog';
import {
  filterCandidatesWithCatalog,
  type FilterCandidate,
} from '@myastrosky/core/filter-candidates';
import type { FilterCatalogEntry } from '@myastrosky/core/filter-catalog-entry';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import AppIcon from '../../components/AppIcon.vue';
import { filterColor } from '../../filter-color';
import plusIcon from '@icons/plus.svg?raw';
import checkIcon from '@icons/check.svg?raw';
import noneIcon from '../../icons/circle-slash.svg?raw';

// The list a filter is chosen from (boards "Plan, fenêtre d'observation, filtre" and "Photo, modifier les infos,
// filtre"): "Ajouter un filtre" opens the filter's add page (the page that opened the sheet chooses the filter saved
// there), "Aucun filtre" takes the filter off (hidden while a search is typed), then the filters: the `recent` ones
// first under "Récents" when there are some, then the generic bands, the names in `known` and the filters the user
// keeps, as the desktop's suggestions, under "Tous les filtres". The search narrows both lists. A choice closes the
// sheet.
const open = defineModel<boolean>('open', { required: true });
const value = defineModel<string | null>('value', { required: true });
const props = defineProps<{
  /** The names offered before the catalogue's filters (the generic bands, the filters of the user's photos). */
  known: readonly string[];
  /** The filters used most recently, listed first. */
  recent?: readonly string[];
}>();
const emit = defineEmits<{ add: [] }>();

const query = ref('');
watch(open, (isOpen) => {
  if (isOpen) query.value = '';
});

const knownFilters = computed(
  () => new Map(props.known.map((name) => [name.trim().toLowerCase(), name.trim()])),
);
// A name the catalogue has (a filter already used on a photo, say) keeps the catalogue's colour and description.
function withCatalogue(candidate: FilterCandidate, entries: FilterCatalogEntry[]): FilterCandidate {
  if (candidate.color) return candidate;
  const key = candidate.label.toLowerCase();
  const entry = entries.find((e) => e.label.toLowerCase() === key);
  return entry ? { label: entry.label, color: entry.color, detail: entry.detail } : candidate;
}
// Listed while open, the catalogue read again each time: a filter added or hidden meanwhile shows at once.
const lists = computed(() => {
  if (!open.value) return { recent: [], others: [] };
  const entries = getVisibleFilterEntries();
  const q = query.value.trim().toLowerCase();
  const recent = (props.recent ?? [])
    .filter((name) => !q || name.toLowerCase().includes(q))
    .map((name) => withCatalogue({ label: name, color: null, detail: null }, entries));
  const recentKeys = new Set(recent.map((c) => c.label.toLowerCase()));
  const others = filterCandidatesWithCatalog(knownFilters.value, entries, query.value)
    .map((c) => withCatalogue(c, entries))
    .filter((c) => !recentKeys.has(c.label.toLowerCase()));
  return { recent, others };
});
const recentCandidates = computed(() => lists.value.recent);
const otherCandidates = computed(() => lists.value.others);
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
    <!-- Once something is typed, the list is the search's results: "Aucun filtre" is not one. -->
    <PhoneRow
      v-if="!query.trim()"
      :title="t('mobile.plans.noFilter')"
      :lead="noneIcon"
      button
      @click="choose(null)"
    >
      <template v-if="!chosen" #trail
        ><AppIcon :svg="checkIcon" cls="mob-status--success"
      /></template>
    </PhoneRow>
    <template
      v-for="group in [
        { key: 'recent', title: t('mobile.gear.recentFilters'), items: recentCandidates },
        {
          key: 'all',
          title: recentCandidates.length ? t('mobile.gear.allFilters') : '',
          items: otherCandidates,
        },
      ]"
      :key="group.key"
    >
      <PhoneSectionHeader v-if="group.title && group.items.length">{{
        group.title
      }}</PhoneSectionHeader>
      <PhoneRow
        v-for="c in group.items"
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
    </template>
  </PhoneSheet>
</template>
