<template>
  <div class="dso-info-panel">
    <div
      v-if="dso.displayName"
      class="dso-info-name cursor-pointer"
      :title="t('search.recenter')"
      @click="$emit('recenter')"
    >{{ dso.displayName }}</div>
    <table class="dso-info-table">
      <tbody>
        <tr v-if="!isLPN"><td>ID</td><td>{{ dso.catalogs[0] ?? dso.id }}</td></tr>
        <tr><td>{{ t('dso.type') }}</td><td>{{ typeName }}</td></tr>
        <tr><td>{{ t('stars.magnitude') }}</td><td>{{ magStr }}</td></tr>
        <tr><td>{{ t('dso.size') }}</td><td>{{ sizeStr }}</td></tr>
        <tr><td>{{ t('dso.raDec') }}</td><td>{{ raDecStr }}</td></tr>
        <tr v-if="dso.rating !== null"><td>{{ t('targets.ratingFilter') }}</td><td>{{ ratingStr }}</td></tr>
        <tr v-if="dso.difficulty !== null"><td>{{ t('targets.sort.difficulty') }}</td><td>{{ difficultyStr }}</td></tr>
        <tr v-if="dso.emissionLines"><td>{{ t('dso.emissionLines') }}</td><td>{{ dso.emissionLines }}</td></tr>
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
    <button
      class="display-controls-btn mt-4 w-full text-base"
      @click="$emit('edit')"
    >{{ t('dso.edit') }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import type { DSO } from '../../types';
import { getDSOTypeName } from '../../search';
import { formatSize, formatRating, formatDifficulty, formatRA, formatDec } from '../../format-utils';

const props = defineProps<{ dso: DSO }>();
defineEmits<{ recenter: []; edit: [] }>();

const isLPN = computed(() => props.dso.id.startsWith('LPN-'));
const typeName = computed(() => getDSOTypeName(props.dso.type));
const magStr = computed(() => props.dso.mag !== null ? props.dso.mag.toFixed(1) : '—');
const sizeStr = computed(() => formatSize(props.dso.majAxis, props.dso.minAxis));
const raDecStr = computed(() => `${formatRA(props.dso.ra)} / ${formatDec(props.dso.dec)}`);
const ratingStr = computed(() => formatRating(props.dso.rating));
const difficultyStr = computed(() => formatDifficulty(props.dso.difficulty));
const crossRefs = computed(() => props.dso.catalogs.slice(1).filter((c: string) => !c.startsWith('LPN-')));
</script>
