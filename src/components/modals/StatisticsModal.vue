<template>
  <BaseModal
    :title="t('stats.modalTitle')"
    :size="openCatalog ? 'default' : 'wide'"
    :body-class="openCatalog ? 'flex-col !overflow-hidden' : 'modal-form-body'"
    :modal-class="openCatalog ? 'h-[85vh]' : undefined"
    @close="emit('close')"
  >
    <template v-if="openCatalog" #title>
      <div class="flex items-center gap-4 min-w-0">
        <button
          type="button"
          class="modal-close inline-flex items-center"
          :title="t('stats.catalog.back')"
          :aria-label="t('stats.catalog.back')"
          @click="openCatalog = null"
        >
          <span v-html="arrowLeftSvg" class="inline-flex w-[1em] h-[1em]" aria-hidden="true"></span>
        </button>
        <h2 class="truncate">
          {{ t('stats.modalTitle') }} · {{ t(`dso.catalogLabels.${openCatalog}`) }}
        </h2>
        <span class="shrink-0 text-body text-label"
          >{{ catalogStats[openCatalog].photographed }} /
          {{ catalogStats[openCatalog].total }}</span
        >
      </div>
    </template>

    <StatisticsCatalog
      v-if="openCatalog"
      v-model:constellations="selectedConstellations"
      :catalog="openCatalog"
      :photographed-ids="photographedIds"
      @show-on-map="showOnMap"
    />

    <template v-else>
      <ConstellationSelector v-model="selectedConstellations" />

      <div class="flex flex-col gap-1">
        <button
          v-for="cat in DSO_CATALOGS_ALL"
          :key="cat"
          type="button"
          class="flex items-center gap-4 w-full box-border px-4 py-2h rounded-md bg-transparent border-none text-left cursor-pointer hover:bg-[var(--bg-hover)]"
          :aria-label="t('stats.catalog.open', { catalog: t(`dso.catalogLabels.${cat}`) })"
          @click="openCatalog = cat"
        >
          <span
            class="w-48 shrink-0 truncate text-body text-secondary"
            :title="t(`dso.catalogLabels.${cat}`)"
            >{{ t(`dso.catalogLabels.${cat}`) }}</span
          >
          <span class="progress-track flex-1">
            <span class="progress-fill" :style="{ width: `${pct(cat)}%` }"></span>
          </span>
          <span class="w-20 shrink-0 text-right text-body text-label">
            {{ catalogStats[cat].photographed }} / {{ catalogStats[cat].total }}
          </span>
          <span class="text-dim" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import ConstellationSelector from '../panels/ConstellationSelector.vue';
import StatisticsCatalog from './StatisticsCatalog.vue';
import { useI18n } from '../../composables/useI18n';
import {
  DSO_CATALOGS_ALL,
  getDSOById,
  computeCatalogStats,
  type DSOCatalog,
} from '../../dso-catalog';
import { getPhotos } from '../../api';
import { useUiStore } from '../../stores/ui';
import { selectDSOInSearch } from '../../ui';
import type { DSO } from '@myastrosky/core/types';
import arrowLeftSvg from '../../icons/arrow-left.svg?raw';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const uiStore = useUiStore();

const selectedConstellations = ref<string[] | null>(null);
const photographedIds = ref<Set<string>>(new Set());
/** The catalogue whose objects are listed, or null for the list of catalogues. */
const openCatalog = ref<DSOCatalog | null>(null);

onMounted(async () => {
  const photos = await getPhotos();
  const ids = new Set<string>();
  for (const photo of photos) {
    for (const dsoId of photo.dsoIds) {
      const dso = getDSOById(dsoId);
      if (dso) ids.add(dso.id);
    }
  }
  photographedIds.value = ids;
});

const catalogStats = computed(() =>
  computeCatalogStats(
    photographedIds.value,
    selectedConstellations.value ? new Set(selectedConstellations.value) : null,
  ),
);

function pct(cat: DSOCatalog): number {
  const { photographed, total } = catalogStats.value[cat];
  return total > 0 ? Math.round((photographed / total) * 100) : 0;
}

/** The map, on the object, with its information panel open (as a click on it). */
function showOnMap(dso: DSO) {
  emit('close');
  uiStore.switchView('skymap');
  selectDSOInSearch(dso.id);
}
</script>
