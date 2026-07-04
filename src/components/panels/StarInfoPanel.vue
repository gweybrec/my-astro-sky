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
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import type { StarSearchResult } from '../../api';
import { formatRA, formatDec, formatAlt } from '../../format-utils';
import { altitudeAtDeg } from '../../sky-geometry';
import { useSkyTimeStore } from '../../stores/sky-time';

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
