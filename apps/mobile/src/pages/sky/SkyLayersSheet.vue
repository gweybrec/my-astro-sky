<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import PhoneMapSheet from '../../components/PhoneMapSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import calendarIcon from '@icons/calendar.svg?raw';
import localSkyIcon from '@icons/local-sky.svg?raw';
import azimuthGridIcon from '@icons/azimuth-grid.svg?raw';
import compassIcon from '../../icons/compass.svg?raw';
import trajectoryIcon from '@icons/sky-trajectory.svg?raw';
import mountainIcon from '@icons/mountain.svg?raw';
import moonIcon from '@icons/moon.svg?raw';
import sunIcon from '@icons/sun.svg?raw';
import planetsIcon from '@icons/planets.svg?raw';

// The board "Ciel, calques de la carte", opened by the calendar button: the switch between the live sky and the sky
// at a date, then the layers of the map (the desktop's map toolbar, plus the cardinal points of its keyboard shortcut).
// The layers show only with the sky at a date: without it they are greyed out. A layer that needs something else
// (a location, the local projection, a terrain horizon) is greyed out too; its "i" says what it needs.
const emit = defineEmits<{ close: [] }>();
const time = useSkyTimeStore();
const horizon = useHorizonProfileStore();
const {
  mode,
  localSkyMode,
  showAzimuthGrid,
  showCardinalPoints,
  showTrajectory,
  showMoon,
  showSun,
  showPlanets,
  lat,
  lon,
} = storeToRefs(time);
const { profile, enabled: reliefOn } = storeToRefs(horizon);

const dateMode = computed(() => mode.value === 'date');
const noLocation = computed(() => lat.value === null || lon.value === null);
</script>

<template>
  <PhoneMapSheet :title="t('mobile.sky.layers')" @close="emit('close')">
    <PhoneToggleRow
      :model-value="dateMode"
      :title="t('mobile.sky.dateMode')"
      :info="t('mobile.sky.dateModeInfo')"
      :icon="calendarIcon"
      @update:model-value="time.setMode($event ? 'date' : 'live')"
    />
    <PhoneSectionHeader>{{ t('mobile.sky.layersSection') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="localSkyMode"
      :title="t('mobile.sky.localSky')"
      :info="t('mobile.sky.localSkyInfo')"
      :icon="localSkyIcon"
      :disabled="!dateMode || noLocation"
      @update:model-value="time.setLocalSkyMode"
    />
    <PhoneToggleRow
      :model-value="showAzimuthGrid"
      :title="t('mobile.sky.azimuthGrid')"
      :info="t('mobile.sky.azimuthGridInfo')"
      :icon="azimuthGridIcon"
      :disabled="!dateMode"
      @update:model-value="time.setShowAzimuthGrid"
    />
    <PhoneToggleRow
      :model-value="showCardinalPoints"
      :title="t('mobile.sky.cardinalPoints')"
      :info="t('mobile.sky.cardinalPointsInfo')"
      :icon="compassIcon"
      :disabled="!dateMode"
      @update:model-value="time.setShowCardinalPoints"
    />
    <PhoneToggleRow
      :model-value="showTrajectory"
      :title="t('skyTime.trajectoryButton')"
      :info="t('mobile.sky.trajectoryInfo')"
      :icon="trajectoryIcon"
      :disabled="!dateMode || !localSkyMode"
      @update:model-value="time.setShowTrajectory"
    />
    <PhoneToggleRow
      :model-value="reliefOn"
      :title="t('mobile.sky.relief')"
      :info="t('mobile.sky.reliefInfo')"
      :icon="mountainIcon"
      :disabled="!dateMode || !profile"
      @update:model-value="horizon.setEnabled"
    />
    <PhoneToggleRow
      :model-value="showMoon"
      :title="t('mobile.sky.moon')"
      :info="t('mobile.sky.moonInfo')"
      :icon="moonIcon"
      :disabled="!dateMode"
      @update:model-value="time.setShowMoon"
    />
    <PhoneToggleRow
      :model-value="showSun"
      :title="t('mobile.sky.sun')"
      :info="t('mobile.sky.sunInfo')"
      :icon="sunIcon"
      :disabled="!dateMode"
      @update:model-value="time.setShowSun"
    />
    <PhoneToggleRow
      :model-value="showPlanets"
      :title="t('mobile.sky.planets')"
      :info="t('mobile.sky.planetsInfo')"
      :icon="planetsIcon"
      :disabled="!dateMode"
      @update:model-value="time.setShowPlanets"
    />
  </PhoneMapSheet>
</template>
