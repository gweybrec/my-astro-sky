<template>
  <div class="dso-info-panel">
    <div
      v-if="dso.displayName"
      class="dso-info-name cursor-pointer"
      :title="t('search.recenter')"
      @click="$emit('recenter')"
    >
      {{ dso.displayName }}
    </div>
    <table class="dso-info-table">
      <tbody>
        <tr v-if="!isOther">
          <td>ID</td>
          <td>{{ dso.catalogs[0] ?? dso.id }}</td>
        </tr>
        <tr>
          <td>{{ t('dso.type') }}</td>
          <td>{{ typeName }}</td>
        </tr>
        <tr>
          <td>{{ t('stars.magnitude') }}</td>
          <td>{{ magStr }}</td>
        </tr>
        <tr>
          <td>{{ t('dso.size') }}</td>
          <td>{{ sizeStr }}</td>
        </tr>
        <tr>
          <td>{{ t('dso.raDec') }}</td>
          <td>{{ raDecStr }}</td>
        </tr>
        <tr v-if="showAltitude">
          <td>{{ t('dso.altitude') }}</td>
          <td>{{ altitudeStr }}</td>
        </tr>
        <tr v-if="transitStr">
          <td>{{ t('targets.results.bestTime') }}</td>
          <td>{{ transitStr }}</td>
        </tr>
        <tr v-if="dso.rating !== null">
          <td>{{ t('targets.ratingFilter') }}</td>
          <td>{{ ratingStr }}</td>
        </tr>
        <tr v-if="dso.difficulty !== null">
          <td>{{ t('targets.sort.difficulty') }}</td>
          <td>{{ difficultyStr }}</td>
        </tr>
        <tr v-if="dso.emissionLines">
          <td>{{ t('dso.emissionLines') }}</td>
          <td>{{ dso.emissionLines }}</td>
        </tr>
        <tr v-if="crossRefs.length > 0">
          <td>{{ t('dso.alsoKnownAs') }}</td>
          <td>
            <template v-for="(ref, i) in crossRefs" :key="ref">
              {{ ref }}<br v-if="i < crossRefs.length - 1" />
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <DSOActions :dso="dso" @edit="$emit('edit')" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import type { DSO } from '@myastrosky/core/types';
import { getDSOTypeName } from '@myastrosky/core/search';
import { isOtherCatalogDso } from '@myastrosky/core/catalog/dso-registry';
import {
  formatSize,
  formatRating,
  formatDifficulty,
  formatRA,
  formatDec,
  formatAlt,
} from '@myastrosky/core/format-utils';
import { altitudeAtDeg, transitTonight } from '@myastrosky/core/sky-geometry';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import DSOActions from './DSOActions.vue';

const props = defineProps<{ dso: DSO }>();
defineEmits<{ recenter: []; edit: [] }>();

const skyTimeStore = useSkyTimeStore();

// In no named catalogue: the id is only a compact key, the name above is its designation
const isOther = computed(() => isOtherCatalogDso(props.dso));
const typeName = computed(() => getDSOTypeName(props.dso.type));
const magStr = computed(() => (props.dso.mag !== null ? props.dso.mag.toFixed(1) : '—'));
const sizeStr = computed(() => formatSize(props.dso.majAxis, props.dso.minAxis));
const raDecStr = computed(() => `${formatRA(props.dso.ra)} / ${formatDec(props.dso.dec)}`);
const showAltitude = computed(
  () => skyTimeStore.mode === 'date' && skyTimeStore.lat !== null && skyTimeStore.lon !== null,
);
const altitudeStr = computed(() =>
  formatAlt(
    altitudeAtDeg(
      props.dso.ra,
      props.dso.dec,
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
    props.dso.ra,
    props.dso.dec,
    skyTimeStore.lat!,
    skyTimeStore.lon!,
    skyTimeStore.simDate,
  );
  return transit ? formatClock24(transit) : null;
});
const ratingStr = computed(() => formatRating(props.dso.rating));
const difficultyStr = computed(() => formatDifficulty(props.dso.difficulty));
const crossRefs = computed(() => props.dso.catalogs.slice(1));
</script>
