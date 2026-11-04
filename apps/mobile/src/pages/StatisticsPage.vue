<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t, getLang } from '@myastrosky/core/i18n/index';
import {
  DSO_CATALOGS_ALL,
  computeCatalogStats,
  getDSOById,
  type DSOCatalog,
} from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import { getPhotos } from '@myastrosky/app-state/api';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneProgressRow from '../components/PhoneProgressRow.vue';
import SkyCheckSheet from './sky/SkyCheckSheet.vue';
import { catalogsReady } from '../catalogs';

// The board "Réglages, statistiques": the desktop's catalog-completion tracker (the 🏆 button), with the same
// constellation filter. One row per DSO catalog family: the name and the "N / M" count of photographed objects,
// then the bar.
const photographedIds = ref<Set<string>>(new Set());
const constellationOptions = ref<{ value: string; label: string }[]>([]);
const constellationsOpen = ref(false);
const selectedConstellations = ref<string[]>([]);

/** The constellations by their name in the language, once each (the registry lists a few twice). */
function readConstellations() {
  const seen = new Set<string>();
  return getConstellationInfos()
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ value: c.id, label: c.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, getLang()));
}

// The star and deep-sky registries load after the first screen: read them once they are there.
onMounted(async () => {
  const [photos] = await Promise.all([getPhotos(), catalogsReady()]);
  constellationOptions.value = readConstellations();
  selectedConstellations.value = constellationOptions.value.map((o) => o.value);
  const ids = new Set<string>();
  for (const photo of photos) {
    for (const dsoId of photo.dsoIds) {
      const dso = getDSOById(dsoId);
      if (dso) ids.add(dso.id);
    }
  }
  photographedIds.value = ids;
});

const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });

const catalogStats = computed(() =>
  computeCatalogStats(
    photographedIds.value,
    selectedConstellations.value.length === constellationOptions.value.length
      ? null
      : new Set(selectedConstellations.value),
  ),
);

function pct(cat: DSOCatalog): number {
  const { photographed, total } = catalogStats.value[cat];
  return total > 0 ? Math.round((photographed / total) * 100) : 0;
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t('stats.modalTitle') }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <IonList class="mob-list" lines="none">
          <PhoneRow
            :title="t('targets.constellationFilter')"
            :value="countOf(selectedConstellations.length, constellationOptions.length)"
            :aria-label="
              countAria(
                t('targets.constellationFilter'),
                selectedConstellations.length,
                constellationOptions.length,
              )
            "
            button
            chevron
            @click="constellationsOpen = true"
          />
        </IonList>
        <div class="mob-progress-list">
          <PhoneProgressRow
            v-for="cat in DSO_CATALOGS_ALL"
            :key="cat"
            :title="t(`dso.catalogLabels.${cat}`)"
            :value="`${catalogStats[cat].photographed} / ${catalogStats[cat].total}`"
            :percent="pct(cat)"
          />
        </div>
      </div>
    </IonContent>
    <SkyCheckSheet
      v-model:open="constellationsOpen"
      v-model:selected="selectedConstellations"
      :title="t('targets.constellationFilter')"
      :options="constellationOptions"
    />
  </IonPage>
</template>
