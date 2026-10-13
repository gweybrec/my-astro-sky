<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import type { SortKey } from '@myastrosky/core/targets/prefs';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import diamond from '../../icons/diamond.svg?raw';
import sortIcon from '../../icons/arrow-up-down.svg?raw';
import {
  FILTER_PREF_KEYS,
  TARGET_SORTS,
  targetsPrefs,
  updateTargetsPrefs,
} from '../../composables/useTargets';

// The board "Cibles, filtres": how the found targets are ordered (the desktop's sorts, in the list of the board
// "Cibles, trier par") and which ones are kept (interest, difficulty, catalogues, constellations). Each change is
// stored at once; "Réinitialiser" removes the four filters and "Appliquer" closes the sheet (the list is searched
// again then).
const open = defineModel<boolean>('open', { required: true });
const sortOpen = ref(false);

const LEVELS = [1, 2, 3, 4, 5];

const sortOptions = computed(() => TARGET_SORTS.map((s) => ({ value: s.key, label: t(s.label) })));
const sortKey = computed<SortKey | undefined>({
  get: () => targetsPrefs.sortBy ?? 'rating',
  set: (key) => {
    if (key) updateTargetsPrefs({ sortBy: key });
  },
});
const sortLabel = computed(
  () => sortOptions.value.find((o) => o.value === sortKey.value)?.label ?? '',
);

const ratings = computed(() => new Set(targetsPrefs.enabledRatings ?? LEVELS));
const difficulties = computed(() => new Set(targetsPrefs.enabledDifficulties ?? LEVELS));
const catalogCount = computed(
  () => targetsPrefs.enabledCatalogs?.length ?? DSO_CATALOGS_ALL.length,
);
const constellationTotal = computed(() => new Set(getConstellationInfos().map((c) => c.id)).size);
const constellationCount = computed(
  () => targetsPrefs.enabledConstellations?.length ?? constellationTotal.value,
);

function toggleIn(set: Set<number>, value: number): number[] {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next];
}
const toggleRating = (n: number) =>
  updateTargetsPrefs({ enabledRatings: toggleIn(ratings.value, n) });
const toggleDifficulty = (n: number) =>
  updateTargetsPrefs({ enabledDifficulties: toggleIn(difficulties.value, n) });

function reset() {
  updateTargetsPrefs(Object.fromEntries(FILTER_PREF_KEYS.map((key) => [key, undefined])));
}

const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('mobile.targets.filtersTitle')" tall>
    <PhoneRow
      :title="t('targets.sort.label')"
      :lead="sortIcon"
      :value="sortLabel"
      chevron
      button
      @click="sortOpen = true"
    />
    <div class="mob-form-row mob-form-row--title">
      <span class="mob-form-label m-secondary">{{ t('targets.ratingFilter') }}</span>
    </div>
    <div class="mob-btn-row">
      <PhoneButton
        v-for="n in LEVELS"
        :key="n"
        :pressed="ratings.has(n)"
        :aria-label="t('mobile.targets.ratingN', { n })"
        @click="toggleRating(n)"
      >
        <span>{{ n }}</span>
        <span class="mob-rating">★</span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--title">
      <span class="mob-form-label m-secondary">{{ t('targets.difficultyFilter') }}</span>
    </div>
    <div class="mob-btn-row">
      <PhoneButton
        v-for="n in LEVELS"
        :key="n"
        :pressed="difficulties.has(n)"
        :aria-label="t('mobile.targets.difficultyN', { n })"
        @click="toggleDifficulty(n)"
      >
        <span>{{ n }}</span>
        <AppIcon :svg="diamond" cls="mob-icon--sm" />
      </PhoneButton>
    </div>
    <!-- The lists of the catalogues and of the constellations are not built yet: the fields show the counts only. -->
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(t('targets.catalogFilter'), catalogCount, DSO_CATALOGS_ALL.length)"
      >
        <span class="mob-btn-key">{{ t('targets.catalogFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          t('mobile.targets.countOf', { n: catalogCount, total: DSO_CATALOGS_ALL.length })
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          countAria(t('targets.constellationFilter'), constellationCount, constellationTotal)
        "
      >
        <span class="mob-btn-key">{{ t('targets.constellationFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          t('mobile.targets.countOf', { n: constellationCount, total: constellationTotal })
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <template #footer>
      <PhoneButton size="lg" @click="reset">{{ t('mobile.targets.reset') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="open = false">{{
        t('mobile.targets.apply')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
  <PhoneRadioSheet
    v-model:open="sortOpen"
    v-model:value="sortKey"
    :title="t('targets.sort.label')"
    :options="sortOptions"
  />
</template>
