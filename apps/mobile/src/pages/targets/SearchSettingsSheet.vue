<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import { formatLatLon } from '@myastrosky/core/observer-location';
import { todayISO } from '@myastrosky/core/targets/format';
import { formatPlanDate } from '@myastrosky/core/targets/plan';
import type { SortKey } from '@myastrosky/core/targets/prefs';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneNativePicker from '../../components/PhoneNativePicker.vue';
import AppIcon from '../../components/AppIcon.vue';
import SkyCheckSheet from '../sky/SkyCheckSheet.vue';
import { dsoCatalogOptions } from '../../catalog-options';
import caretIcon from '../../icons/chevron-down.svg?raw';
import arrowUp from '../../icons/arrow-up.svg?raw';
import arrowDown from '../../icons/arrow-down.svg?raw';
import arrowRight from '../../icons/arrow-right.svg?raw';
import arrowLeft from '../../icons/arrow-left.svg?raw';
import diamond from '../../icons/diamond.svg?raw';
import sortIcon from '../../icons/arrow-up-down.svg?raw';
import {
  FILTER_PREF_KEYS,
  SEARCH_PREF_KEYS,
  TARGET_SORTS,
  targetsPrefs,
  updateTargetsPrefs,
} from '../../composables/useTargets';

// The board "Cibles, paramètres de recherche": everything the targets list is searched and ordered by. The sort, the
// night (the phone's date picker) and the location (the "Lieu d'observation" page), then the sky (directions, region,
// altitude), the observation window (the phone's time picker), the filters (interest, difficulty, and the catalogues
// and constellations, each a list of tick boxes: "Cibles, catalogues" / "Cibles, constellations") and the three
// switches. Each change is stored at once; "Réinitialiser" puts the sky, the window, the filters and the switches back
// to the desktop's defaults and keeps the sort, the night and the location; "Appliquer" closes the sheet (the list is
// searched again then).
const open = defineModel<boolean>('open', { required: true });
const router = useRouter();
const regionsStore = useSkyRegionsStore();
const nightPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const fromPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const toPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const sortOpen = ref(false);
const catalogsOpen = ref(false);
const constellationsOpen = ref(false);

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

/** A list with every value ticked is stored as no filter, as the desktop's constellation list does. */
const kept = (values: string[], total: number) => (values.length === total ? undefined : values);

const catalogOptions = dsoCatalogOptions();
const catalogs = computed({
  get: () => targetsPrefs.enabledCatalogs ?? [...DSO_CATALOGS_ALL],
  set: (v: string[]) => updateTargetsPrefs({ enabledCatalogs: kept(v, DSO_CATALOGS_ALL.length) }),
});
/** The constellations by their name in the language, once each (the registry lists a few twice). */
const constellationOptions = computed(() => {
  const seen = new Set<string>();
  return getConstellationInfos()
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ value: c.id, label: c.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, getLang()));
});
const constellations = computed({
  get: () => targetsPrefs.enabledConstellations ?? constellationOptions.value.map((o) => o.value),
  set: (v: string[]) =>
    updateTargetsPrefs({
      enabledConstellations: kept(v, constellationOptions.value.length),
    }),
});
const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });

const DIRECTIONS = [
  { key: 'N', label: 'targets.horizon.north', icon: arrowUp },
  { key: 'S', label: 'targets.horizon.south', icon: arrowDown },
  { key: 'E', label: 'targets.horizon.east', icon: arrowRight },
  { key: 'W', label: 'targets.horizon.west', icon: arrowLeft },
] as const;

/** The night searched: the last one chosen, as on the desktop, else today. */
const nightISO = computed(() => targetsPrefs.lastDateISO ?? todayISO());
const nightLabel = computed(() =>
  nightISO.value === todayISO()
    ? t('mobile.targets.tonight')
    : formatPlanDate(nightISO.value, getLang()),
);
const place = computed(() =>
  formatLatLon({ lat: targetsPrefs.lat ?? null, lon: targetsPrefs.lon ?? null }),
);
const dirs = computed(() => new Set(targetsPrefs.horizonDirs ?? ['N', 'S', 'E', 'W']));
const region = computed(() => regionsStore.regions.find((r) => r.id === targetsPrefs.skyRegionId));
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

function toggleDir(key: string) {
  const next = new Set(dirs.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  updateTargetsPrefs({ horizonDirs: [...next] });
}

function reset() {
  updateTargetsPrefs(
    Object.fromEntries([...SEARCH_PREF_KEYS, ...FILTER_PREF_KEYS].map((key) => [key, undefined])),
  );
}

function leaveTo(route: string) {
  open.value = false;
  void router.push(route);
}

const aria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.formTitle')" tall>
    <PhoneRow
      :title="t('targets.sort.label')"
      :lead="sortIcon"
      :value="sortLabel"
      chevron
      button
      @click="sortOpen = true"
    />
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="aria(t('mobile.targets.fieldNight'), nightLabel.toLowerCase())"
        @click="nightPicker?.open()"
      >
        <span class="mob-btn-key">{{ t('mobile.targets.fieldNight') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ nightLabel }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <PhoneNativePicker
      ref="nightPicker"
      type="date"
      :value="nightISO"
      @pick="updateTargetsPrefs({ lastDateISO: $event })"
    />
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="aria(t('mobile.targets.fieldPlace'), place)"
        @click="leaveTo('/settings/location')"
      >
        <span class="mob-btn-key">{{ t('mobile.targets.fieldPlace') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ place }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <PhoneSectionHeader>{{ t('mobile.targets.sectionSky') }}</PhoneSectionHeader>
    <div class="mob-form-row mob-form-row--title">
      <span class="mob-form-label m-secondary">{{ t('targets.horizon.label') }}</span>
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
        :aria-label="
          t('mobile.format.labelValue', {
            label: t('targets.skyRegion.label'),
            value: region ? region.name : t('targets.skyRegion.none'),
          })
        "
        @click="leaveTo('/targets/regions')"
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
      @clear="updateTargetsPrefs({ obsStartTime: undefined })"
    />
    <PhoneNativePicker
      ref="toPicker"
      type="time"
      :value="targetsPrefs.obsEndTime ?? ''"
      @pick="updateTargetsPrefs({ obsEndTime: $event })"
      @clear="updateTargetsPrefs({ obsEndTime: undefined })"
    />

    <PhoneSectionHeader>{{ t('mobile.targets.filtersTitle') }}</PhoneSectionHeader>
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
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(t('targets.catalogFilter'), catalogs.length, catalogOptions.length)"
        @click="catalogsOpen = true"
      >
        <span class="mob-btn-key">{{ t('targets.catalogFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          countOf(catalogs.length, catalogOptions.length)
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
          countAria(
            t('targets.constellationFilter'),
            constellations.length,
            constellationOptions.length,
          )
        "
        @click="constellationsOpen = true"
      >
        <span class="mob-btn-key">{{ t('targets.constellationFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          countOf(constellations.length, constellationOptions.length)
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

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
      :info="t('horizon.respectHorizonHint')"
      @update:model-value="updateTargetsPrefs({ respectHorizon: $event })"
    />

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
  <SkyCheckSheet
    v-model:open="catalogsOpen"
    v-model:selected="catalogs"
    :title="t('targets.catalogFilter')"
    :options="catalogOptions"
  />
  <SkyCheckSheet
    v-model:open="constellationsOpen"
    v-model:selected="constellations"
    :title="t('targets.constellationFilter')"
    :options="constellationOptions"
  />
</template>
