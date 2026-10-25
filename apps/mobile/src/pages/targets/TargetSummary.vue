<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatAlt } from '@myastrosky/core/format-utils';
import type { DSO } from '@myastrosky/core/types';
import type { AltChartWindow } from '@myastrosky/core/targets/alt-chart';
import { formatArcmin, formatClock24, formatHours } from '@myastrosky/core/targets/format';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import {
  moonSeparationRating,
  type PlanNight,
  type PlanTargetInfo,
  type scorePlanEntry,
} from '@myastrosky/core/targets/plan';
import { filterColor } from '../../filter-color';
import PhoneAltChart from '../../components/PhoneAltChart.vue';
import PhoneBadge from '../../components/PhoneBadge.vue';
import PhoneFacts from '../../components/PhoneFacts.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import diamondIcon from '../../icons/diamond.svg?raw';
import filterIcon from '../../icons/filter.svg?raw';

// What a target is for the night and the setup, the head of the boards "Plan, détail d'une cible" and "Cibles, détail
// d'une cible": its designation, type and constellation, its figures as facts (design system revisions 22 and 24), its
// altitude over the night (revision 23, with the plan's observation windows as bands) and its suggested filters (board
// "Plan, cible, filtres suggérés": the desktop's recipe, in a sheet). The equipment is the plan's or the search's,
// shown where it is chosen, not here.
const props = defineProps<{
  dso: DSO;
  /** The target over the night: its altitude curve, highest point, best time and Moon distance. */
  info: Pick<PlanTargetInfo, 'curve' | 'maxAltDeg' | 'bestTimeUtc' | 'moonSepDeg'> | null;
  night: Pick<PlanNight, 'win' | 'moon' | 'phase'> | null;
  scores: ReturnType<typeof scorePlanEntry> | null;
  /** The frame's angle on the target (a plan's target). */
  angle?: string;
  windows?: AltChartWindow[];
  /** What the suggested filters are for ("target · setup"). */
  filtersSubtitle?: string;
}>();

const typeLabel = computed(() => {
  const d = props.dso;
  return d.type === 'MS' && d.multiplicity
    ? formatMultiplicity(d.multiplicity, t)
    : t(`dso.types.${d.type}`);
});

const facts = computed(() => {
  const d = props.dso;
  const i = props.info;
  const out: {
    label: string;
    value: string;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    icon?: string;
  }[] = [];
  if (i) {
    out.push({ label: t('targets.results.maxAlt'), value: formatAlt(i.maxAltDeg) });
    out.push({ label: t('targets.results.bestTime'), value: formatClock24(i.bestTimeUtc) });
  }
  if (d.mag !== null) out.push({ label: t('stars.magnitude'), value: d.mag.toFixed(1) });
  if (d.majAxis) out.push({ label: t('targets.results.size'), value: formatArcmin(d.majAxis) });
  // Shown whenever the Moon is on (as the plan page's "Lune" fact); the phase is the night's, so a Moon that stays
  // below the horizon all night (no overlay) still gives its distance.
  if (i && props.night && i.moonSepDeg !== null) {
    const rating = moonSeparationRating(i.moonSepDeg, props.night.phase.illum);
    out.push({
      label: t('targets.plan.moonSeparation'),
      value: `${t(rating.labelKey)} (${formatAlt(i.moonSepDeg)})`,
      tone: rating.level === 'ok' ? 'success' : rating.level,
    });
  }
  if (d.rating !== null) {
    out.push({
      label: t('targets.ratingFilter'),
      value: '★'.repeat(d.rating) + '☆'.repeat(5 - d.rating),
      rating: true,
    });
  }
  if (d.difficulty !== null) {
    out.push({
      label: t('targets.sort.difficulty'),
      value: String(d.difficulty),
      icon: diamondIcon,
    });
  }
  if (props.angle !== undefined)
    out.push({ label: t('fovOverlay.angleLabel'), value: props.angle });
  if (props.scores) {
    out.push({
      label: t('targets.results.score'),
      value: t('mobile.format.percent', { n: props.scores.scorePct }),
    });
    out.push({
      label: t('targets.results.fov'),
      value: t('mobile.format.percent', { n: props.scores.fovFitPct }),
    });
    out.push({
      label: t('targets.results.integrationTotal'),
      value: formatHours(props.scores.recipe.totalHours),
    });
  }
  return out;
});

// The desktop's "Filtres suggérés": each filter of the recipe with its exposures and hours.
const filtersOpen = ref(false);
const suggestedFilters = computed(() =>
  (props.scores?.recipe.filters ?? []).map((f) => ({
    name: f.name,
    value: `${f.count} × ${f.subSeconds} s = ${formatHours(f.hours)}`,
    color: filterColor(f.name),
  })),
);
</script>

<template>
  <div class="mob-sheet-header" style="padding-top: var(--space-7)">
    <div class="mob-meta m-secondary">
      <span v-if="dso.displayName">{{ dso.catalogs[0] || dso.id }}</span>
      <PhoneBadge kind="type">{{ typeLabel }}</PhoneBadge>
      <PhoneBadge v-if="dso.constellation" kind="const">{{
        dso.constellation.toUpperCase()
      }}</PhoneBadge>
    </div>
  </div>
  <PhoneFacts :facts="facts" />
  <PhoneAltChart
    v-if="info && night"
    :curve="info.curve"
    :win="night.win"
    :best-time="info.bestTimeUtc"
    :max-alt-deg="info.maxAltDeg"
    :moon-curve="night.moon?.curve"
    :windows="windows"
  />
  <IonList class="mob-list" lines="none">
    <PhoneRow
      :title="t('targets.results.filtersTitle')"
      :lead="filterIcon"
      chevron
      button
      :disabled="suggestedFilters.length === 0"
      @click="filtersOpen = true"
    />
  </IonList>
  <PhoneSheet
    v-model:open="filtersOpen"
    :title="t('targets.results.filtersTitle')"
    :subtitle="filtersSubtitle"
  >
    <IonList class="mob-list" lines="none">
      <PhoneRow
        v-for="f in suggestedFilters"
        :key="f.name"
        :title="f.name"
        :value="f.value"
        :swatch="f.color"
        mono
      />
    </IonList>
  </PhoneSheet>
</template>
