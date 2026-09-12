<template>
  <BaseModal
    :title="t('stats.modalTitle')"
    size="wide"
    body-class="modal-form-body"
    @close="emit('close')"
  >
    <ConstellationSelector v-model="selectedConstellations" />

    <div class="flex flex-col gap-3">
      <div v-for="cat in DSO_CATALOGS_ALL" :key="cat" class="flex items-center gap-4">
        <span
          class="w-48 shrink-0 truncate text-body text-secondary"
          :title="t(`dso.catalogLabels.${cat}`)"
          >{{ t(`dso.catalogLabels.${cat}`) }}</span
        >
        <div class="flex-1 h-2 rounded-pill bg-[var(--bg-surface-lo)] overflow-hidden">
          <div
            class="h-full rounded-pill bg-[var(--accent-fill-xl)]"
            :style="{ width: `${pct(cat)}%` }"
          ></div>
        </div>
        <span class="w-20 shrink-0 text-right text-body text-label">
          {{ catalogStats[cat].photographed }} / {{ catalogStats[cat].total }}
        </span>
      </div>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import ConstellationSelector from '../panels/ConstellationSelector.vue';
import { useI18n } from '../../composables/useI18n';
import { DSO_CATALOGS_ALL, getDSOById, computeCatalogStats } from '../../dso-catalog';
import { getPhotos } from '../../api';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const selectedConstellations = ref<string[] | null>(null);
const photographedIds = ref<Set<string>>(new Set());

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

function pct(cat: (typeof DSO_CATALOGS_ALL)[number]): number {
  const { photographed, total } = catalogStats.value[cat];
  return total > 0 ? Math.round((photographed / total) * 100) : 0;
}
</script>
