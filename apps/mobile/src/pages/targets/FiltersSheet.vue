<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneInfoButton from '../../components/PhoneInfoButton.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneNativePicker from '../../components/PhoneNativePicker.vue';
import AppIcon from '../../components/AppIcon.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import arrowUp from '../../icons/arrow-up.svg?raw';
import arrowDown from '../../icons/arrow-down.svg?raw';
import arrowRight from '../../icons/arrow-right.svg?raw';
import arrowLeft from '../../icons/arrow-left.svg?raw';
import diamond from '../../icons/diamond.svg?raw';
import { FILTER_PREF_KEYS, targetsPrefs, updateTargetsPrefs } from '../../composables/useTargets';

// The board "Cibles, filtres": the sky (directions, region, altitude), the observation window, the objects (interest,
// difficulty, catalogues, constellations) and the options. Each change is stored at once; "Réinitialiser" removes every
// filter and "Appliquer" closes the sheet (the list is searched again then). The two times of the observation window
// open the phone's time picker.
const open = defineModel<boolean>('open', { required: true });
const router = useRouter();
const regionsStore = useSkyRegionsStore();
const fromPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const toPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);

const DIRECTIONS = [
  { key: 'N', label: 'targets.horizon.north', icon: arrowUp },
  { key: 'S', label: 'targets.horizon.south', icon: arrowDown },
  { key: 'E', label: 'targets.horizon.east', icon: arrowRight },
  { key: 'W', label: 'targets.horizon.west', icon: arrowLeft },
] as const;
const LEVELS = [1, 2, 3, 4, 5];

const dirs = computed(() => new Set(targetsPrefs.horizonDirs ?? ['N', 'S', 'E', 'W']));
const ratings = computed(() => new Set(targetsPrefs.enabledRatings ?? LEVELS));
const difficulties = computed(() => new Set(targetsPrefs.enabledDifficulties ?? LEVELS));
const region = computed(() => regionsStore.regions.find((r) => r.id === targetsPrefs.skyRegionId));
const catalogCount = computed(
  () => targetsPrefs.enabledCatalogs?.length ?? DSO_CATALOGS_ALL.length,
);
const constellationTotal = computed(() => new Set(getConstellationInfos().map((c) => c.id)).size);
const constellationCount = computed(
  () => targetsPrefs.enabledConstellations?.length ?? constellationTotal.value,
);
const minAlt = computed({
  get: () => targetsPrefs.minAltDeg ?? 20,
  set: (v: number) =>
    updateTargetsPrefs({ minAltDeg: v, maxAltDeg: Math.max(maxAlt.value, v + 1) }),
});
const maxAlt = computed({
  get: () => targetsPrefs.maxAltDeg ?? 80,
  set: (v: number) =>
    updateTargetsPrefs({ maxAltDeg: v, minAltDeg: Math.min(minAlt.value, v - 1) }),
});

function toggleIn(set: Set<number | string>, value: number | string): (number | string)[] {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next];
}
const toggleDir = (key: string) =>
  updateTargetsPrefs({ horizonDirs: toggleIn(dirs.value, key) as string[] });
const toggleRating = (n: number) =>
  updateTargetsPrefs({ enabledRatings: toggleIn(ratings.value, n) as number[] });
const toggleDifficulty = (n: number) =>
  updateTargetsPrefs({ enabledDifficulties: toggleIn(difficulties.value, n) as number[] });

function reset() {
  updateTargetsPrefs(Object.fromEntries(FILTER_PREF_KEYS.map((key) => [key, undefined])));
}

function openRegions() {
  open.value = false;
  void router.push('/targets/regions');
}

const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('mobile.targets.filtersTitle')" tall>
    <PhoneSectionHeader>{{ t('mobile.targets.sectionSky') }}</PhoneSectionHeader>
    <div class="mob-form-row mob-form-row--title mob-form-row--bar">
      <span class="mob-form-label m-secondary">{{ t('targets.horizon.label') }}</span>
      <PhoneInfoButton
        :title="t('targets.horizon.label')"
        :message="t('targets.horizon.tooltip')"
      />
    </div>
    <div class="mob-btn-row">
      <PhoneButton
        v-for="dir in DIRECTIONS"
        :key="dir.key"
        :pressed="dirs.has(dir.key)"
        :aria-label="t(dir.label)"
        @click="toggleDir(dir.key)"
      >
        <AppIcon :svg="dir.icon" cls="mob-icon--sm mob-icon--dir" />{{ t(dir.label) }}
      </PhoneButton>
    </div>
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="`${t('targets.skyRegion.label')} : ${region ? region.name : t('targets.skyRegion.none')}`"
        @click="openRegions"
      >
        <span class="mob-btn-key">{{ t('targets.skyRegion.label') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">
          <span v-if="region" class="mob-swatch" :style="{ background: region.color }" />
          {{ region ? region.name : t('targets.skyRegion.none') }}
        </span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--title">
      <span class="mob-form-label m-secondary">{{ t('targets.altRangeLabel') }}</span>
    </div>
    <PhoneSliderRow
      v-model="minAlt"
      :label="t('targets.minAlt')"
      :min="0"
      :max="89"
      :display="`${minAlt}°`"
    />
    <PhoneSliderRow
      v-model="maxAlt"
      :label="t('targets.maxAlt')"
      :min="1"
      :max="90"
      :display="`${maxAlt}°`"
    />

    <PhoneSectionHeader>{{ t('targets.timeWindowLabel') }}</PhoneSectionHeader>
    <div class="mob-form-row mob-form-row--pair">
      <PhoneField
        bare
        readonly
        :label="t('targets.timeWindowStart')"
        :model-value="targetsPrefs.obsStartTime ?? ''"
        @click="fromPicker?.open()"
      />
      <PhoneField
        bare
        readonly
        :label="t('targets.timeWindowEnd')"
        :model-value="targetsPrefs.obsEndTime ?? ''"
        @click="toPicker?.open()"
      />
    </div>
    <PhoneNativePicker
      ref="fromPicker"
      type="time"
      :value="targetsPrefs.obsStartTime ?? ''"
      @pick="updateTargetsPrefs({ obsStartTime: $event })"
    />
    <PhoneNativePicker
      ref="toPicker"
      type="time"
      :value="targetsPrefs.obsEndTime ?? ''"
      @pick="updateTargetsPrefs({ obsEndTime: $event })"
    />

    <PhoneSectionHeader>{{ t('mobile.targets.sectionObjects') }}</PhoneSectionHeader>
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
    <!-- The pickers of the catalogues and of the constellations have no board yet: the fields show the counts only. -->
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

    <PhoneSectionHeader>{{ t('mobile.targets.sectionOptions') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="targetsPrefs.includeOversized ?? false"
      :title="t('targets.includeOversized')"
      :info="t('targets.includeOversizedTooltip')"
      @update:model-value="updateTargetsPrefs({ includeOversized: $event })"
    />
    <PhoneToggleRow
      :model-value="targetsPrefs.excludePhotographed ?? false"
      :title="t('targets.excludePhotographed')"
      :info="t('targets.excludePhotographedTooltip')"
      @update:model-value="updateTargetsPrefs({ excludePhotographed: $event })"
    />
    <PhoneToggleRow
      :model-value="targetsPrefs.respectHorizon ?? false"
      :title="t('horizon.respectHorizon')"
      @update:model-value="updateTargetsPrefs({ respectHorizon: $event })"
    />

    <template #footer>
      <PhoneButton size="lg" @click="reset">{{ t('mobile.targets.reset') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="open = false">{{
        t('mobile.targets.apply')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
