<template>
  <BaseModal
    :title="t('stats.modalTitle')"
    :size="openCatalog ? 'default' : 'wide'"
    body-class="modal-form-body"
    @close="emit('close')"
  >
    <template v-if="openCatalog" #title>
      <div class="flex items-center gap-4 min-w-0">
        <button
          type="button"
          class="btn-icon"
          :title="t('stats.catalog.back')"
          :aria-label="t('stats.catalog.back')"
          @click="openCatalog = null"
        >
          ←
        </button>
        <h2>{{ t('stats.modalTitle') }} · {{ t(`dso.catalogLabels.${openCatalog}`) }}</h2>
        <span class="text-body text-dim font-mono"
          >{{ catalogStats[openCatalog].photographed }} /
          {{ catalogStats[openCatalog].total }}</span
        >
      </div>
    </template>

    <StatisticsCatalog
      v-if="openCatalog"
      :catalog="openCatalog"
      :photographed-ids="photographedIds"
      :constellations="selectedConstellations"
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
          <span class="flex-1 h-2 rounded-pill bg-[var(--bg-surface-lo)] overflow-hidden">
            <span
              class="block h-full rounded-pill bg-[var(--accent-fill-xl)]"
              :style="{ width: `${pct(cat)}%` }"
            ></span>
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
