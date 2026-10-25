<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { resolvePlanNight, scorePlanEntry } from '@myastrosky/core/targets/plan';
import {
  presetForSetupId,
  resolveSetupById,
  type GearLists,
} from '@myastrosky/core/targets/plan-setup';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { buildMultipleStarTargets } from '@myastrosky/core/targets/multiple-stars';
import type { DSO } from '@myastrosky/core/types';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import { useShowTargetOnMap } from '../composables/useShowTargetOnMap';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PlanPickerSheet from './targets/PlanPickerSheet.vue';
import TargetSummary from './targets/TargetSummary.vue';
import listPlusIcon from '@icons/list-plus.svg?raw';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The board "Cibles, détail d'une cible", opened from a result of the Cibles list: the target for the night and the
// setup of the search (the plan's target page's summary: figures, altitude chart, suggested filters), then the
// desktop's actions on a result: showing it on the map with the search's setup, and adding it to a plan (the desktop's
// picker, PlanPickerSheet). The board has no "Modifier": an object is corrected from the map's object sheet.
const route = useRoute();
const plans = usePlansStore();
const { showError } = useErrorToast();

const dsoId = computed(() => String(route.params.dsoId));
const gear = shallowRef<GearLists | null>(null);
const ready = ref(false);
/** A multiple star of the list (`star:<HIP>`): not in the deep-sky catalogue, made by the search for the setup. */
const isStar = computed(() => dsoId.value.startsWith('star:'));
const preset = computed(() =>
  gear.value ? presetForSetupId(targetsPrefs.setupId, gear.value) : null,
);
const dso = computed<DSO | undefined>(() => {
  if (!ready.value) return undefined;
  if (!isStar.value) return planLookups.getDsoById(dsoId.value);
  return preset.value
    ? buildMultipleStarTargets(preset.value).find((d) => d.id === dsoId.value)
    : undefined;
});
const name = computed(
  () => dso.value?.displayName || dso.value?.catalogs[0] || dso.value?.id || '',
);

// The night of the search (its date, else tonight, at the search's place), resolved as a plan of this one target; a
// multiple star by its position.
const night = computed(() => {
  const d = dso.value;
  if (!d) return null;
  const entry = isStar.value
    ? { id: d.id, dsoId: null, ra: d.ra, dec: d.dec }
    : { id: d.id, dsoId: d.id, ra: null, dec: null };
  return resolvePlanNight({ entries: [entry] }, targetsPrefs, planLookups);
});
const info = computed(() => night.value?.infos[0] ?? null);
const setup = computed(() =>
  gear.value ? resolveSetupById(targetsPrefs.setupId, gear.value) : null,
);
const scores = computed(() =>
  info.value && dso.value && preset.value
    ? scorePlanEntry(dso.value, preset.value, info.value.maxAltDeg, targetsPrefs)
    : null,
);

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    ready.value = true;
    gear.value = await loadGearLists();
    await plans.load();
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

const showTargetOnMap = useShowTargetOnMap('targets');
async function showOnMap() {
  if (dso.value) await showTargetOnMap(dso.value, targetsPrefs.setupId);
}

const pickerOpen = ref(false);
const pickerTarget = computed(() => ({
  id: dsoId.value,
  name: name.value,
  ra: dso.value?.ra ?? 0,
  dec: dso.value?.dec ?? 0,
  star: isStar.value,
}));
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/targets" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ name }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="dso" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <TargetSummary
          :dso="dso"
          :info="info"
          :night="night"
          :scores="scores"
          :filters-subtitle="setup ? `${name} · ${setup.name}` : name"
        />
        <IonList class="mob-list" lines="none" style="padding-top: var(--space-7)">
          <PhoneRow
            :title="t('targets.plan.showOnMap')"
            :lead="mapPinIcon"
            button
            @click="showOnMap"
          />
          <PhoneRow
            :title="t('targets.plan.addToPlan')"
            :lead="listPlusIcon"
            button
            @click="pickerOpen = true"
          />
        </IonList>
      </div>
    </IonContent>
    <PlanPickerSheet v-model:open="pickerOpen" :target="pickerTarget" />
  </IonPage>
</template>
