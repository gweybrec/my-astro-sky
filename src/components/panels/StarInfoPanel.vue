<template>
  <div class="dso-info-panel">
    <div class="dso-info-name">{{ headerName }}</div>
    <table class="dso-info-table">
      <tbody>
        <tr v-if="desigStr">
          <td>{{ t('stars.designation') }}</td>
          <td>{{ desigStr }}</td>
        </tr>
        <tr v-if="flamStr">
          <td>Flamsteed</td>
          <td>{{ flamStr }}</td>
        </tr>
        <tr>
          <td>HIP</td>
          <td>{{ star.hip }}</td>
        </tr>
        <tr>
          <td>{{ t('stars.magnitude') }}</td>
          <td>{{ star.mag.toFixed(2) }}</td>
        </tr>
        <tr v-if="star.multiplicity">
          <td>{{ t('stars.multiplicity') }}</td>
          <td>{{ formatMultiplicity(star.multiplicity) }}</td>
        </tr>
        <tr v-if="star.constellation">
          <td>{{ t('stars.constellation') }}</td>
          <td>{{ star.constellation }}</td>
        </tr>
        <tr>
          <td>RA</td>
          <td>{{ raStr }}</td>
        </tr>
        <tr>
          <td>{{ t('stars.dec') }}</td>
          <td>{{ decStr }}</td>
        </tr>
        <tr v-if="showAltitude">
          <td>{{ t('dso.altitude') }}</td>
          <td>{{ altitudeStr }}</td>
        </tr>
        <tr v-if="transitStr">
          <td>{{ t('targets.results.bestTime') }}</td>
          <td>{{ transitStr }}</td>
        </tr>
      </tbody>
    </table>
    <StarActions :star="star" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import type { StarSearchResult } from '../../api';
import { formatMultiplicity } from '../../star-catalog';
import { formatRA, formatDec, formatAlt } from '@myastrosky/core/format-utils';
import StarActions from './StarActions.vue';
import { altitudeAtDeg, transitTonight } from '@myastrosky/core/sky-geometry';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';

const props = defineProps<{ star: StarSearchResult }>();

const skyTimeStore = useSkyTimeStore();
const showAltitude = computed(
  () => skyTimeStore.mode === 'date' && skyTimeStore.lat !== null && skyTimeStore.lon !== null,
);
const altitudeStr = computed(() =>
  formatAlt(
    altitudeAtDeg(
      props.star.ra,
      props.star.dec,
      skyTimeStore.lat!,
      skyTimeStore.lon!,
      skyTimeStore.simDate,
    ),
  ),
);
// When it is highest during the night of the map's date, shown with the altitude (date mode with a location).
const transitStr = computed(() => {
  if (!showAltitude.value) return null;
  const transit = transitTonight(
    props.star.ra,
    props.star.dec,
    skyTimeStore.lat!,
    skyTimeStore.lon!,
    skyTimeStore.simDate,
  );
  return transit ? formatClock24(transit) : null;
});

const headerName = computed(() => {
  const s = props.star;
  return (
    s.name ||
    (s.bayer && s.constellation ? `${s.bayer} ${s.constellation}` : null) ||
    (s.flam && s.constellation ? `${s.flam} ${s.constellation}` : null) ||
    `HIP ${s.hip}`
  );
});

const desigStr = computed(() => {
  const s = props.star;
  return s.desig && s.constellation
    ? `${s.desig} ${s.constellation}`
    : s.bayer && s.constellation
      ? `${s.bayer} ${s.constellation}`
      : '';
});

const flamStr = computed(() => {
  const s = props.star;
  return s.flam && s.constellation ? `${s.flam} ${s.constellation}` : '';
});

const raStr = computed(() => formatRA(props.star.ra));
const decStr = computed(() => formatDec(props.star.dec));
</script>
