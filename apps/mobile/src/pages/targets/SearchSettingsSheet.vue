<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { formatLatLon } from '@myastrosky/core/observer-location';
import { todayISO } from '@myastrosky/core/targets/format';
import { formatPlanDate } from '@myastrosky/core/targets/plan';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
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
import { SEARCH_PREF_KEYS, targetsPrefs, updateTargetsPrefs } from '../../composables/useTargets';

// The board "Cibles, paramètres de recherche": where and when the targets are searched for. The night (the phone's
// date picker) and the location (the "Lieu d'observation" page), then the sky (directions, region, altitude), the
// observation window (the phone's time picker) and the three switches. Each change is stored at once; "Réinitialiser"
// puts the sky, the window and the switches back to the desktop's defaults and keeps the night and the location;
// "Appliquer" closes the sheet (the list is searched again then).
const open = defineModel<boolean>('open', { required: true });
const router = useRouter();
const regionsStore = useSkyRegionsStore();
const nightPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const fromPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const toPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);

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
  updateTargetsPrefs(Object.fromEntries(SEARCH_PREF_KEYS.map((key) => [key, undefined])));
}

function leaveTo(route: string) {
  open.value = false;
  void router.push(route);
}

const aria = (name: string, value: string) => t('mobile.targets.fieldAria', { name, value });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.formTitle')" tall>
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
        :aria-label="`${t('targets.skyRegion.label')} : ${region ? region.name : t('targets.skyRegion.none')}`"
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
</template>
