<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import localSkyIcon from '@icons/local-sky.svg?raw';
import azimuthGridIcon from '@icons/azimuth-grid.svg?raw';
import trajectoryIcon from '@icons/sky-trajectory.svg?raw';
import mountainIcon from '@icons/mountain.svg?raw';
import moonIcon from '@icons/moon.svg?raw';
import sunIcon from '@icons/sun.svg?raw';
import planetsIcon from '@icons/planets.svg?raw';

// The board "Ciel, calques de la carte": the map's toggles as a column along the right edge (the desktop's map toolbar),
// shown while the map is in the date mode. A toggle that needs something the map does not have yet is drawn disabled; its long press
// says what is missing.
const time = useSkyTimeStore();
const horizon = useHorizonProfileStore();
const { localSkyMode, showAzimuthGrid, showTrajectory, showMoon, showSun, showPlanets, lat, lon } =
  storeToRefs(time);
const { profile, enabled: reliefOn } = storeToRefs(horizon);

const noLocation = computed(() => lat.value === null || lon.value === null);
</script>

<template>
  <div class="mob-map-ribbon" role="group" :aria-label="t('mobile.sky.layers')">
    <PhoneIconButton
      float
      :label="t('skyTime.localSkyButton')"
      :pressed="localSkyMode"
      :unavailable="noLocation ? t('mobile.sky.needsLocation') : undefined"
      @click="time.setLocalSkyMode(!localSkyMode)"
    >
      <AppIcon :svg="localSkyIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('skyTime.azimuthGridButton')"
      :pressed="showAzimuthGrid"
      @click="time.setShowAzimuthGrid(!showAzimuthGrid)"
    >
      <AppIcon :svg="azimuthGridIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('skyTime.trajectoryButton')"
      :pressed="showTrajectory"
      :unavailable="localSkyMode ? undefined : t('mobile.sky.needsLocalSky')"
      @click="time.setShowTrajectory(!showTrajectory)"
    >
      <AppIcon :svg="trajectoryIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('horizon.toggleButton')"
      :pressed="reliefOn"
      :unavailable="profile ? undefined : t('mobile.sky.needsHorizon')"
      @click="horizon.setEnabled(!reliefOn)"
    >
      <AppIcon :svg="mountainIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('skyTime.moonButton')"
      :pressed="showMoon"
      @click="time.setShowMoon(!showMoon)"
    >
      <AppIcon :svg="moonIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('skyTime.sunButton')"
      :pressed="showSun"
      @click="time.setShowSun(!showSun)"
    >
      <AppIcon :svg="sunIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="t('skyTime.planetsButton')"
      :pressed="showPlanets"
      @click="time.setShowPlanets(!showPlanets)"
    >
      <AppIcon :svg="planetsIcon" />
    </PhoneIconButton>
  </div>
</template>
